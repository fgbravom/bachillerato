import { describe, expect, it } from 'vitest';
import type { Answers, CategoryId } from '@bach/shared';
import {
  emitsOf,
  fill,
  readyAll,
  startedGame,
  toReview,
  toWriting,
  vote,
  write,
} from './testing.js';
import type { Harness } from './testing.js';

/** Nombres de los eventos de ronda en orden, para comprobar la secuencia de fases. */
function timeline(h: Harness): string[] {
  const names = new Set([
    'round:letter',
    'round:letter-chosen',
    'round:writing',
    'round:stopped',
    'review:category',
    'round:end',
    'game:end',
  ]);
  return h.effects.flatMap((e) => (e.type === 'emit' && names.has(e.event) ? [e.event] : []));
}

function reviewAll(h: Harness): void {
  while (h.state.phase === 'REVIEW') readyAll(h);
}

describe('partida integral', () => {
  it('3 jugadores y 3 rondas: STOP, tiempo, votos, ruleta sola y puntajes exactos', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro'], { settings: { rounds: 3 } });
    // Ana (p1), Beto (p2) y Caro (p3). Letras de prueba: A, B, C.

    // --- Ronda 1 (A): Ana detiene la ruleta, Ana grita STOP. Nombre: Ana/Ana repetida, Caro única.
    expect(h.state.current?.pickerId).toBe('p1');
    toWriting(h);
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'ana' });
    fill(h, 'p3', { nombre: 'Andrea' });
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBeUndefined();
    h.advanceBy(1_000);
    expect(h.state.phase).toBe('REVIEW');
    reviewAll(h);
    expect(h.state.phase).toBe('ROUND_END');
    const end1 = emitsOf(h.effects, 'round:end').at(-1)?.payload;
    // 6 categorías únicas (100) + nombre: Ana y Beto 50, Caro 100.
    expect(end1?.gains).toEqual({ p1: 650, p2: 650, p3: 700 });
    expect(end1?.scores).toEqual({ p1: 650, p2: 650, p3: 700 });
    expect(end1?.stoppedBy).toBe('p1');
    expect(end1?.endsAt).toBe(h.now + 10_000);
    h.advanceTo(h.state.deadline!);

    // --- Ronda 2 (B): picker Beto, la ruleta se detiene sola; se acaba el tiempo con solo
    // "nombre" respondido. Beto y Caro escriben lo mismo; Ana lo rechaza y queda sola (200).
    expect(h.state.phase).toBe('LETTER');
    expect(h.state.current).toMatchObject({ pickerId: 'p2', letter: null });
    h.advanceTo(h.state.deadline!); // gira hasta el plazo
    h.advanceTo(h.state.deadline!); // letra revelada -> WRITING
    expect(h.state.phase).toBe('WRITING');
    write(h, 'p1', 'nombre', 'Bea');
    write(h, 'p2', 'nombre', 'Bruno');
    write(h, 'p3', 'nombre', 'bruno');
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBe('sheet_incomplete');
    toReview(h);
    expect(h.state.current?.review?.order).toEqual(['nombre']);
    vote(h, 'p1', 'bruno'); // posibles = {Ana}: basta
    expect(h.state.current?.groups?.nombre.map((g) => g.points)).toEqual([200, 0]);
    reviewAll(h);
    const end2 = emitsOf(h.effects, 'round:end').at(-1)?.payload;
    expect(end2?.gains).toEqual({ p1: 200, p2: 0, p3: 0 });
    expect(end2?.stoppedBy).toBeNull();
    h.advanceTo(h.state.deadline!);

    // --- Ronda 3 (C): picker Caro; nadie responde: sin revisión.
    expect(h.state.current?.pickerId).toBe('p3');
    stopPicker(h);
    h.advanceTo(h.state.deadline!);
    expect(h.state.current?.letter).toBe('C');
    expect(h.state.phase).toBe('WRITING');
    while (h.state.phase === 'WRITING') h.advanceTo(h.state.deadline!);
    expect(h.state.phase).toBe('ROUND_END');
    expect(emitsOf(h.effects, 'round:end').at(-1)?.payload.gains).toEqual({ p1: 0, p2: 0, p3: 0 });
    h.advanceTo(h.state.deadline!);

    // --- Fin de la partida.
    expect(h.state.phase).toBe('GAME_END');
    expect(h.state.deadline).toBeNull();
    expect(h.state.players.map((p) => [p.id, p.score])).toEqual([
      ['p1', 850],
      ['p2', 650],
      ['p3', 700],
    ]);
    const [gameEnd] = emitsOf(h.effects, 'game:end');
    expect(gameEnd?.payload.ranking).toEqual([
      { playerId: 'p1', name: 'Ana', score: 850, rank: 1 },
      { playerId: 'p3', name: 'Caro', score: 700, rank: 2 },
      { playerId: 'p2', name: 'Beto', score: 650, rank: 3 },
    ]);

    expect(timeline(h)).toEqual([
      // ronda 1: 7 categorías con respuestas
      'round:letter',
      'round:letter-chosen',
      'round:writing',
      'round:stopped',
      ...Array<string>(7).fill('review:category'),
      'round:end',
      // ronda 2: solo "nombre"
      'round:letter',
      'round:letter-chosen',
      'round:writing',
      'round:stopped',
      'review:category',
      'round:end',
      // ronda 3: sin respuestas, sin revisión
      'round:letter',
      'round:letter-chosen',
      'round:writing',
      'round:stopped',
      'round:end',
      'game:end',
    ]);
  });

  it('una ronda con 2 jugadores y una respuesta rechazada que da 200 al otro', () => {
    const h = startedGame(['Ana', 'Beto'], { settings: { rounds: 1 } });
    toWriting(h);
    const sheet: Answers = { nombre: 'Ana' };
    fill(h, 'p1', sheet);
    fill(h, 'p2', { nombre: 'Alberto' });
    h.dispatch({ type: 'stop', playerId: 'p2' });
    h.advanceBy(1_000);
    vote(h, 'p1', 'alberto');
    expect(h.state.current?.groups?.nombre.map((g) => [g.key, g.status, g.points])).toEqual([
      ['ana', 'valid', 200],
      ['alberto', 'rejected', 0],
    ]);
    reviewAll(h);
    const results = emitsOf(h.effects, 'round:end')[0]?.payload.results;
    const nombre: CategoryId = 'nombre';
    expect(results?.[nombre].map((g) => g.points)).toEqual([200, 0]);
    expect(emitsOf(h.effects, 'round:end')[0]?.payload.gains).toEqual({ p1: 800, p2: 600 });
  });
});

/** El picker de la ronda detiene la ruleta. */
function stopPicker(h: Harness): void {
  const pickerId = h.state.current?.pickerId;
  if (!pickerId) throw new Error('no hay picker');
  h.dispatch({ type: 'stopLetter', playerId: pickerId });
}
