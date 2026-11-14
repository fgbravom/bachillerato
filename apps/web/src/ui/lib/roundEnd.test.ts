import type { Player } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { buildRoundRows } from './roundEnd';

function player(id: string, score: number, patch: Partial<Player> = {}): Player {
  return {
    id,
    name: id.toUpperCase(),
    score,
    connected: true,
    isHost: false,
    playing: true,
    filled: 0,
    ready: false,
    ...patch,
  };
}

describe('buildRoundRows', () => {
  const players = [player('a', 0), player('b', 0), player('c', 0)];

  it('ordena por acumulado y trae la ganancia de la ronda', () => {
    const rows = buildRoundRows(
      players,
      { gains: { a: 350, b: 600, c: 100 }, scores: { a: 350, b: 900, c: 500 }, stoppedBy: null },
      'a',
    );
    expect(rows.map((r) => r.playerId)).toEqual(['b', 'c', 'a']);
    expect(rows.map((r) => r.gain)).toEqual([600, 100, 350]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.find((r) => r.playerId === 'a')?.isSelf).toBe(true);
  });

  it('los empates comparten posición', () => {
    const rows = buildRoundRows(
      players,
      { gains: { a: 100, b: 200, c: 0 }, scores: { a: 300, b: 300, c: 100 }, stoppedBy: null },
      'a',
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    // En el empate va primero quien más ganó en la ronda.
    expect(rows[0]?.playerId).toBe('b');
  });

  it('marca a quien gritó STOP', () => {
    const rows = buildRoundRows(
      players,
      { gains: {}, scores: { a: 1, b: 2, c: 3 }, stoppedBy: 'b' },
      'a',
    );
    expect(rows.filter((r) => r.isStopper).map((r) => r.playerId)).toEqual(['b']);
  });

  it('si falta un puntaje usa el del jugador y 0 de ganancia', () => {
    const rows = buildRoundRows([player('a', 70)], { gains: {}, scores: {}, stoppedBy: null }, 'a');
    expect(rows[0]).toMatchObject({ gain: 0, score: 70 });
  });

  it('conserva a quien no jugó la ronda', () => {
    const rows = buildRoundRows(
      [player('a', 10), player('z', 0, { playing: false })],
      { gains: { a: 10 }, scores: { a: 10, z: 0 }, stoppedBy: 'a' },
      'a',
    );
    expect(rows.find((r) => r.playerId === 'z')?.playing).toBe(false);
  });
});
