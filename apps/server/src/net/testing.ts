// Ayudas para las pruebas de integración de la red (solo las importan las pruebas).

import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { CATEGORY_IDS } from '@bach/shared';
import type {
  Answers,
  CategoryId,
  ClientToServerEvents,
  RoomAck,
  RoundLetterPayload,
  RoundWritingPayload,
  ServerToClientEvents,
} from '@bach/shared';
import { createGameServer } from './server.js';
import type { GameServer, GameServerOptions } from './server.js';

/** Letras fijas de las pruebas: la ronda n usa la n-ésima. */
export const TEST_LETTERS = ['A', 'B', 'C', 'D'];

const silentLogger = { error: () => undefined, info: () => undefined };

const servers: GameServer[] = [];
const clients: TestClient[] = [];

/** Servidor en un puerto libre y con tiempos cortos (`options.engine` los pisa); se cierra con `closeAll`. */
export async function startServer(options: GameServerOptions = {}): Promise<GameServer> {
  const server = await createGameServer({
    port: 0,
    host: '127.0.0.1',
    webDir: null,
    logger: silentLogger,
    ...options,
    engine: {
      letterSpinMs: 3000,
      letterRevealMs: 150,
      writeMsOverride: 4000,
      stopGraceMs: 150,
      reviewMs: 5000,
      roundEndMs: 300,
      graceMs: 1500,
      lettersOverride: TEST_LETTERS,
      ...options.engine,
    },
  });
  servers.push(server);
  return server;
}

export async function closeAll(): Promise<void> {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((s) => s.close()));
}

interface Entry {
  event: string;
  payload: unknown;
  taken: boolean;
}

interface Waiter {
  event: string;
  predicate: (payload: never) => boolean;
  resolve: (payload: never) => void;
}

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Cliente de pruebas: registra todo lo que recibe y permite esperar eventos sin perderse los ya llegados. */
export class TestClient {
  readonly socket: ClientSocket;
  readonly log: Entry[] = [];
  playerId = '';
  private waiters: Waiter[] = [];

  constructor(url: string, extraHeaders: Record<string, string> = {}) {
    this.socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders,
    });
    this.socket.onAny((event: string, ...args: unknown[]) => this.record(event, args[0]));
    this.socket.on('disconnect', (reason) => this.record('disconnect', reason));
    clients.push(this);
  }

  private record(event: string, payload: unknown): void {
    const entry: Entry = { event, payload, taken: false };
    this.log.push(entry);
    for (const waiter of [...this.waiters]) {
      if (waiter.event !== event || entry.taken || !waiter.predicate(payload as never)) continue;
      entry.taken = true;
      this.waiters = this.waiters.filter((w) => w !== waiter);
      waiter.resolve(payload as never);
    }
  }

  connected(): Promise<this> {
    if (this.socket.connected) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      this.socket.once('connect', () => resolve(this));
      this.socket.once('connect_error', reject);
    });
  }

  /** Espera el primer evento sin consumir que cumpla el predicado (incluso uno ya recibido) y lo consume. */
  waitFor<T = unknown>(
    event: string,
    predicate: (payload: T) => boolean = () => true,
    timeoutMs = 4000,
  ): Promise<T> {
    const index = this.log.findIndex(
      (e) => !e.taken && e.event === event && predicate(e.payload as T),
    );
    const found = this.log[index];
    if (found) {
      found.taken = true;
      return Promise.resolve(found.payload as T);
    }
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        event,
        predicate: predicate as (payload: never) => boolean,
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload as T);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        const seen = this.log
          .slice(-12)
          .map((e) => {
            const code =
              e.event === 'system:error' ? `:${(e.payload as { code: string }).code}` : '';
            return `${e.event}${code}${e.taken ? '' : '*'}`;
          })
          .join(', ');
        reject(new Error(`Timeout esperando "${event}" (últimos eventos: ${seen})`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Eventos recibidos de un tipo, sin importar si ya se consumieron. */
  received<T = unknown>(event: string): T[] {
    return this.log.filter((e) => e.event === event).map((e) => e.payload as T);
  }

  /** Emite con acuse. */
  ack(event: 'room:create' | 'room:join', payload: unknown): Promise<RoomAck> {
    return new Promise((resolve) => {
      (this.socket as unknown as { emit: (...args: unknown[]) => void }).emit(
        event,
        payload,
        (res: RoomAck) => resolve(res),
      );
    });
  }

  emit(event: string, payload?: unknown): void {
    const socket = this.socket as unknown as { emit: (...args: unknown[]) => void };
    if (payload === undefined) socket.emit(event);
    else socket.emit(event, payload);
  }

  close(): void {
    this.socket.disconnect();
  }
}

/** Conecta un cliente; `extraHeaders` simula lo que añadiría un proxy (o un navegador, como `origin`). */
export async function connect(
  server: GameServer,
  extraHeaders: Record<string, string> = {},
): Promise<TestClient> {
  return new TestClient(server.url, extraHeaders).connected();
}

export interface Lobby {
  code: string;
  players: TestClient[];
  names: string[];
  sessionIds: string[];
}

const NAMES = ['Ana', 'Beto', 'Caro', 'Dani'];

export function sessionIdFor(index: number): string {
  return `sesion-de-prueba-${index}`;
}

/** Crea una sala con `count` jugadores conectados; el primero es el anfitrión. */
export async function createLobby(server: GameServer, count = 3): Promise<Lobby> {
  const players: TestClient[] = [];
  let code = '';
  for (let i = 0; i < count; i++) {
    const client = await connect(server);
    const name = NAMES[i] ?? `Jugador${i}`;
    const payload = { name, sessionId: sessionIdFor(i) };
    const res =
      i === 0
        ? await client.ack('room:create', payload)
        : await client.ack('room:join', { ...payload, code });
    if (!res.ok) throw new Error(`No se pudo entrar a la sala: ${res.error}`);
    client.playerId = res.playerId;
    if (i === 0) code = res.code;
    players.push(client);
  }
  // Cada uno debe haber recibido su foto antes de seguir.
  await Promise.all(players.map((p) => p.waitFor('room:state')));
  return {
    code,
    players,
    names: players.map((_, i) => NAMES[i] ?? `Jugador${i}`),
    sessionIds: players.map((_, i) => sessionIdFor(i)),
  };
}

export function playerById(lobby: Lobby, id: string): TestClient {
  const found = lobby.players.find((p) => p.playerId === id);
  if (!found) throw new Error(`No hay jugador ${id}`);
  return found;
}

/** Espera a que el servidor haya procesado todo lo anterior de este cliente (un mensaje de ida y vuelta; solo vale con chat abierto). */
export async function sync(client: TestClient, marker: string): Promise<void> {
  client.emit('message:send', { text: marker });
  await client.waitFor<{ text: string }>('message:new', (m) => m.text === marker);
}

/** Hoja de respuestas de `index` para `letter`: cada categoría con un texto propio y reconocible. */
export function sheetOf(letter: string, index: number, overrides: Answers = {}): Answers {
  const sheet: Answers = {};
  for (const id of CATEGORY_IDS) sheet[id] = `${letter}x${index}${id}`;
  return { ...sheet, ...overrides };
}

/** Envía cada respuesta de la hoja y espera a que el servidor haya contado la última. */
export async function fillSheet(client: TestClient, sheet: Answers): Promise<void> {
  const entries = Object.entries(sheet) as [CategoryId, string][];
  for (const [category, text] of entries) client.emit('answers:update', { category, text });
  const filled = entries.filter(([, text]) => text.trim() !== '').length;
  await client.waitFor<{ playerId: string; filled: number }>(
    'round:progress',
    (p) => p.playerId === client.playerId && p.filled === filled,
  );
}

/**
 * Inicia la partida (el anfitrión es el primero) o la ronda siguiente ya en curso: espera la
 * ruleta, hace que el picker la detenga y espera el inicio de la escritura de todos.
 */
export async function reachWriting(lobby: Lobby): Promise<{
  picker: TestClient;
  letter: string;
}> {
  const [letterEvent] = await Promise.all(
    lobby.players.map((p) => p.waitFor<RoundLetterPayload>('round:letter')),
  );
  const picker = playerById(lobby, letterEvent?.pickerId ?? '');
  picker.emit('letter:stop');
  const writing = await Promise.all(
    lobby.players.map((p) => p.waitFor<RoundWritingPayload>('round:writing')),
  );
  return { picker, letter: writing[0]?.letter ?? '' };
}
