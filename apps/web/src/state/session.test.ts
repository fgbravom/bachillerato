import type { Player, ReviewGroup, RoomState, RoundEnd } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { makePlayers, makeRoom } from '../ui/preview/fixtures';
import {
  initialSession,
  reduceSession,
  withLocalAnswer,
  withMyAnswers,
  type ServerEvent,
  type SessionState,
} from './session';

/** Hora del servidor de las pruebas. */
const SERVER_NOW = 1_000_000;
/** Hora local: el reloj del servidor va 5 s adelante. */
const LOCAL_NOW = SERVER_NOW - 5000;

/** Yo soy `p1` (anfitrión); `p2` es Cami y `p3` Nacho. */
function room(over: Partial<RoomState> = {}): RoomState {
  return makeRoom(SERVER_NOW, { players: makePlayers(['Pipe', 'Cami', 'Nacho']), ...over });
}

const sessionWith = (r: RoomState | null): SessionState => ({ ...initialSession, room: r });

function apply(state: SessionState, ...events: ServerEvent[]): SessionState {
  return events.reduce((s, e) => reduceSession(s, e, LOCAL_NOW), state);
}

const group = (key: string, over: Partial<ReviewGroup> = {}): ReviewGroup => ({
  key,
  text: key,
  playerIds: ['p2'],
  rejectedBy: [],
  status: 'valid',
  points: 100,
  ...over,
});

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  name: `Jugador ${id}`,
  score: 0,
  connected: true,
  isHost: false,
  playing: true,
  filled: 0,
  ready: false,
  ...over,
});

const emptyResults: RoundEnd['results'] = {
  nombre: [],
  lugar: [],
  cosa: [],
  fruta: [],
  animal: [],
  tv: [],
  cantante: [],
};

describe('room:state', () => {
  it('reemplaza toda la foto y mide el desfase de reloj', () => {
    const incoming = room({ phase: 'WRITING', letter: 'F', myAnswers: { nombre: 'Felipe' } });
    const next = apply(sessionWith(room()), { type: 'room:state', payload: incoming });
    expect(next.room).toBe(incoming);
    expect(next.serverOffsetMs).toBe(5000);
  });

  it('conserva los mensajes si es la misma sala y los borra si es otra', () => {
    const base = apply(sessionWith(room()), {
      type: 'message:new',
      payload: { playerId: 'p2', text: 'hola' },
    });
    expect(base.feed).toHaveLength(1);

    const same = apply(base, { type: 'room:state', payload: room() });
    expect(same.feed).toHaveLength(1);

    const other = apply(base, { type: 'room:state', payload: room({ code: 'ZZZZ' }) });
    expect(other.feed).toEqual([]);
  });

  it('un evento suelto sin sala no inventa una', () => {
    const event: ServerEvent = { type: 'round:progress', payload: { playerId: 'p2', filled: 1 } };
    expect(apply(initialSession, event)).toBe(initialSession);
  });
});

describe('jugadores', () => {
  it('player:joined agrega al jugador y deja un aviso; repetido no avisa', () => {
    const joined: ServerEvent = { type: 'player:joined', payload: player('p9', { name: 'Gabo' }) };
    const once = apply(sessionWith(room()), joined);
    expect(once.room?.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p9']);
    expect(once.feed).toMatchObject([
      { kind: 'system', tone: 'join', text: 'Gabo entró a la sala' },
    ]);
    expect(apply(once, joined).feed).toHaveLength(1);
  });

  it('player:left saca al jugador, traspasa el anfitrión y deja un aviso', () => {
    const left: ServerEvent = {
      type: 'player:left',
      payload: player('p1', { name: 'Pipe', isHost: true }),
    };
    const promote: ServerEvent = {
      type: 'player:updated',
      payload: player('p2', { name: 'Cami', isHost: true }),
    };
    const next = apply(sessionWith(room()), left, promote);
    expect(next.room?.players.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(next.room?.hostId).toBe('p2');
    expect(next.feed).toMatchObject([{ tone: 'leave', text: 'Pipe salió de la sala' }]);
  });

  it('player:updated reemplaza los datos del jugador', () => {
    const next = apply(sessionWith(room()), {
      type: 'player:updated',
      payload: player('p2', { name: 'Cami', connected: false }),
    });
    expect(next.room?.players.find((p) => p.id === 'p2')?.connected).toBe(false);
  });
});

describe('ronda: letra y escritura', () => {
  it('round:letter parte la ronda y reinicia lo de la anterior', () => {
    const before = room({
      phase: 'ROUND_END',
      round: 1,
      letter: 'F',
      myAnswers: { nombre: 'Felipe' },
      roundEnd: {
        letter: 'F',
        gains: {},
        scores: {},
        results: emptyResults,
        stoppedBy: 'p2',
      },
      stopped: { by: 'p2' },
      players: makePlayers(['Pipe', 'Cami', 'Nacho'], () => ({ filled: 7, ready: true })),
    });
    const next = apply(sessionWith(before), {
      type: 'round:letter',
      payload: { round: 2, totalRounds: 5, pickerId: 'p2', endsAt: SERVER_NOW + 8000 },
    });
    expect(next.room).toMatchObject({
      phase: 'LETTER',
      round: 2,
      totalRounds: 5,
      pickerId: 'p2',
      letter: null,
      endsAt: SERVER_NOW + 8000,
      stopped: null,
      myAnswers: null,
      review: null,
      roundEnd: null,
    });
    expect(next.room?.players.every((p) => p.filled === 0 && !p.ready)).toBe(true);
    expect(next.feed).toMatchObject([{ kind: 'system', text: 'Ronda 2 de 5' }]);
  });

  it('round:letter-chosen fija la letra y el inicio de la escritura', () => {
    const next = apply(sessionWith(room({ phase: 'LETTER', letter: null })), {
      type: 'round:letter-chosen',
      payload: { letter: 'F', endsAt: SERVER_NOW + 3000 },
    });
    expect(next.room).toMatchObject({ phase: 'LETTER', letter: 'F', endsAt: SERVER_NOW + 3000 });
  });

  it('round:writing da hoja vacía a quien participa y ninguna a quien mira', () => {
    const event: ServerEvent = {
      type: 'round:writing',
      payload: { letter: 'F', endsAt: SERVER_NOW + 90_000 },
    };
    const playing = apply(
      sessionWith(room({ phase: 'LETTER', letter: 'F', pickerId: 'p2' })),
      event,
    );
    expect(playing.room).toMatchObject({
      phase: 'WRITING',
      letter: 'F',
      endsAt: SERVER_NOW + 90_000,
      pickerId: null,
      stopped: null,
      myAnswers: {},
    });

    const watching = apply(
      sessionWith(
        room({
          phase: 'LETTER',
          players: makePlayers(['Pipe', 'Cami'], (_, i) => ({ playing: i !== 0 })),
        }),
      ),
      event,
    );
    expect(watching.room?.myAnswers).toBeNull();
  });

  it('round:progress actualiza el avance de ese jugador', () => {
    const next = apply(sessionWith(room({ phase: 'WRITING' })), {
      type: 'round:progress',
      payload: { playerId: 'p3', filled: 5 },
    });
    expect(next.room?.players.map((p) => p.filled)).toEqual([0, 0, 5]);
  });

  it('round:stopped marca la hoja cerrada, mueve el reloj y avisa quién gritó', () => {
    const next = apply(sessionWith(room({ phase: 'WRITING', endsAt: SERVER_NOW + 30_000 })), {
      type: 'round:stopped',
      payload: { by: 'p2', endsAt: SERVER_NOW + 1000 },
    });
    expect(next.room).toMatchObject({ stopped: { by: 'p2' }, endsAt: SERVER_NOW + 1000 });
    expect(next.feed).toMatchObject([{ kind: 'system', tone: 'info', text: 'Cami gritó ¡STOP!' }]);
  });

  it('round:stopped por tiempo no tiene autor', () => {
    const next = apply(sessionWith(room({ phase: 'WRITING' })), {
      type: 'round:stopped',
      payload: { by: null, endsAt: SERVER_NOW + 1000 },
    });
    expect(next.room?.stopped).toEqual({ by: null });
    expect(next.feed).toMatchObject([{ text: 'Se acabó el tiempo' }]);
  });
});

describe('revisión', () => {
  const reviewEvent = (index: number, groups: ReviewGroup[]): ServerEvent => ({
    type: 'review:category',
    payload: { category: 'nombre', index, total: 7, groups, endsAt: SERVER_NOW + 20_000 },
  });

  it('review:category abre la categoría y deja a todos sin "Listo"', () => {
    const before = room({
      phase: 'WRITING',
      stopped: { by: 'p2' },
      myAnswers: { nombre: 'Felipe' },
      players: makePlayers(['Pipe', 'Cami', 'Nacho'], () => ({ ready: true })),
    });
    const groups = [group('felipe')];
    const next = apply(sessionWith(before), reviewEvent(0, groups));
    expect(next.room).toMatchObject({
      phase: 'REVIEW',
      stopped: null,
      myAnswers: null,
      endsAt: SERVER_NOW + 20_000,
      review: { category: 'nombre', index: 0, total: 7, groups },
    });
    expect(next.room?.players.every((p) => !p.ready)).toBe(true);
  });

  it('review:update cambia los grupos y marca quiénes están listos', () => {
    const opened = apply(
      sessionWith(room({ phase: 'WRITING' })),
      reviewEvent(0, [group('felipe')]),
    );
    const voted = [group('felipe', { rejectedBy: ['p3'], status: 'rejected', points: 0 })];
    const next = apply(opened, {
      type: 'review:update',
      payload: { category: 'nombre', groups: voted, ready: ['p1', 'p3'] },
    });
    expect(next.room?.review?.groups).toEqual(voted);
    expect(next.room?.players.map((p) => p.ready)).toEqual([true, false, true]);

    const unready = apply(next, {
      type: 'review:update',
      payload: { category: 'nombre', groups: voted, ready: ['p3'] },
    });
    expect(unready.room?.players.map((p) => p.ready)).toEqual([false, false, true]);
  });

  it('review:update de otra categoría (tardío) se ignora', () => {
    const opened = apply(
      sessionWith(room({ phase: 'WRITING' })),
      reviewEvent(0, [group('felipe')]),
    );
    const next = apply(opened, {
      type: 'review:update',
      payload: { category: 'animal', groups: [], ready: ['p1'] },
    });
    expect(next).toBe(opened);
  });

  it('review:update sin revisión en curso se ignora', () => {
    const base = sessionWith(room({ phase: 'WRITING' }));
    const next = apply(base, {
      type: 'review:update',
      payload: { category: 'nombre', groups: [], ready: [] },
    });
    expect(next).toBe(base);
  });
});

describe('fin de ronda y de partida', () => {
  it('round:end pasa a ROUND_END, suma los puntajes y cierra la revisión', () => {
    const before = room({
      phase: 'REVIEW',
      review: { category: 'cantante', index: 6, total: 7, groups: [] },
      letter: 'F',
      players: makePlayers(['Pipe', 'Cami', 'Nacho'], () => ({ score: 0, ready: true })),
    });
    const next = apply(sessionWith(before), {
      type: 'round:end',
      payload: {
        letter: 'F',
        gains: { p1: 250, p2: 100, p3: 0 },
        scores: { p1: 250, p2: 100, p3: 0 },
        results: emptyResults,
        stoppedBy: 'p2',
        endsAt: SERVER_NOW + 10_000,
      },
    });
    expect(next.room).toMatchObject({
      phase: 'ROUND_END',
      endsAt: SERVER_NOW + 10_000,
      review: null,
      roundEnd: { letter: 'F', gains: { p1: 250, p2: 100, p3: 0 }, stoppedBy: 'p2' },
    });
    expect(next.room?.roundEnd).not.toHaveProperty('endsAt');
    expect(next.room?.players.map((p) => p.score)).toEqual([250, 100, 0]);
    expect(next.room?.players.every((p) => !p.ready)).toBe(true);
  });

  it('game:end guarda el ranking y deja la partida sin reloj', () => {
    const ranking = [
      { playerId: 'p2', name: 'Cami', score: 600, rank: 1 },
      { playerId: 'p1', name: 'Pipe', score: 450, rank: 2 },
      { playerId: 'p3', name: 'Nacho', score: 100, rank: 3 },
    ];
    const next = apply(sessionWith(room({ phase: 'ROUND_END', endsAt: SERVER_NOW + 5000 })), {
      type: 'game:end',
      payload: { ranking },
    });
    expect(next.room).toMatchObject({ phase: 'GAME_END', endsAt: null, ranking, roundEnd: null });
    expect(next.room?.players.map((p) => p.score)).toEqual([450, 600, 100]);
  });

  it('volver a la sala de espera llega como room:state y reemplaza todo', () => {
    const ended = room({ phase: 'GAME_END', ranking: [] });
    const lobby = room({ phase: 'LOBBY', round: 0, ranking: null });
    const next = apply(sessionWith(ended), { type: 'room:state', payload: lobby });
    expect(next.room?.phase).toBe('LOBBY');
    expect(next.room?.ranking).toBeNull();
  });
});

describe('chat y avisos', () => {
  it('message:new arma el ítem con el apodo y marca los propios', () => {
    const next = apply(
      sessionWith(room()),
      { type: 'message:new', payload: { playerId: 'p2', text: '¡Fuente no es un color!' } },
      { type: 'message:new', payload: { playerId: 'p1', text: 'sí po' } },
    );
    expect(next.feed).toMatchObject([
      { kind: 'message', name: 'Cami', isSelf: false, text: '¡Fuente no es un color!' },
      { kind: 'message', name: 'Pipe', isSelf: true, text: 'sí po' },
    ]);
    expect(new Set(next.feed.map((f) => f.id)).size).toBe(2);
  });

  it('system:error y system:online no tocan la sala', () => {
    const base = sessionWith(room());
    expect(apply(base, { type: 'system:error', payload: { code: 'internal' } })).toBe(base);
    expect(apply(base, { type: 'system:online', payload: { count: 4 } })).toBe(base);
  });
});

describe('una ronda completa de punta a punta', () => {
  it('recorre todas las fases con la misma foto', () => {
    const lobby = room({ phase: 'LOBBY' });
    const end = apply(
      sessionWith(lobby),
      { type: 'round:letter', payload: { round: 1, totalRounds: 1, pickerId: 'p2', endsAt: 1 } },
      { type: 'round:letter-chosen', payload: { letter: 'F', endsAt: 2 } },
      { type: 'round:writing', payload: { letter: 'F', endsAt: 3 } },
      { type: 'round:progress', payload: { playerId: 'p2', filled: 7 } },
      { type: 'round:stopped', payload: { by: 'p2', endsAt: 4 } },
      {
        type: 'review:category',
        payload: { category: 'nombre', index: 0, total: 1, groups: [group('felipe')], endsAt: 5 },
      },
      {
        type: 'round:end',
        payload: {
          letter: 'F',
          gains: { p1: 100 },
          scores: { p1: 100 },
          results: emptyResults,
          stoppedBy: 'p2',
          endsAt: 6,
        },
      },
      {
        type: 'game:end',
        payload: { ranking: [{ playerId: 'p1', name: 'Pipe', score: 100, rank: 1 }] },
      },
    );
    expect(end.room?.phase).toBe('GAME_END');
    expect(end.room?.players.find((p) => p.id === 'p1')?.score).toBe(100);
  });
});

describe('respuestas propias en la foto', () => {
  const writing = (): SessionState =>
    sessionWith(room({ phase: 'WRITING', round: 2, letter: 'F', myAnswers: { nombre: 'Fe' } }));

  it('withLocalAnswer anota lo tecleado en la ronda en curso', () => {
    const next = withLocalAnswer(writing(), 2, 'lugar', 'Fra');
    expect(next.room?.myAnswers).toEqual({ nombre: 'Fe', lugar: 'Fra' });
  });

  it('withLocalAnswer ignora otra ronda, otra fase o quien no tiene hoja', () => {
    const base = writing();
    expect(withLocalAnswer(base, 1, 'lugar', 'x')).toBe(base);
    expect(
      withLocalAnswer(sessionWith(room({ phase: 'REVIEW' })), 2, 'lugar', 'x').room?.phase,
    ).toBe('REVIEW');
    const watching = sessionWith(room({ phase: 'WRITING', round: 2, myAnswers: null }));
    expect(withLocalAnswer(watching, 2, 'lugar', 'x')).toBe(watching);
    expect(withLocalAnswer(initialSession, 2, 'lugar', 'x')).toBe(initialSession);
  });

  it('withMyAnswers repone la hoja solo durante la escritura', () => {
    const next = withMyAnswers(writing(), { nombre: 'Felipe', lugar: 'Francia' });
    expect(next.room?.myAnswers).toEqual({ nombre: 'Felipe', lugar: 'Francia' });
    const review = sessionWith(room({ phase: 'REVIEW' }));
    expect(withMyAnswers(review, { nombre: 'x' })).toBe(review);
  });
});
