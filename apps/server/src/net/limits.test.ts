// Pruebas de red de los topes de abuso: inactividad, IP, frecuencia por jugador y origen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageNewPayload, RoomState, SystemErrorPayload } from '@bach/shared';
import {
  TestClient,
  closeAll,
  connect,
  createLobby,
  reachWriting,
  startServer,
  sync,
} from './testing.js';

afterEach(closeAll);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const errorsOf = (client: TestClient): string[] =>
  client.received<SystemErrorPayload>('system:error').map((e) => e.code);

/** Resultado de intentar conectar: el mensaje del rechazo o "connected". */
function tryConnect(server: { url: string }, headers: Record<string, string> = {}) {
  return new Promise<string>((resolve) => {
    const client = new TestClient(server.url, headers);
    client.socket.once('connect', () => resolve('connected'));
    client.socket.once('connect_error', (e) => resolve(e.message));
  });
}

describe('salas abandonadas', () => {
  it('cierra una sala en LOBBY sin acciones, avisa con room_not_found y limpia la sesión', async () => {
    const server = await startServer({ roomIdleMs: 800 });
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');

    const isGone = (e: SystemErrorPayload) => e.code === 'room_not_found';
    await host.waitFor<SystemErrorPayload>('system:error', isGone, 4000);
    await guest.waitFor<SystemErrorPayload>('system:error', isGone, 4000);
    expect(server.roomCount()).toBe(0);

    // La sesión quedó limpia: el socket ya no pertenece a ninguna sala.
    host.emit('message:send', { text: 'hola' });
    await host.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'not_in_room');
  });

  it('la actividad de los jugadores aplaza el cierre', async () => {
    const server = await startServer({ roomIdleMs: 1000 });
    const lobby = await createLobby(server, 2);
    const [host] = lobby.players;
    if (!host) throw new Error('falta el anfitrión');
    for (let i = 0; i < 5; i++) {
      await wait(300);
      host.emit('room:settings', { rounds: 2 + (i % 2), writeSeconds: 60 }); // una acción de control
    }
    await sync(host, 'sigo-aqui');
    expect(server.roomCount()).toBe(1); // 1,5 s en total, con un plazo de 1 s
    await host.waitFor<SystemErrorPayload>(
      'system:error',
      (e) => e.code === 'room_not_found',
      4000,
    );
    expect(server.roomCount()).toBe(0);
  }, 15_000);

  it('no cierra una sala con una ronda en marcha', async () => {
    const server = await startServer({ roomIdleMs: 600, engine: { writeMsOverride: 5000 } });
    const lobby = await createLobby(server, 2);
    lobby.players[0]?.emit('game:start');
    await reachWriting(lobby);
    await wait(1000);
    expect(server.roomCount()).toBe(1);
    expect(lobby.players[0]?.received('system:error')).toHaveLength(0);
  });
});

describe('topes por IP', () => {
  it('rechaza la conexión que excede el máximo de conexiones simultáneas', async () => {
    const server = await startServer({ maxConnectionsPerIp: 2 });
    await connect(server);
    const second = await connect(server);
    expect(await tryConnect(server)).toBe('too_many_connections');
    // Al cerrar una se libera un cupo.
    second.close();
    await vi.waitFor(async () => expect(await tryConnect(server)).toBe('connected'), {
      timeout: 3000,
      interval: 50,
    });
  });

  it('sin cabecera configurada no se confía en ninguna cabecera de IP', async () => {
    const server = await startServer({ maxConnectionsPerIp: 1 });
    await connect(server, { 'x-test-ip': '1.1.1.1' });
    expect(await tryConnect(server, { 'x-test-ip': '2.2.2.2' })).toBe('too_many_connections');
  });

  it('con cabecera configurada cuenta por la IP que trae', async () => {
    const server = await startServer({ maxConnectionsPerIp: 1, clientIpHeader: 'X-Test-IP' });
    await connect(server, { 'x-test-ip': '1.1.1.1' });
    await connect(server, { 'x-test-ip': '2.2.2.2' });
    expect(await tryConnect(server, { 'x-test-ip': '1.1.1.1' })).toBe('too_many_connections');
  });

  it('responde rate_limited a room:create si la IP creó demasiadas salas por minuto', async () => {
    const server = await startServer({ maxRoomsPerIpPerMinute: 2, clientIpHeader: 'x-test-ip' });
    const create = async (index: number, ip: string) => {
      const client = await connect(server, { 'x-test-ip': ip });
      return client.ack('room:create', { name: 'Ana', sessionId: `sesion-de-ip-${index}` });
    };
    expect((await create(0, '1.1.1.1')).ok).toBe(true);
    expect((await create(1, '1.1.1.1')).ok).toBe(true);
    expect(await create(2, '1.1.1.1')).toEqual({ ok: false, error: 'rate_limited' });
    expect((await create(3, '2.2.2.2')).ok).toBe(true); // otra IP
    expect(server.roomCount()).toBe(3);
  });
});

describe('frecuencia de entrada y por jugador', () => {
  it('room:join y room:create comparten una cubeta de 3 en ráfaga, separada de la de control', async () => {
    const server = await startServer();
    const [host] = (await createLobby(server, 1)).players; // el create gastó 1 ficha
    if (!host) throw new Error('falta el anfitrión');
    const join = () =>
      host.ack('room:join', { code: 'ZZZZ', name: 'Ana', sessionId: 'sesion-de-prueba-9' });
    expect(await join()).toEqual({ ok: false, error: 'room_not_found' });
    expect(await join()).toEqual({ ok: false, error: 'room_not_found' });
    expect(await join()).toEqual({ ok: false, error: 'rate_limited' });
    expect(await host.ack('room:create', { name: 'Ana', sessionId: 'sesion-de-prueba-9' })).toEqual(
      { ok: false, error: 'rate_limited' },
    );

    // Los eventos de control siguen funcionando.
    host.emit('room:settings', { rounds: 5, writeSeconds: 60 });
    await host.waitFor<RoomState>('room:state', (s) => s.settings.rounds === 5);
  });

  it('descarta con rate_limited lo que excede los mensajes de chat por segundo', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [spammer, other] = lobby.players;
    if (!spammer || !other) throw new Error('faltan jugadores');
    for (let i = 0; i < 12; i++) spammer.emit('message:send', { text: `spam ${i}` });
    const err = await spammer.waitFor<SystemErrorPayload>('system:error');
    expect(err.code).toBe('rate_limited');
    await sync(other, 'fin-del-spam');
    const delivered = other
      .received<MessageNewPayload>('message:new')
      .filter((m) => m.text.startsWith('spam'));
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.length).toBeLessThan(12);
  });

  it('descarta con rate_limited los answers:update por encima de 20 por segundo', async () => {
    const server = await startServer({ engine: { writeMsOverride: 6000 } });
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');
    host.emit('game:start');
    await reachWriting(lobby);

    // 60 envíos seguidos: la cubeta (20) deja pasar la ráfaga y corta el resto.
    const categories = ['nombre', 'lugar', 'cosa', 'fruta', 'animal', 'tv', 'cantante'] as const;
    for (let i = 0; i < 60; i++) {
      host.emit('answers:update', { category: categories[i % 7], text: `A${i}` });
    }
    await host.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'rate_limited');
    // Lo que sí alcanzó a entrar se contó: el avance llegó a 7 (los primeros 20 cubren las 7 categorías).
    await guest.waitFor('round:progress', (p: { filled: number }) => p.filled === 7);
    // Los envíos descartados no generaron más errores que rate_limited.
    expect(new Set(errorsOf(host))).toEqual(new Set(['rate_limited']));
  });

  it('descarta con rate_limited los eventos de control por encima del tope', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [, guest] = lobby.players;
    if (!guest) throw new Error('falta el invitado');
    // `wrong_phase` de la ruleta se calla; lo único que puede volver es el límite de frecuencia.
    for (let i = 0; i < 40; i++) guest.emit('letter:stop');
    await guest.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'rate_limited');
    expect(new Set(errorsOf(guest))).toEqual(new Set(['rate_limited']));
  });

  it('cambiar de socket con la misma sesión no rellena la cubeta de texto', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [first] = lobby.players;
    if (!first) throw new Error('falta el jugador');
    for (let i = 0; i < 8; i++) first.emit('message:send', { text: `spam ${i}` });
    await first.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'rate_limited');

    const second = await connect(server);
    const res = await second.ack('room:join', {
      code: lobby.code,
      name: lobby.names[0],
      sessionId: lobby.sessionIds[0],
    });
    expect(res.ok).toBe(true);
    // Tres seguidos caben en una cubeta recién llena, no en una que solo se recargó un instante.
    for (let i = 0; i < 3; i++) second.emit('message:send', { text: `ya ${i}?` });
    const err = await second.waitFor<SystemErrorPayload>('system:error');
    expect(err.code).toBe('rate_limited');
  });

  it('cambiar de socket tampoco rellena la cubeta de respuestas', async () => {
    const server = await startServer({ engine: { writeMsOverride: 6000 } });
    const lobby = await createLobby(server, 2);
    lobby.players[0]?.emit('game:start');
    await reachWriting(lobby);
    const [first] = lobby.players;
    if (!first) throw new Error('falta el jugador');
    for (let i = 0; i < 60; i++)
      first.emit('answers:update', { category: 'nombre', text: `A${i}` });
    await first.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'rate_limited');

    const second = await connect(server);
    const res = await second.ack('room:join', {
      code: lobby.code,
      name: lobby.names[0],
      sessionId: lobby.sessionIds[0],
    });
    expect(res.ok).toBe(true);
    // Una ráfaga que una cubeta recién llena (20) dejaría pasar entera, pero no una vacía que
    // solo se recargó durante el cambio de socket.
    for (let i = 0; i < 18; i++)
      second.emit('answers:update', { category: 'lugar', text: `A${i}` });
    const err = await second.waitFor<SystemErrorPayload>('system:error');
    expect(err.code).toBe('rate_limited');
  });
});

describe('origen de las conexiones', () => {
  it('con checkOrigin rechaza un Origin con otro host y acepta el propio o la ausencia de Origin', async () => {
    const server = await startServer({ checkOrigin: true });
    expect(await tryConnect(server, { origin: 'https://evil.example' })).not.toBe('connected');
    expect(await tryConnect(server, { origin: 'null' })).not.toBe('connected');
    expect(await tryConnect(server, { origin: server.url })).toBe('connected');
    expect(await tryConnect(server, {})).toBe('connected');
  });

  it('acepta los orígenes de allowedOrigins aunque el host no coincida', async () => {
    const server = await startServer({
      checkOrigin: true,
      allowedOrigins: ['https://juego.example.com/'],
    });
    expect(await tryConnect(server, { origin: 'https://juego.example.com' })).toBe('connected');
    expect(await tryConnect(server, { origin: 'https://otro.example.com' })).not.toBe('connected');
  });

  it('sin checkOrigin (fuera de producción) no filtra', async () => {
    const server = await startServer();
    expect(await tryConnect(server, { origin: 'https://evil.example' })).toBe('connected');
  });
});
