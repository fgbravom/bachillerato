import type { Player, ReviewGroup, RoomState } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import type { ServerEvent } from '../state/session';
import { makePlayers, makeRoom } from '../ui/preview/fixtures';
import {
  isRouletteSpinning,
  nextTick,
  soundForEvent,
  TICK_SECONDS,
  type TickState,
} from './triggers';

const NOW = 1_000_000;

/** Yo soy `p1`; los demás son `p2` en adelante. */
function room(over: Partial<RoomState> = {}): RoomState {
  return makeRoom(NOW, { players: makePlayers(['Pipe', 'Cami', 'Nacho']), ...over });
}

const group = (key: string, rejectedBy: string[] = []): ReviewGroup => ({
  key,
  text: key,
  playerIds: ['p2'],
  rejectedBy,
  status: 'valid',
  points: 100,
});

const reviewRoom = (groups: ReviewGroup[]): RoomState =>
  room({
    phase: 'REVIEW',
    review: { category: 'fruta', index: 3, total: 7, groups },
  });

const player = (id: string): Player => ({
  id,
  name: `Jugador ${id}`,
  score: 0,
  connected: true,
  isHost: false,
  playing: true,
  filled: 0,
  ready: false,
});

describe('soundForEvent: ruleta y escritura', () => {
  it('te toca detener la ruleta solo si eres quien la detiene', () => {
    const mine: ServerEvent = {
      type: 'round:letter',
      payload: { round: 1, totalRounds: 5, pickerId: 'p1', endsAt: 1 },
    };
    const other: ServerEvent = {
      type: 'round:letter',
      payload: { round: 1, totalRounds: 5, pickerId: 'p2', endsAt: 1 },
    };
    expect(soundForEvent(room(), mine)).toBe('yourTurn');
    expect(soundForEvent(room(), other)).toBeNull();
  });

  it('sale la letra y empieza la escritura', () => {
    const chosen: ServerEvent = {
      type: 'round:letter-chosen',
      payload: { letter: 'F', endsAt: 1 },
    };
    const writing: ServerEvent = { type: 'round:writing', payload: { letter: 'F', endsAt: 1 } };
    expect(soundForEvent(room({ phase: 'LETTER' }), chosen)).toBe('letterReveal');
    expect(soundForEvent(room({ phase: 'LETTER' }), writing)).toBe('writeStart');
  });

  it('STOP de alguien suena fuerte; el fin del tiempo, distinto', () => {
    const byPlayer: ServerEvent = { type: 'round:stopped', payload: { by: 'p2', endsAt: 1 } };
    const byTime: ServerEvent = { type: 'round:stopped', payload: { by: null, endsAt: 1 } };
    expect(soundForEvent(room({ phase: 'WRITING' }), byPlayer)).toBe('stop');
    expect(soundForEvent(room({ phase: 'WRITING' }), byTime)).toBe('timeUp');
  });

  it('el progreso de los demás no suena', () => {
    const event: ServerEvent = { type: 'round:progress', payload: { playerId: 'p2', filled: 3 } };
    expect(soundForEvent(room({ phase: 'WRITING' }), event)).toBeNull();
  });
});

describe('soundForEvent: revisión y fin', () => {
  it('suena cuando cambia un voto y no cuando solo cambia "Listo"', () => {
    const before = reviewRoom([group('frutilla'), group('frambuesa')]);
    const voted: ServerEvent = {
      type: 'review:update',
      payload: {
        category: 'fruta',
        groups: [group('frutilla', ['p3']), group('frambuesa')],
        ready: [],
      },
    };
    const readyOnly: ServerEvent = {
      type: 'review:update',
      payload: {
        category: 'fruta',
        groups: [group('frutilla'), group('frambuesa')],
        ready: ['p2'],
      },
    };
    expect(soundForEvent(before, voted)).toBe('vote');
    expect(soundForEvent(before, readyOnly)).toBeNull();
  });

  it('una actualización de otra categoría o sin revisión no suena', () => {
    const stale: ServerEvent = {
      type: 'review:update',
      payload: { category: 'animal', groups: [group('x', ['p3'])], ready: [] },
    };
    expect(soundForEvent(reviewRoom([group('x')]), stale)).toBeNull();
    expect(soundForEvent(room({ phase: 'WRITING' }), stale)).toBeNull();
  });

  const roundEnd = (gain: number): ServerEvent => ({
    type: 'round:end',
    payload: {
      letter: 'F',
      gains: { p1: gain, p2: 100 },
      scores: {},
      results: { nombre: [], lugar: [], cosa: [], fruta: [], animal: [], tv: [], cantante: [] },
      stoppedBy: null,
      endsAt: 1,
    },
  });

  it('puntos de fin de ronda: con puntos o sin ellos', () => {
    expect(soundForEvent(reviewRoom([]), roundEnd(250))).toBe('roundEnd');
    expect(soundForEvent(reviewRoom([]), roundEnd(0))).toBe('roundEndEmpty');
  });

  it('podio', () => {
    const event: ServerEvent = { type: 'game:end', payload: { ranking: [] } };
    expect(soundForEvent(room({ phase: 'ROUND_END' }), event)).toBe('gameEnd');
  });
});

describe('soundForEvent: jugadores y chat', () => {
  it('entra alguien nuevo', () => {
    const event: ServerEvent = { type: 'player:joined', payload: player('nuevo') };
    expect(soundForEvent(room(), event)).toBe('playerJoin');
  });

  it('no suena por uno mismo ni por quien ya estaba (reconexión)', () => {
    expect(soundForEvent(room(), { type: 'player:joined', payload: player('p1') })).toBeNull();
    expect(soundForEvent(room(), { type: 'player:joined', payload: player('p2') })).toBeNull();
  });

  it('sale alguien, pero no uno mismo ni quien no estaba', () => {
    expect(soundForEvent(room(), { type: 'player:left', payload: player('p2') })).toBe(
      'playerLeave',
    );
    expect(soundForEvent(room(), { type: 'player:left', payload: player('p1') })).toBeNull();
    expect(soundForEvent(room(), { type: 'player:left', payload: player('x') })).toBeNull();
  });

  it('mensaje de otra persona suena; el propio no', () => {
    const other: ServerEvent = { type: 'message:new', payload: { playerId: 'p2', text: 'hola' } };
    const mine: ServerEvent = { type: 'message:new', payload: { playerId: 'p1', text: 'hola' } };
    expect(soundForEvent(room(), other)).toBe('chat');
    expect(soundForEvent(room(), mine)).toBeNull();
  });
});

describe('soundForEvent: lo que nunca suena', () => {
  it('room:state (entrar o reconectar) no suena, ni siquiera a mitad de ronda', () => {
    const event: ServerEvent = { type: 'room:state', payload: room({ phase: 'WRITING' }) };
    expect(soundForEvent(null, event)).toBeNull();
    expect(soundForEvent(room(), event)).toBeNull();
  });

  it('sin sala previa no suena nada', () => {
    const event: ServerEvent = { type: 'round:stopped', payload: { by: 'p2', endsAt: 1 } };
    expect(soundForEvent(null, event)).toBeNull();
  });

  it('eventos sin sonido', () => {
    const silent: ServerEvent[] = [
      { type: 'player:updated', payload: player('p2') },
      { type: 'system:error', payload: { code: 'internal' } },
      { type: 'system:online', payload: { count: 3 } },
    ];
    for (const event of silent) expect(soundForEvent(room(), event)).toBeNull();
  });
});

describe('isRouletteSpinning', () => {
  it('solo en LETTER y con la letra sin elegir', () => {
    expect(isRouletteSpinning(room({ phase: 'LETTER', letter: null }))).toBe(true);
    expect(isRouletteSpinning(room({ phase: 'LETTER', letter: 'F' }))).toBe(false);
    expect(isRouletteSpinning(room({ phase: 'WRITING', letter: null }))).toBe(false);
    expect(isRouletteSpinning(null)).toBe(false);
  });
});

describe('nextTick', () => {
  const start: TickState = { last: null };

  /** Recorre los segundos dados y devuelve en cuáles sonó. */
  function played(
    seconds: (number | null)[],
    phase: RoomState['phase'] = 'WRITING',
    stopped = false,
  ): number[] {
    let state = start;
    const out: number[] = [];
    for (const s of seconds) {
      const step = nextTick(phase, s, state, stopped);
      state = step.state;
      if (step.play && s !== null) out.push(s);
    }
    return out;
  }

  it('suena una vez en cada uno de los últimos 10 segundos', () => {
    const polls: number[] = [];
    for (let s = 12; s >= 0; s--) polls.push(s, s, s); // varias consultas por segundo
    expect(played(polls)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(TICK_SECONDS).toBe(10);
  });

  it('no suena fuera de WRITING', () => {
    expect(played([10, 9, 8], 'LETTER')).toEqual([]);
    expect(played([10, 9, 8], 'REVIEW')).toEqual([]);
    expect(played([10, 9, 8], 'ROUND_END')).toEqual([]);
    expect(played([10, 9, 8], 'LOBBY')).toEqual([]);
  });

  it('no suena durante la gracia tras el STOP', () => {
    expect(played([10, 9, 8], 'WRITING', true)).toEqual([]);
  });

  it('no suena sin reloj, en 0 ni por encima de 10', () => {
    expect(played([null, 0, 11, 30])).toEqual([]);
  });

  it('una ronda nueva vuelve a sonar desde 10', () => {
    expect(played([3, 2, 1, 0, 40, 10, 9])).toEqual([3, 2, 1, 10, 9]);
  });
});
