import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX_LENGTH } from '@bach/shared';
import {
  createHarness,
  emitsOf,
  fill,
  groupsNow,
  snapshotsOf,
  startedGame,
  toReview,
  toWriting,
  vote,
  write,
  writingGame,
  readyAll,
} from './testing.js';

describe('entrada', () => {
  it('el primero es anfitrión y recibe snapshot; el siguiente avisa al resto', () => {
    const h = createHarness();
    h.join('Ana');
    expect(h.state.hostId).toBe('p1');
    expect(snapshotsOf(h.effects)[0]?.snapshot).toMatchObject({
      phase: 'LOBBY',
      selfId: 'p1',
      hostId: 'p1',
      round: 0,
      letter: null,
      myAnswers: null,
    });
    const mark = h.effects.length;
    h.join('Beto');
    const [joined] = emitsOf(h.since(mark), 'player:joined');
    expect(joined?.to).toEqual({ kind: 'roomExcept', playerId: 'p2' });
    expect(joined?.payload).toMatchObject({
      id: 'p2',
      name: 'Beto',
      isHost: false,
      playing: false,
    });
  });

  it('sala llena', () => {
    const h = createHarness({ config: { maxPlayers: 2 } });
    h.joinAll('Ana', 'Beto');
    const res = h.dispatch({ type: 'join', sessionId: 'secret-Caro', name: 'Caro', connId: 'c' });
    expect(res.error).toBe('room_full');
    expect(h.state.players).toHaveLength(2);
  });

  it('nombre repetido recibe sufijo sin pasar el largo máximo', () => {
    const h = createHarness();
    h.join('Ana');
    h.join('ana', { sessionId: 'secret-2' });
    h.join('ANA', { sessionId: 'secret-3' });
    expect(h.state.players.map((p) => p.name)).toEqual(['Ana', 'ana 2', 'ANA 3']);
    const long = 'x'.repeat(NICKNAME_MAX_LENGTH);
    h.join(long, { sessionId: 'secret-4' });
    h.join(long, { sessionId: 'secret-5' });
    expect(h.state.players.at(-1)?.name).toHaveLength(NICKNAME_MAX_LENGTH);
    expect(h.state.players.at(-1)?.name.endsWith(' 2')).toBe(true);
  });

  it('el sessionId nunca aparece en un efecto', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro']);
    toWriting(h);
    h.disconnect('p2');
    h.reconnect('Beto');
    fill(h, 'p1');
    toReview(h);
    expect(JSON.stringify(h.effects)).not.toContain('secret-');
  });
});

describe('reconexión', () => {
  it('dentro de la gracia conserva puesto, puntaje y anfitrión y recibe snapshot', () => {
    const h = writingGame(['Ana', 'Beto']);
    const host = h.state.players[0];
    if (host) host.score = 350;
    h.disconnect('p1');
    expect(h.state.hostId).toBe('p1'); // desconectarse no transfiere el rol
    h.advanceBy(29_999);
    const mark = h.effects.length;
    const res = h.reconnect('Ana');
    expect(res.playerId).toBe('p1');
    const fx = h.since(mark);
    expect(emitsOf(fx, 'player:updated')[0]?.to).toEqual({ kind: 'roomExcept', playerId: 'p1' });
    expect(snapshotsOf(fx)[0]?.snapshot.players[0]).toMatchObject({ id: 'p1', score: 350 });
    expect(h.state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('recupera sus propias respuestas (myAnswers) y no las ajenas', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Ana');
    write(h, 'p1', 'animal', 'Águila');
    write(h, 'p2', 'nombre', 'Alberto');
    h.disconnect('p1');
    h.advanceBy(5_000);
    const res = h.reconnect('Ana');
    const [snap] = snapshotsOf(res.effects);
    expect(snap?.snapshot.myAnswers).toEqual({ nombre: 'Ana', animal: 'Águila' });
    expect(snap?.snapshot.phase).toBe('WRITING');
    expect(snap?.snapshot.letter).toBe('A');
    expect(snap?.snapshot.endsAt).toBe(h.state.deadline);
  });

  it('la misma sesión en otra pestaña gana y el disconnect del socket viejo se ignora', () => {
    const h = createHarness();
    h.join('Ana', { connId: 'viejo' });
    h.join('Beto');
    const res = h.dispatch({ type: 'join', sessionId: 'secret-Ana', name: 'Ana', connId: 'nuevo' });
    expect(res.effects).toContainEqual({ type: 'disconnectConn', connId: 'viejo' });
    h.dispatch({ type: 'disconnect', playerId: 'p1', connId: 'viejo' });
    expect(h.state.players[0]?.connected).toBe(true);
    expect(h.state.players[0]?.connId).toBe('nuevo');
  });

  it('tras la gracia se borra y quien vuelve entra como jugador nuevo', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto', 'Caro');
    h.disconnect('p3');
    const mark = h.effects.length;
    h.advanceBy(30_000);
    const [left] = emitsOf(h.since(mark), 'player:left');
    expect(left?.payload).toMatchObject({ id: 'p3', connected: false });
    expect(h.state.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    const res = h.reconnect('Caro');
    expect(res.playerId).toBe('p4');
  });

  it('si se borra al anfitrión, el rol pasa al conectado más antiguo', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto', 'Caro');
    h.disconnect('p1');
    h.disconnect('p2');
    const mark = h.effects.length;
    h.advanceBy(30_000);
    expect(h.state.hostId).toBe('p3');
    const updated = emitsOf(h.since(mark), 'player:updated').find((e) => e.payload.id === 'p3');
    expect(updated?.payload.isHost).toBe(true);
  });

  it('leave borra al instante y traspasa el anfitrión', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto', 'Caro');
    h.dispatch({ type: 'leave', playerId: 'p1' });
    expect(h.state.hostId).toBe('p2');
    expect(h.dispatch({ type: 'leave', playerId: 'p1' }).error).toBe('not_in_room');
  });
});

describe('entrada tardía', () => {
  it('quien entra a mitad de ronda mira: no participa, no responde y juega desde la siguiente', () => {
    const h = writingGame(['Ana', 'Beto'], { settings: { rounds: 2 } });
    const caro = h.join('Caro');
    expect(h.state.current?.playing).toEqual(['p1', 'p2']);
    expect(snapshotsOf(h.effects).at(-1)?.snapshot).toMatchObject({ myAnswers: null });
    expect(h.state.players.find((p) => p.id === caro)).toBeDefined();
    const res = h.dispatch({ type: 'updateAnswer', playerId: caro, category: 'nombre', text: 'A' });
    expect(res.error).toBe('not_playing');

    // Termina la ronda 1 y arranca la 2: Caro ya es participante y se le avisa a la sala.
    const mark = h.effects.length;
    while (h.state.round === 1) h.advanceTo(h.state.deadline!);
    expect(h.state.current?.playing).toEqual(['p1', 'p2', 'p3']);
    const updated = emitsOf(h.since(mark), 'player:updated').filter((e) => e.payload.id === caro);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.payload.playing).toBe(true);
  });
});

describe('abandono', () => {
  it('quedar con 1 jugador vuelve a LOBBY con snapshot y sin plazos', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1');
    const mark = h.effects.length;
    h.dispatch({ type: 'leave', playerId: 'p2' });
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.round).toBe(0);
    expect(h.state.current).toBeNull();
    expect(h.state.deadline).toBeNull();
    const [snap] = snapshotsOf(h.since(mark));
    expect(snap?.playerId).toBe('p1');
    expect(snap?.snapshot).toMatchObject({ phase: 'LOBBY', letter: null, myAnswers: null });
  });

  it('también cuando la gracia vencida deja a uno solo', () => {
    const h = startedGame(['Ana', 'Beto']);
    h.disconnect('p2');
    h.advanceBy(30_000);
    expect(h.state.phase).toBe('LOBBY');
    expect(h.state.players.map((p) => p.id)).toEqual(['p1']);
  });

  it('con 3 jugadores, irse uno no corta la ronda y sus respuestas salen de la revisión', () => {
    const h = writingGame(['Ana', 'Beto', 'Caro']);
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'Ana' });
    fill(h, 'p3', { nombre: 'Alicia' });
    h.dispatch({ type: 'leave', playerId: 'p2' });
    expect(h.state.phase).toBe('WRITING');
    toReview(h);
    expect(groupsNow(h).map((g) => [g.key, g.playerIds, g.points])).toEqual([
      ['ana', ['p1'], 100],
      ['alicia', ['p3'], 100],
    ]);
  });

  it('las categorías ya revisadas quedan congeladas si alguien se va después', () => {
    const h = writingGame(['Ana', 'Beto', 'Caro']);
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'Ana' });
    fill(h, 'p3');
    toReview(h);
    readyAll(h); // cierra "nombre": Ana repetida, 50 para p1 y p2
    h.dispatch({ type: 'leave', playerId: 'p2' });
    const nombre = h.state.current?.groups?.nombre ?? [];
    expect(nombre.find((g) => g.key === 'ana')).toMatchObject({
      playerIds: ['p1', 'p2'],
      points: 50,
    });
    // La categoría en curso sí pierde la respuesta de quien se fue.
    expect(groupsNow(h).flatMap((g) => g.playerIds)).not.toContain('p2');
  });

  it('si se va un participante en REVIEW se recalculan votos, puntos y "Listo"', () => {
    const h = writingGame(['Ana', 'Beto', 'Caro']);
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'Alberto' });
    fill(h, 'p3', { nombre: 'Alicia' });
    toReview(h);
    vote(h, 'p2', 'ana'); // 1 de 2 posibles
    h.dispatch({ type: 'ready', playerId: 'p1', ready: true });
    h.dispatch({ type: 'ready', playerId: 'p3', ready: true });
    expect(groupsNow(h)[0]?.status).toBe('valid');
    const mark = h.effects.length;
    h.dispatch({ type: 'leave', playerId: 'p2' }); // su voto y su respuesta se van
    expect(emitsOf(h.since(mark), 'player:left')).toHaveLength(1);
    expect(h.state.current?.review?.index).toBe(1); // faltaba solo Beto: ahora están todos listos
    expect(h.state.current?.groups?.nombre.map((g) => g.key)).toEqual(['ana', 'alicia']);
  });

  it('el picker que se va deja la ruleta girando hasta el plazo y rota bien', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro']);
    h.dispatch({ type: 'leave', playerId: 'p1' });
    expect(h.state.phase).toBe('LETTER');
    h.advanceTo(h.state.deadline!);
    expect(h.state.current?.letter).toBe('A');
  });
});
