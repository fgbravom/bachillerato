import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_IDS } from '@bach/shared';
import type {
  Answers,
  GameEndPayload,
  MessageNewPayload,
  Player,
  ReviewCategoryPayload,
  ReviewUpdatePayload,
  RoomState,
  RoundEndPayload,
  RoundStoppedPayload,
  SystemErrorPayload,
  SystemOnlinePayload,
} from '@bach/shared';
import {
  closeAll,
  connect,
  createLobby,
  fillSheet,
  playerById,
  reachWriting,
  sheetOf,
  startServer,
  sync,
} from './testing.js';
import type { TestClient } from './testing.js';

afterEach(closeAll);

/** Errores recibidos por un cliente, en orden. */
const errorsOf = (client: TestClient): string[] =>
  client.received<SystemErrorPayload>('system:error').map((e) => e.code);

/** Respuestas de cada jugador en la partida de prueba (ronda 1 = letra A, ronda 2 = letra B). */
function answersFor(round: number, index: number): Answers {
  const letter = round === 1 ? 'A' : 'B';
  const overrides: Answers = {};
  // Dos jugadores repiten "lugar": 50 puntos cada uno.
  if (index <= 1) overrides.lugar = `${letter}shared`;
  // En la ronda 1 el tercero se equivoca de letra en "cosa" (queda anulada).
  if (round === 1 && index === 2) overrides.cosa = 'Zorro';
  return sheetOf(letter, index, overrides);
}

/** Todas las respuestas escritas en la partida, para vigilar que no se filtren. */
function secretsOf(index: number): string[] {
  return [1, 2].flatMap((round) => Object.values(answersFor(round, index)));
}

describe('partida completa', () => {
  it('juega 2 rondas de 3 jugadores hasta el podio sin filtrar respuestas durante WRITING', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 3);
    const [host, p1, p2] = lobby.players;
    if (!host || !p1 || !p2) throw new Error('faltan jugadores');

    host.emit('room:settings', { rounds: 2, writeSeconds: 30 });
    await host.waitFor<RoomState>('room:state', (s) => s.settings.rounds === 2);
    host.emit('game:start');

    // --- Ronda 1 ---
    const first = await reachWriting(lobby);
    expect(first.letter).toBe('A');
    for (const [i, p] of lobby.players.entries()) await fillSheet(p, answersFor(1, i));

    // El avance de los demás sí es visible, pero solo como conteo.
    const progress = p1.received<{ playerId: string; filled: number }>('round:progress');
    expect(progress.some((e) => e.playerId === host.playerId && e.filled === 7)).toBe(true);

    // p1 grita STOP; p2 tiene una respuesta con letra equivocada pero igual puede quedar cerrado.
    p1.emit('round:stop');
    const stops = await Promise.all(
      lobby.players.map((p) => p.waitFor<RoundStoppedPayload>('round:stopped')),
    );
    expect(stops.every((s) => s.by === p1.playerId)).toBe(true);

    // Revisión: las 7 categorías, una a la vez.
    for (let i = 0; i < CATEGORY_IDS.length; i++) {
      const cats = await Promise.all(
        lobby.players.map((p) => p.waitFor<ReviewCategoryPayload>('review:category')),
      );
      const cat = cats[0];
      expect(cat?.category).toBe(CATEGORY_IDS[i]);
      expect(cat?.index).toBe(i);
      expect(cat?.total).toBe(7);

      if (cat?.category === 'cosa') {
        // Votar la propia respuesta es un error visible; votar la anulada (wrong_letter) es una
        // carrera silenciosa ("unknown_answer").
        host.emit('review:vote', { key: 'ax0cosa', reject: true });
        await host.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'own_answer');
        host.emit('review:vote', { key: 'zorro', reject: true });
        await sync(host, 'tras-voto-silencioso');
        expect(errorsOf(host)).toEqual(['own_answer']);
      }
      if (cat?.category === 'fruta') {
        // Dos de dos votantes posibles rechazan la fruta del anfitrión.
        const key = 'ax0fruta';
        p1.emit('review:vote', { key, reject: true });
        p2.emit('review:vote', { key, reject: true });
        const update = await host.waitFor<ReviewUpdatePayload>(
          'review:update',
          (u) => u.groups.find((g) => g.key === key)?.status === 'rejected',
        );
        expect(update.category).toBe('fruta');
        expect(update.groups.find((g) => g.key === key)?.points).toBe(0);
      }
      for (const p of lobby.players) p.emit('review:ready', { ready: true });
    }

    const ends1 = await Promise.all(
      lobby.players.map((p) => p.waitFor<RoundEndPayload>('round:end')),
    );
    const end1 = ends1[0];
    expect(end1?.letter).toBe('A');
    expect(end1?.stoppedBy).toBe(p1.playerId);
    // host: 7 categorías, lugar repetido (50) y fruta rechazada (0): 5 x 100 + 50.
    expect(end1?.gains[host.playerId]).toBe(550);
    expect(end1?.gains[p1.playerId]).toBe(650);
    // p2: "cosa" anulada por letra equivocada.
    expect(end1?.gains[p2.playerId]).toBe(600);

    // --- Ronda 2 (arranca sola tras el fin de ronda) ---
    const second = await reachWriting(lobby);
    expect(second.letter).toBe('B');
    expect(second.picker).not.toBe(first.picker); // el picker rota
    for (const [i, p] of lobby.players.entries()) await fillSheet(p, answersFor(2, i));
    host.emit('round:stop');
    await Promise.all(lobby.players.map((p) => p.waitFor<RoundStoppedPayload>('round:stopped')));
    for (let i = 0; i < CATEGORY_IDS.length; i++) {
      await Promise.all(
        lobby.players.map((p) => p.waitFor<ReviewCategoryPayload>('review:category')),
      );
      for (const p of lobby.players) p.emit('review:ready', { ready: true });
    }
    const ends2 = await Promise.all(
      lobby.players.map((p) => p.waitFor<RoundEndPayload>('round:end')),
    );
    const end2 = ends2[0];
    expect(end2?.letter).toBe('B');
    expect(end2?.stoppedBy).toBe(host.playerId);

    // --- Podio ---
    const finals = await Promise.all(
      lobby.players.map((p) => p.waitFor<GameEndPayload>('game:end')),
    );
    const ranking = finals[0]?.ranking ?? [];
    expect(ranking).toHaveLength(3);
    expect(ranking[0]?.rank).toBe(1);
    for (const entry of ranking) expect(entry.score).toBe(end2?.scores[entry.playerId]);
    expect(ranking.map((r) => r.score)).toEqual(
      [...ranking.map((r) => r.score)].sort((a, b) => b - a),
    );
    // Todos vieron el mismo podio.
    for (const f of finals) expect(f.ranking).toEqual(ranking);

    // "Jugar de nuevo": desde GAME_END el anfitrión vuelve a la sala de espera.
    host.emit('game:start');
    const back = await host.waitFor<RoomState>('room:state', (s) => s.phase === 'LOBBY');
    expect(back.round).toBe(0);

    // (a) Privacidad: en ninguna ventana de escritura llegó a nadie una respuesta ajena.
    for (const [i, p] of lobby.players.entries()) {
      const own = new Set(secretsOf(i));
      const forbidden = lobby.players
        .flatMap((_, j) => (j === i ? [] : secretsOf(j)))
        .filter((text) => !own.has(text));
      let guarding = false;
      let guardedEvents = 0;
      for (const entry of p.log) {
        if (entry.event === 'round:letter') guarding = true;
        else if (['review:category', 'round:end', 'game:end'].includes(entry.event)) {
          guarding = false;
        }
        if (!guarding) continue;
        guardedEvents++;
        const body = JSON.stringify(entry.payload ?? null).toLowerCase();
        for (const text of forbidden) {
          expect(body, `${entry.event} de ${lobby.names[i]} trae "${text}"`).not.toContain(
            text.toLowerCase(),
          );
        }
      }
      expect(guardedEvents).toBeGreaterThan(5); // la vigilancia sí miró eventos
    }
  }, 30_000);
});

describe('permisos y reglas del motor', () => {
  it('solo el anfitrión inicia y cambia ajustes; solo el picker detiene la ruleta', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 3);
    const [host, g1, g2] = lobby.players;
    if (!host || !g1 || !g2) throw new Error('faltan jugadores');

    g1.emit('game:start');
    expect((await g1.waitFor<SystemErrorPayload>('system:error')).code).toBe('not_host');
    g1.emit('room:settings', { rounds: 3, writeSeconds: 60 });
    expect((await g1.waitFor<SystemErrorPayload>('system:error')).code).toBe('not_host');
    // Fuera de fase, `wrong_phase` de la ruleta y de las respuestas se calla (carrera normal).
    g1.emit('letter:stop');
    g1.emit('answers:update', { category: 'nombre', text: 'Ana' });
    await sync(g1, 'sigo-en-el-lobby');
    expect(errorsOf(g1)).toEqual(['not_host', 'not_host']);

    // Ajustes del anfitrión: válidos se aplican a todos, inválidos no pasan.
    host.emit('room:settings', { rounds: 3, writeSeconds: 60 });
    const state = await g2.waitFor<RoomState>('room:state', (s) => s.settings.rounds === 3);
    expect(state.settings).toEqual({ rounds: 3, writeSeconds: 60 });
    host.emit('room:settings', { rounds: 11, writeSeconds: 60 });
    expect((await host.waitFor<SystemErrorPayload>('system:error')).code).toBe('invalid_payload');

    host.emit('game:start');
    const letters = await Promise.all(
      lobby.players.map((p) => p.waitFor<{ pickerId: string }>('round:letter')),
    );
    const picker = playerById(lobby, letters[0]?.pickerId ?? '');
    const others = lobby.players.filter((p) => p !== picker);

    // Ajustes en plena ronda: wrong_phase visible; chat en LETTER: wrong_phase visible.
    host.emit('room:settings', { rounds: 5, writeSeconds: 60 });
    expect((await host.waitFor<SystemErrorPayload>('system:error')).code).toBe('wrong_phase');
    others[0]?.emit('message:send', { text: 'hola' });
    expect((await others[0]?.waitFor<SystemErrorPayload>('system:error'))?.code).toBe(
      'wrong_phase',
    );

    // Quien no es picker no puede detener la ruleta.
    for (const o of others) {
      o.emit('letter:stop');
      expect(
        (await o.waitFor<SystemErrorPayload>('system:error', (e) => e.code === 'not_picker')).code,
      ).toBe('not_picker');
    }
    expect(picker.received('round:letter-chosen')).toHaveLength(0);
    // Y el picker sí.
    picker.emit('letter:stop');
    const chosen = await Promise.all(
      lobby.players.map((p) => p.waitFor<{ letter: string }>('round:letter-chosen')),
    );
    expect(chosen.every((c) => c.letter === 'A')).toBe(true);
    // Un segundo "stop" del picker llega tarde: carrera silenciosa.
    const errorsBefore = errorsOf(picker).length;
    picker.emit('letter:stop');
    await Promise.all(lobby.players.map((p) => p.waitFor('round:writing')));
    expect(errorsOf(picker)).toHaveLength(errorsBefore);
  });

  it('la ruleta se detiene sola si nadie la detiene', async () => {
    const server = await startServer({ engine: { letterSpinMs: 200 } });
    const lobby = await createLobby(server, 2);
    lobby.players[0]?.emit('game:start');
    for (const p of lobby.players) {
      expect((await p.waitFor<{ letter: string }>('round:letter-chosen')).letter).toBe('A');
      await p.waitFor('round:writing');
    }
  });

  it('STOP con la hoja incompleta devuelve sheet_incomplete; completa y con letra, cierra', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');
    host.emit('game:start');
    await reachWriting(lobby);

    // Hoja vacía.
    host.emit('round:stop');
    expect((await host.waitFor<SystemErrorPayload>('system:error')).code).toBe('sheet_incomplete');

    // Seis de siete.
    const sheet = sheetOf('A', 0);
    const { cantante, ...six } = sheet;
    await fillSheet(host, six);
    host.emit('round:stop');
    expect((await host.waitFor<SystemErrorPayload>('system:error')).code).toBe('sheet_incomplete');

    // Siete, pero una no empieza con la letra.
    await fillSheet(host, { ...six, cantante: 'Zeta' });
    host.emit('round:stop');
    expect((await host.waitFor<SystemErrorPayload>('system:error')).code).toBe('sheet_incomplete');
    expect(host.received('round:stopped')).toHaveLength(0);

    // Corregida: el STOP vale.
    // Mismo socket, mismo orden: el STOP llega después de la respuesta (el conteo no cambia, 7 de 7).
    host.emit('answers:update', { category: 'cantante', text: cantante });
    host.emit('round:stop');
    const stopped = await guest.waitFor<RoundStoppedPayload>('round:stopped');
    expect(stopped.by).toBe(host.playerId);

    // Las últimas teclas tras el STOP caben en la gracia; un STOP repetido es carrera silenciosa.
    guest.emit('answers:update', { category: 'nombre', text: 'Ana' });
    guest.emit('round:stop');
    await guest.waitFor('review:category');
    // Y ya en revisión una respuesta tardía se descarta sin error.
    guest.emit('answers:update', { category: 'nombre', text: 'Tarde' });
    await sync(guest, 'ya-en-revision');
    expect(errorsOf(guest)).toEqual([]);
  });

  it('quien llega a mitad de ronda mira sin poder escribir ni votar', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    lobby.players[0]?.emit('game:start');
    await reachWriting(lobby);

    const late = await connect(server);
    const res = await late.ack('room:join', {
      code: lobby.code,
      name: 'Tarde',
      sessionId: 'sesion-tardia-1',
    });
    expect(res.ok).toBe(true);
    const state = await late.waitFor<RoomState>('room:state');
    expect(state.phase).toBe('WRITING');
    expect(state.myAnswers).toBeNull();
    late.emit('answers:update', { category: 'nombre', text: 'Ana' });
    expect((await late.waitFor<SystemErrorPayload>('system:error')).code).toBe('not_playing');
  });
});

describe('reconexión y sesiones', () => {
  it('quien se reconecta en WRITING recibe room:state con sus propias respuestas y nada ajeno', async () => {
    const server = await startServer({ engine: { writeMsOverride: 8000 } });
    const lobby = await createLobby(server, 3);
    const [host, leaver, other] = lobby.players;
    if (!host || !leaver || !other) throw new Error('faltan jugadores');
    host.emit('game:start');
    await reachWriting(lobby);

    const own = { nombre: 'Aaron', lugar: 'Antofagasta', animal: 'Alpaca' };
    await fillSheet(leaver, own);
    await fillSheet(other, { nombre: 'Aleatorio-ajeno', fruta: 'Arandano' });
    await other.waitFor(
      'round:progress',
      (p: { playerId: string }) => p.playerId === leaver.playerId,
    );

    leaver.close();
    await host.waitFor<Player>('player:updated', (p) => p.id === leaver.playerId && !p.connected);

    const back = await connect(server);
    const res = await back.ack('room:join', {
      code: lobby.code,
      name: lobby.names[1],
      sessionId: lobby.sessionIds[1],
    });
    expect(res).toEqual({ ok: true, code: lobby.code, playerId: leaver.playerId });
    back.playerId = leaver.playerId;
    const state = await back.waitFor<RoomState>('room:state');
    expect(state.selfId).toBe(leaver.playerId);
    expect(state.phase).toBe('WRITING');
    expect(state.letter).toBe('A');
    expect(state.myAnswers).toEqual(own);
    expect(state.endsAt).toBeGreaterThan(state.serverNow);
    const raw = JSON.stringify(state);
    expect(raw).not.toContain('Aleatorio-ajeno');
    expect(raw).not.toContain('Arandano');
    expect(raw).not.toContain(lobby.sessionIds[1] ?? 'sin-sesion');
    expect(state.players.every((p) => p.connected)).toBe(true);

    // Y puede seguir escribiendo con el socket nuevo.
    await fillSheet(back, { ...own, cosa: 'Azul' });
  });

  it('emite system:online con la cantidad de conexiones activas', async () => {
    const server = await startServer();
    const a = await connect(server);
    expect(await a.waitFor<SystemOnlinePayload>('system:online')).toEqual({ count: 1 });

    const b = await connect(server);
    expect(await a.waitFor<SystemOnlinePayload>('system:online', (p) => p.count === 2)).toEqual({
      count: 2,
    });
    expect(await b.waitFor<SystemOnlinePayload>('system:online', (p) => p.count === 2)).toEqual({
      count: 2,
    });

    a.close();
    expect(await b.waitFor<SystemOnlinePayload>('system:online', (p) => p.count === 1)).toEqual({
      count: 1,
    });
    b.close();
    const c = await connect(server);
    expect(await c.waitFor<SystemOnlinePayload>('system:online')).toEqual({ count: 1 });
  });

  it('entrar con la misma sesión desde otro socket cierra el anterior', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 3);
    const [first, other] = lobby.players;
    if (!first || !other) throw new Error('faltan jugadores');

    const second = await connect(server);
    const res = await second.ack('room:join', {
      code: lobby.code,
      name: lobby.names[0],
      sessionId: lobby.sessionIds[0],
    });
    expect(res).toEqual({ ok: true, code: lobby.code, playerId: first.playerId });
    expect(await first.waitFor('disconnect')).toBe('io server disconnect');
    const state = await second.waitFor<RoomState>('room:state');
    expect(state.selfId).toBe(first.playerId);

    // El cierre del socket viejo no marcó al jugador como caído.
    await sync(other, 'sigue-ahi');
    expect(
      other.received<Player>('player:updated').filter((p) => p.id === first.playerId),
    ).toHaveLength(0);
    second.emit('message:send', { text: 'hola desde el nuevo' });
    await other.waitFor<MessageNewPayload>('message:new', (m) => m.text === 'hola desde el nuevo');
  });

  it('al entrar a otra sala se sale de la anterior', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');

    const res = await guest.ack('room:create', { name: 'Beto', sessionId: 'otra-sesion-1' });
    expect(res.ok).toBe(true);
    const left = await host.waitFor<Player>('player:left');
    expect(left.id).toBe(guest.playerId);
    expect(server.roomCount()).toBe(2);
  });
});

describe('payloads inválidos y errores', () => {
  it('responde room_not_found e invalid_payload por ack', async () => {
    const server = await startServer();
    const client = await connect(server);
    expect(
      await client.ack('room:join', { code: 'ZZZZ', name: 'Ana', sessionId: 'sesion-de-prueba-0' }),
    ).toEqual({ ok: false, error: 'room_not_found' });
    expect(
      await client.ack('room:join', { code: 'zz', name: 'Ana', sessionId: 'sesion-de-prueba-0' }),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(await client.ack('room:create', { name: 'x', sessionId: 'sesion-de-prueba-0' })).toEqual(
      {
        ok: false,
        error: 'invalid_payload',
      },
    );
    // Otro socket: el primero ya gastó la ráfaga de entradas.
    const other = await connect(server);
    expect(await other.ack('room:create', 'hola')).toEqual({ ok: false, error: 'invalid_payload' });
    expect(server.roomCount()).toBe(0);
  });

  it('exige estar en una sala para cualquier evento', async () => {
    const server = await startServer();
    const stranger = await connect(server);
    const events: [string, unknown?][] = [
      ['message:send', { text: 'hola' }],
      ['game:start'],
      ['letter:stop'],
      ['answers:update', { category: 'nombre', text: 'Ana' }],
      ['round:stop'],
      ['review:vote', { key: 'ana', reject: true }],
      ['review:ready', { ready: true }],
      ['room:settings', { rounds: 3, writeSeconds: 60 }],
    ];
    for (const [event, payload] of events) stranger.emit(event, payload);
    await vi.waitFor(() => expect(errorsOf(stranger)).toHaveLength(events.length), {
      timeout: 3000,
    });
    expect(new Set(errorsOf(stranger))).toEqual(new Set(['not_in_room']));
  });

  it('devuelve invalid_payload ante datos malformados y el servidor sigue en pie', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');

    const bad: [string, unknown?][] = [
      ['message:send', { text: 123 }],
      ['message:send', { text: '   ' }],
      ['message:send', { text: 'x'.repeat(81) }],
      ['message:send', null],
      ['message:send'],
      ['answers:update', { category: 'otra', text: 'Ana' }],
      ['answers:update', { category: 'nombre', text: 42 }],
      ['answers:update', { category: 'nombre', text: 'a'.repeat(31) }],
      ['answers:update', { category: 'nombre', text: 'Ana\u0007Maria' }],
      ['answers:update', 'nombre'],
      ['review:vote', { key: '', reject: true }],
      ['review:vote', { key: 'ana', reject: 'si' }],
      ['review:vote', { key: 'a'.repeat(31), reject: true }],
      ['review:ready', { ready: 1 }],
      ['review:ready', {}],
      ['room:settings', { rounds: 0, writeSeconds: 60 }],
      ['room:settings', { rounds: 3, writeSeconds: 29 }],
      ['room:settings', { rounds: 3.5, writeSeconds: 60 }],
      ['room:settings', { rounds: 3 }],
      ['game:start', { extra: true }],
      ['letter:stop', 'ya'],
      ['round:stop', 7],
    ];
    for (const [event, payload] of bad) {
      host.emit(event, payload);
      // Un respiro por mensaje para no chocar con los topes de frecuencia (el chat admite 3 por segundo).
      await new Promise((r) => setTimeout(r, event === 'message:send' ? 340 : 60));
    }
    await vi.waitFor(() => expect(errorsOf(host)).toHaveLength(bad.length), { timeout: 5000 });
    expect(new Set(errorsOf(host))).toEqual(new Set(['invalid_payload']));

    // Un mensaje enorme corta esa conexión (tope de Socket.IO) pero no al servidor.
    guest.emit('message:send', { text: 'x'.repeat(40_000) });
    await guest.waitFor('disconnect');
    const again = await connect(server);
    expect(
      (
        await again.ack('room:join', {
          code: lobby.code,
          name: 'Otro',
          sessionId: 'sesion-nueva-1',
        })
      ).ok,
    ).toBe(true);
    host.emit('message:send', { text: 'sigo vivo' });
    await again.waitFor<MessageNewPayload>('message:new', (m) => m.text === 'sigo vivo');
  }, 15_000);

  it('limita las salas simultáneas', async () => {
    const server = await startServer({ maxRooms: 1 });
    const a = await connect(server);
    const b = await connect(server);
    expect((await a.ack('room:create', { name: 'Ana', sessionId: 'sesion-de-prueba-0' })).ok).toBe(
      true,
    );
    expect(await b.ack('room:create', { name: 'Beto', sessionId: 'sesion-de-prueba-1' })).toEqual({
      ok: false,
      error: 'room_full',
    });
  });
});

describe('ciclo de vida de la sala', () => {
  it('borra la sala al quedar sin jugadores, una vez vencida la gracia', async () => {
    const server = await startServer({ engine: { graceMs: 300 } });
    const lobby = await createLobby(server, 3);
    expect(server.roomCount()).toBe(1);
    for (const p of lobby.players) p.close();

    await vi.waitFor(() => expect(server.roomCount()).toBe(0), { timeout: 3000, interval: 50 });
    const late = await connect(server);
    expect(
      await late.ack('room:join', {
        code: lobby.code,
        name: 'Ana',
        sessionId: lobby.sessionIds[0],
      }),
    ).toEqual({ ok: false, error: 'room_not_found' });
  });

  it('quedar con menos de 2 jugadores en plena ronda devuelve la sala a LOBBY', async () => {
    const server = await startServer();
    const lobby = await createLobby(server, 2);
    const [host, guest] = lobby.players;
    if (!host || !guest) throw new Error('faltan jugadores');
    host.emit('game:start');
    await reachWriting(lobby);
    guest.close();
    // Pasada la gracia el jugador se borra y la sala queda con uno solo.
    const state = await host.waitFor<RoomState>('room:state', (s) => s.phase === 'LOBBY', 5000);
    expect(state.players).toHaveLength(1);
  });
});
