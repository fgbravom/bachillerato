import { describe, expect, it } from 'vitest';
import {
  createHarness,
  emitsOf,
  fill,
  readyAll,
  startedGame,
  toReview,
  toWriting,
  writingGame,
} from './testing.js';

describe('chat', () => {
  it('en LOBBY va a toda la sala, sin canal', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto');
    const mark = h.effects.length;
    const res = h.say('p1', 'hola a todos');
    expect(res.error).toBeUndefined();
    const [msg] = emitsOf(h.since(mark), 'message:new');
    expect(msg?.to).toEqual({ kind: 'room' });
    expect(msg?.payload).toEqual({ playerId: 'p1', text: 'hola a todos' });
  });

  it('en LETTER y WRITING no hay chat: wrong_phase y ningún efecto', () => {
    const h = startedGame(['Ana', 'Beto']);
    const a = h.say('p1', 'hola');
    expect(a.error).toBe('wrong_phase');
    expect(a.effects).toEqual([]);
    toWriting(h);
    expect(h.say('p2', 'hola').error).toBe('wrong_phase');
  });

  it('en REVIEW, ROUND_END y GAME_END sí hay chat', () => {
    const h = writingGame(['Ana', 'Beto'], { settings: { rounds: 1 } });
    fill(h, 'p1');
    toReview(h);
    expect(h.say('p2', '¡Fuente no es un color!').error).toBeUndefined();
    while (h.state.phase === 'REVIEW') readyAll(h);
    expect(h.state.phase).toBe('ROUND_END');
    expect(h.say('p1', 'buena').error).toBeUndefined();
    h.advanceTo(h.state.deadline!);
    expect(h.state.phase).toBe('GAME_END');
    expect(h.say('p1', 'gg').error).toBeUndefined();
    expect(emitsOf(h.effects, 'message:new')).toHaveLength(3);
  });

  it('mensaje vacío no emite; jugador inexistente da not_in_room', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto');
    const mark = h.effects.length;
    expect(h.say('p1', '   ').error).toBeUndefined();
    expect(h.since(mark)).toEqual([]);
    expect(h.say('nadie', 'hola').error).toBe('not_in_room');
  });
});
