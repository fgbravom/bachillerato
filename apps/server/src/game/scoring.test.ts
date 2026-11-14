import { describe, expect, it } from 'vitest';
import type { ReviewGroup } from '@bach/shared';
import { assignPoints, computeGains, ranking } from './scoring.js';
import type { EnginePlayer } from './types.js';

function group(
  key: string,
  playerIds: string[],
  status: ReviewGroup['status'] = 'valid',
): ReviewGroup {
  return { key, text: key, playerIds, rejectedBy: [], status, points: -1 };
}

function player(id: string, score: number): EnginePlayer {
  return {
    id,
    sessionId: `s-${id}`,
    name: id,
    score,
    connected: true,
    connId: null,
    disconnectedAt: null,
  };
}

describe('assignPoints', () => {
  it('200 al único grupo válido con un solo autor', () => {
    const groups = [group('ana', ['p1'])];
    assignPoints(groups);
    expect(groups[0]?.points).toBe(200);
  });

  it('100 si hay otros grupos válidos y nadie repite', () => {
    const groups = [group('ana', ['p1']), group('bea', ['p2'])];
    assignPoints(groups);
    expect(groups.map((g) => g.points)).toEqual([100, 100]);
  });

  it('50 si el grupo tiene más de un autor, incluso siendo el único', () => {
    const groups = [group('ana', ['p1', 'p2'])];
    assignPoints(groups);
    expect(groups[0]?.points).toBe(50);
  });

  it('un grupo rechazado o anulado vale 0 y no cuenta para el 200 de otro', () => {
    const groups = [
      group('ana', ['p1']),
      group('bea', ['p2'], 'rejected'),
      group('bruno', ['p3'], 'wrong_letter'),
    ];
    assignPoints(groups);
    expect(groups.map((g) => g.points)).toEqual([200, 0, 0]);
  });

  it('sin grupos no hace nada', () => {
    expect(() => assignPoints([])).not.toThrow();
  });
});

describe('computeGains', () => {
  it('suma los puntos de cada autor y descarta a quien ya no está', () => {
    const results = {
      nombre: [group('ana', ['p1', 'p2'])],
      lugar: [group('arica', ['p1']), group('angol', ['p3'])],
      cosa: [],
      fruta: [],
      animal: [],
      tv: [],
      cantante: [],
    };
    for (const groups of Object.values(results)) assignPoints(groups);
    const gains = computeGains(results, [player('p1', 0), player('p2', 0)]);
    expect(gains).toEqual({ p1: 150, p2: 50 });
  });
});

describe('ranking', () => {
  it('ordena por puntaje y los empates comparten puesto', () => {
    const r = ranking([player('p1', 100), player('p2', 300), player('p3', 100), player('p4', 50)]);
    expect(r.map((e) => [e.playerId, e.rank])).toEqual([
      ['p2', 1],
      ['p1', 2],
      ['p3', 2],
      ['p4', 4],
    ]);
  });

  it('en empate respeta el orden de llegada', () => {
    const r = ranking([player('p1', 10), player('p2', 10), player('p3', 10)]);
    expect(r.map((e) => [e.playerId, e.rank])).toEqual([
      ['p1', 1],
      ['p2', 1],
      ['p3', 1],
    ]);
  });
});
