// Servidor de red: http + Socket.IO tipado, registro de salas y conexión con el motor de reglas.
// Las reglas viven en `game/`; aquí solo se valida, se resuelve quién envía y se entregan los efectos.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import {
  answersUpdateSchema,
  emptyPayloadSchema,
  messageSendSchema,
  reviewReadySchema,
  reviewVoteSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomSettingsSchema,
} from '@bach/shared';
import type { ClientToServerEvents, ErrorCode, RoomAck, ServerToClientEvents } from '@bach/shared';
import { createGame, nextWakeAt, reduce } from '../game/index.js';
import type {
  Action,
  Effect,
  EngineConfig,
  EnginePlayer,
  GameState,
  Recipient,
  ReduceResult,
} from '../game/index.js';
import { IpLimiter, PlayerLimiter, SocketLimiter, clientIp } from './rate-limit.js';
import type { Bucket, PlayerBucket } from './rate-limit.js';
import { RoomRegistry } from './rooms.js';
import type { Room } from './rooms.js';
import { createStaticHandler } from './static.js';

export interface GameServerOptions {
  /** Puerto; 0 elige uno libre. Por defecto 0. */
  port?: number;
  host?: string;
  /** Carpeta del cliente compilado. Por defecto `apps/web/dist`; `null` desactiva el servido estático. */
  webDir?: string | null;
  /** Tope de salas simultáneas. Por defecto 500. */
  maxRooms?: number;
  /**
   * Solo pruebas: tiempos del motor en ms (`letterSpinMs`, `letterRevealMs`, `writeMsOverride`,
   * `stopGraceMs`, `reviewMs`, `roundEndMs`, `graceMs`) y `lettersOverride` para una secuencia fija
   * de letras. Lo que no se indique usa `DEFAULT_ENGINE_CONFIG`.
   */
  engine?: Partial<EngineConfig>;
  /** Azar de los códigos de sala y de la letra de cada ronda. Por defecto `Math.random`. */
  rng?: () => number;
  /** Una sala en LOBBY o GAME_END sin acciones de jugadores durante este tiempo se cierra. Por defecto 30 min. */
  roomIdleMs?: number;
  /** Conexiones simultáneas por IP. Por defecto 40. */
  maxConnectionsPerIp?: number;
  /** Salas creadas por IP cada minuto. Por defecto 10. */
  maxRoomsPerIpPerMinute?: number;
  /**
   * Cabecera con la IP real del cliente cuando el servidor está detrás de un proxy de confianza
   * (p. ej. `x-real-ip`). Sin ella no se confía en ninguna cabecera y se usa la IP de la conexión.
   */
  clientIpHeader?: string | null;
  /**
   * Rechaza las conexiones con `Origin` cuyo host no coincide con el `Host` de la petición (salvo los
   * de `allowedOrigins`). Por defecto false; `index.ts` lo activa con NODE_ENV=production.
   */
  checkOrigin?: boolean;
  /** Orígenes completos permitidos aunque no coincidan con el `Host`, p. ej. `https://juego.example.com`. */
  allowedOrigins?: string[];
  /** Registro de errores y avisos; por defecto `console`. */
  logger?: Pick<Console, 'error' | 'info'>;
}

export interface GameServer {
  port: number;
  /** Origen para conectar clientes, p. ej. `http://127.0.0.1:41233`. */
  url: string;
  roomCount(): number;
  close(): Promise<void>;
}

type GameIo = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Socket sin los tipos del contrato, para emitir y escuchar por nombre de evento resuelto en ejecución. */
interface LooseSocket {
  emit(event: string, ...args: unknown[]): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

interface Session {
  socket: GameSocket;
  roomCode: string | null;
  playerId: string | null;
  limiter: SocketLimiter;
  ip: string;
}

const DEFAULT_MAX_ROOMS = 500;
const DEFAULT_ROOM_IDLE_MS = 30 * 60_000;
/** Un setTimeout no admite más de 2^31-1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Un mensaje legítimo pesa unos pocos cientos de bytes; el tope por defecto de Socket.IO es 1 MB. */
const MAX_BUFFER_BYTES = 16 * 1024;

/**
 * Errores del motor que NO se devuelven a quien los causó, porque son carreras normales entre el
 * cliente y el reloj del servidor (el plazo venció mientras el mensaje viajaba) y no una falta suya:
 * - `wrong_phase` en `game:start` (doble clic), `letter:stop` (la ruleta se detuvo sola), `round:stop`
 *   (otro ya gritó STOP o se acabó el tiempo), `answers:update` (últimas teclas tras cerrar la fase)
 *   y `review:ready` (la categoría ya avanzó).
 * - `wrong_phase` y `unknown_answer` en `review:vote`: la categoría avanzó, o el grupo dejó de existir,
 *   mientras el voto viajaba.
 * Todo lo demás (`not_host`, `not_picker`, `not_playing`, `sheet_incomplete`, `own_answer`, chat
 * fuera de fase, ajustes inválidos) sí se devuelve: es un intento ilegítimo o el cliente lo muestra.
 */
const QUIET_ERRORS: Partial<Record<string, readonly ErrorCode[]>> = {
  'game:start': ['wrong_phase'],
  'letter:stop': ['wrong_phase'],
  'round:stop': ['wrong_phase'],
  'answers:update': ['wrong_phase'],
  'review:vote': ['wrong_phase', 'unknown_answer'],
  'review:ready': ['wrong_phase'],
};

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../../web/dist', import.meta.url));

export async function createGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  const logger = options.logger ?? console;
  const rng = options.rng ?? Math.random;
  const now = (): number => Date.now();

  const engineConfig: Partial<EngineConfig> = { ...options.engine };

  const registry = new RoomRegistry(options.maxRooms ?? DEFAULT_MAX_ROOMS, rng);
  const sessions = new Map<string, Session>();
  const roomIdleMs = options.roomIdleMs ?? DEFAULT_ROOM_IDLE_MS;
  const ipHeader = options.clientIpHeader?.trim().toLowerCase() || null;
  const ipLimiter = new IpLimiter({
    ...(options.maxConnectionsPerIp !== undefined && {
      maxConnections: options.maxConnectionsPerIp,
    }),
    ...(options.maxRoomsPerIpPerMinute !== undefined && {
      maxRoomsPerWindow: options.maxRoomsPerIpPerMinute,
    }),
  });
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(normalizeOrigin));

  // --- HTTP -----------------------------------------------------------------

  const webDir = options.webDir === undefined ? DEFAULT_WEB_DIR : options.webDir;
  const serveStatic = webDir === null ? null : createStaticHandler(webDir);

  const httpServer = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!serveStatic) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    serveStatic(req, res).catch((err: unknown) => {
      logger.error('[http] error al servir archivo', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const io: GameIo = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
    maxHttpBufferSize: MAX_BUFFER_BYTES,
    allowRequest: (req, callback) => {
      if (!options.checkOrigin) return callback(null, true);
      const origin = req.headers.origin;
      if (origin === undefined) return callback(null, true);
      if (allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
      let sameHost = false;
      try {
        const host = req.headers.host?.toLowerCase();
        sameHost = host !== undefined && new URL(origin).host.toLowerCase() === host;
      } catch {
        // Un Origin ilegible (p. ej. "null") nunca coincide.
      }
      if (!sameHost) logger.info(`[socket] origen rechazado: ${origin}`);
      callback(sameHost ? null : 'origin_not_allowed', sameHost);
    },
  });

  const ipOf = (socket: GameSocket): string =>
    clientIp(socket.handshake.headers, socket.handshake.address, ipHeader);

  io.use((socket, next) => {
    if (ipLimiter.canConnect(ipOf(socket))) return next();
    next(new Error('too_many_connections'));
  });

  // --- Entrega de efectos ---------------------------------------------------

  function sendTo(connId: string, event: string, payload?: unknown): void {
    const socket = io.sockets.sockets.get(connId) as unknown as LooseSocket | undefined;
    if (!socket) return;
    if (payload === undefined) socket.emit(event);
    else socket.emit(event, payload);
  }

  function sendError(socket: GameSocket, code: ErrorCode): void {
    socket.emit('system:error', { code });
  }

  function broadcastOnlineCount(): void {
    io.emit('system:online', { count: sessions.size });
  }

  function connectionOf(player: EnginePlayer | undefined): string[] {
    return player?.connected && player.connId !== null ? [player.connId] : [];
  }

  function connIdsFor(state: GameState, to: Recipient): string[] {
    switch (to.kind) {
      case 'room':
        return state.players.flatMap((p) => connectionOf(p));
      case 'roomExcept':
        return state.players.filter((p) => p.id !== to.playerId).flatMap((p) => connectionOf(p));
      case 'player':
        return connectionOf(state.players.find((p) => p.id === to.playerId));
      case 'players': {
        const ids = new Set(to.playerIds);
        return state.players.filter((p) => ids.has(p.id)).flatMap((p) => connectionOf(p));
      }
    }
  }

  /** Entrega un efecto del motor tal cual: la red no decide qué se ve ni a quién, solo reenvía. */
  function execute(room: Room, state: GameState, effect: Effect): void {
    switch (effect.type) {
      case 'emit':
        for (const connId of connIdsFor(state, effect.to)) {
          sendTo(connId, effect.event, effect.payload);
        }
        break;
      case 'snapshot': {
        const player = state.players.find((p) => p.id === effect.playerId);
        for (const connId of connectionOf(player)) {
          sendTo(connId, 'room:state', { ...effect.snapshot, code: room.code });
        }
        break;
      }
      case 'disconnectConn':
        io.sockets.sockets.get(effect.connId)?.disconnect(true);
        break;
    }
  }

  // --- Salas y temporizador -------------------------------------------------

  function destroyRoom(room: Room, notify?: ErrorCode): void {
    const connIds = connIdsFor(room.state, { kind: 'room' });
    registry.delete(room);
    for (const connId of connIds) {
      const socket = io.sockets.sockets.get(connId);
      if (!socket) continue;
      if (notify) sendError(socket, notify);
      const session = sessions.get(connId);
      if (session) {
        session.roomCode = null;
        session.playerId = null;
      }
    }
  }

  /** Registra una acción de un jugador: reinicia el reloj de inactividad de la sala. */
  function touch(room: Room): void {
    room.lastActivity = now();
  }

  function scheduleIdleCheck(room: Room, delayMs: number): void {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(
      () => {
        room.idleTimer = null;
        checkIdle(room);
      },
      Math.min(delayMs, MAX_TIMEOUT_MS),
    );
  }

  /** Cierra la sala si está en LOBBY o GAME_END y nadie hizo nada durante `roomIdleMs`; si no, reprograma. */
  function checkIdle(room: Room): void {
    if (registry.get(room.code) !== room) return;
    const remaining = room.lastActivity + roomIdleMs - now();
    const quiet = room.state.phase === 'LOBBY' || room.state.phase === 'GAME_END';
    if (remaining <= 0 && quiet) {
      logger.info(`[sala ${room.code}] cerrada por inactividad`);
      destroyRoom(room, 'room_not_found');
      return;
    }
    scheduleIdleCheck(room, remaining > 0 ? remaining : roomIdleMs);
  }

  /** Cubeta de respuestas o texto del jugador en esa sala (se crea al primer uso). */
  function allowPlayerBucket(room: Room, playerId: string, bucket: PlayerBucket): boolean {
    let limiter = room.limiters.get(playerId);
    if (!limiter) {
      limiter = new PlayerLimiter(now());
      room.limiters.set(playerId, limiter);
    }
    return limiter.allow(bucket, now());
  }

  function schedule(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const wakeAt = nextWakeAt(room.state);
    if (wakeAt === null) return;
    const delay = Math.min(Math.max(wakeAt - now(), 0), MAX_TIMEOUT_MS);
    room.timer = setTimeout(() => {
      room.timer = null;
      tick(room);
    }, delay);
  }

  /** Aplica una acción al motor, guarda el estado, entrega los efectos y reprograma el temporizador. */
  function run(room: Room, action: Action): ReduceResult {
    const ts = now();
    const result = reduce(room.state, action, {
      now: ts,
      rng,
      newId: () => randomBytes(6).toString('hex'),
    });
    room.state = result.state;
    if (room.limiters.size > room.state.players.length) {
      const present = new Set(room.state.players.map((p) => p.id));
      for (const id of room.limiters.keys()) if (!present.has(id)) room.limiters.delete(id);
    }
    for (const effect of result.effects) execute(room, result.state, effect);
    if (registry.get(room.code) === room) {
      if (room.state.players.length === 0) registry.delete(room);
      else schedule(room);
    }
    return result;
  }

  function tick(room: Room): void {
    try {
      run(room, { type: 'tick' });
    } catch (err) {
      // Un fallo en el reloj de una sala la deja en un estado dudoso: se cierra solo esa sala.
      logger.error(`[sala ${room.code}] error en tick; se cierra la sala`, err);
      destroyRoom(room, 'internal');
    }
  }

  function resolve(session: Session): { room: Room; player: EnginePlayer } | null {
    if (session.roomCode === null || session.playerId === null) return null;
    const room = registry.get(session.roomCode);
    const player = room?.state.players.find((p) => p.id === session.playerId);
    if (!room || !player || player.connId !== session.socket.id) return null;
    return { room, player };
  }

  function leaveRoom(code: string | null, playerId: string | null): void {
    if (code === null || playerId === null) return;
    const room = registry.get(code);
    if (room?.state.players.some((p) => p.id === playerId)) run(room, { type: 'leave', playerId });
  }

  // --- Entrada a una sala ---------------------------------------------------

  function enterRoom(
    session: Session,
    room: Room,
    payload: { name: string; sessionId: string },
    ack: (res: RoomAck) => void,
    isNew: boolean,
  ): void {
    const previous = { code: session.roomCode, playerId: session.playerId };
    const result = run(room, {
      type: 'join',
      sessionId: payload.sessionId,
      name: payload.name,
      connId: session.socket.id,
    });
    if (result.error || result.playerId === undefined) {
      if (isNew) registry.delete(room);
      ack({ ok: false, error: result.error ?? 'internal' });
      return;
    }
    touch(room);
    session.roomCode = room.code;
    session.playerId = result.playerId;
    // Un socket está en una sola sala: se sale de la anterior solo después de entrar a la nueva.
    if (previous.code !== room.code || previous.playerId !== result.playerId) {
      leaveRoom(previous.code, previous.playerId);
    }
    ack({ ok: true, code: room.code, playerId: result.playerId });
  }

  // --- Registro de manejadores ----------------------------------------------

  function guard(socket: GameSocket, ack: ((res: RoomAck) => void) | null, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logger.error(`[socket ${socket.id}] error inesperado`, err);
      if (ack) ack({ ok: false, error: 'internal' });
      else sendError(socket, 'internal');
    }
  }

  io.on('connection', (socket) => {
    const session: Session = {
      socket,
      roomCode: null,
      playerId: null,
      limiter: new SocketLimiter(now()),
      ip: ipOf(socket),
    };
    sessions.set(socket.id, session);
    broadcastOnlineCount();
    ipLimiter.connected(session.ip);
    const loose = socket as unknown as LooseSocket;

    /** Evento con acuse (`room:create`, `room:join`): errores por ack, nunca por `system:error`. */
    function onAcked<T>(
      event: string,
      schema: Schema<T>,
      handler: (payload: T, ack: (res: RoomAck) => void) => void,
    ): void {
      loose.on(event, (...args: unknown[]) => {
        const rawAck = args[args.length - 1];
        if (typeof rawAck !== 'function') return;
        const ack = (res: RoomAck): void => void (rawAck as (res: RoomAck) => void)(res);
        guard(socket, ack, () => {
          if (!session.limiter.allow('entry', now()))
            return ack({ ok: false, error: 'rate_limited' });
          const parsed = schema.safeParse(args[0]);
          if (!parsed.success) return ack({ ok: false, error: 'invalid_payload' });
          handler(parsed.data, ack);
        });
      });
    }

    /** Evento sin acuse: límite de frecuencia, validación y solo entonces el manejador. */
    function onEvent<T>(
      event: string,
      bucket: Bucket,
      schema: Schema<T>,
      handler: (payload: T) => void,
    ): void {
      loose.on(event, (...args: unknown[]) => {
        guard(socket, null, () => {
          // Respuestas y texto se limitan por jugador de la sala; sin sala, por socket.
          const who = bucket === 'answer' || bucket === 'text' ? resolve(session) : null;
          const allowed =
            who && (bucket === 'answer' || bucket === 'text')
              ? allowPlayerBucket(who.room, who.player.id, bucket)
              : session.limiter.allow(bucket, now());
          if (!allowed) return sendError(socket, 'rate_limited');
          const parsed = schema.safeParse(args[0]);
          if (!parsed.success) return sendError(socket, 'invalid_payload');
          handler(parsed.data);
        });
      });
    }

    /**
     * Aplica una acción de jugador y, si el motor la rechaza, avisa solo a quien la envió (salvo los
     * códigos de `QUIET_ERRORS` de ese evento). Antes verifica que el socket pertenezca a una sala.
     */
    function act(event: string, build: (playerId: string) => Action): void {
      const who = resolve(session);
      if (!who) return sendError(socket, 'not_in_room');
      touch(who.room);
      const result = run(who.room, build(who.player.id));
      if (result.error && !QUIET_ERRORS[event]?.includes(result.error)) {
        sendError(socket, result.error);
      }
    }

    onAcked('room:create', roomCreateSchema, (payload, ack) => {
      if (!ipLimiter.allowRoomCreation(session.ip, now())) {
        return ack({ ok: false, error: 'rate_limited' });
      }
      const room = registry.create(createGame(engineConfig, {}));
      // No hay un código de error de "servidor lleno" en el contrato: se reutiliza `room_full`.
      if (!room) return ack({ ok: false, error: 'room_full' });
      touch(room);
      scheduleIdleCheck(room, roomIdleMs);
      enterRoom(session, room, payload, ack, true);
    });

    onAcked('room:join', roomJoinSchema, (payload, ack) => {
      const room = registry.get(payload.code);
      if (!room) return ack({ ok: false, error: 'room_not_found' });
      enterRoom(session, room, payload, ack, false);
    });

    onEvent('room:settings', 'control', roomSettingsSchema, (p) =>
      act('room:settings', (playerId) => ({
        type: 'updateSettings',
        playerId,
        rounds: p.rounds,
        writeSeconds: p.writeSeconds,
      })),
    );
    onEvent('game:start', 'control', emptyPayloadSchema, () =>
      act('game:start', (playerId) => ({ type: 'start', playerId })),
    );
    onEvent('letter:stop', 'control', emptyPayloadSchema, () =>
      act('letter:stop', (playerId) => ({ type: 'stopLetter', playerId })),
    );
    onEvent('answers:update', 'answer', answersUpdateSchema, (p) =>
      act('answers:update', (playerId) => ({
        type: 'updateAnswer',
        playerId,
        category: p.category,
        text: p.text,
      })),
    );
    onEvent('round:stop', 'control', emptyPayloadSchema, () =>
      act('round:stop', (playerId) => ({ type: 'stop', playerId })),
    );
    onEvent('review:vote', 'control', reviewVoteSchema, (p) =>
      act('review:vote', (playerId) => ({
        type: 'vote',
        playerId,
        key: p.key,
        reject: p.reject,
      })),
    );
    onEvent('review:ready', 'control', reviewReadySchema, (p) =>
      act('review:ready', (playerId) => ({ type: 'ready', playerId, ready: p.ready })),
    );
    onEvent('message:send', 'text', messageSendSchema, (p) =>
      act('message:send', (playerId) => ({ type: 'message', playerId, text: p.text })),
    );

    socket.on('disconnect', () => {
      sessions.delete(socket.id);
      broadcastOnlineCount();
      ipLimiter.disconnected(session.ip);
      guard(socket, null, () => {
        const who = resolve(session);
        if (!who) return;
        run(who.room, { type: 'disconnect', playerId: who.player.id, connId: socket.id });
      });
    });
  });

  // --- Arranque y cierre ----------------------------------------------------

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(options.port ?? 0, options.host, () => {
      httpServer.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address() as AddressInfo;
  const host =
    options.host && options.host !== '0.0.0.0' && options.host !== '::'
      ? options.host
      : 'localhost';
  let closing: Promise<void> | null = null;

  return {
    port: address.port,
    url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
    roomCount: () => registry.size,
    close() {
      closing ??= new Promise<void>((resolveClose) => {
        registry.clear();
        io.close(() => resolveClose());
        httpServer.closeAllConnections();
      });
      return closing;
    },
  };
}
