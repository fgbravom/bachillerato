// Puntaje, ganancias y ranking (docs/motor-reglas.md sección 6).

import { CATEGORY_IDS, SCORE_ALONE, SCORE_REPEATED, SCORE_UNIQUE } from '@bach/shared';
import type { CategoryId, RankingEntry, ReviewGroup } from '@bach/shared';
import type { EnginePlayer } from './types.js';

/**
 * Reparte los puntos de una categoría sobre sus grupos (muta `points`). Solo puntúan los grupos
 * válidos: 200 si es el único grupo válido y tiene un solo autor, 50 si el grupo tiene más de un
 * autor y 100 en otro caso. Rechazada o anulada: 0 (y no cuenta para el 200 de los demás).
 */
export function assignPoints(groups: ReviewGroup[]): void {
  const valid = groups.filter((g) => g.status === 'valid');
  for (const g of groups) {
    if (g.status !== 'valid') g.points = 0;
    else if (g.playerIds.length > 1) g.points = SCORE_REPEATED;
    else g.points = valid.length === 1 ? SCORE_ALONE : SCORE_UNIQUE;
  }
}

/** Puntos de la ronda por jugador presente (los de quien ya no está se descartan). */
export function computeGains(
  results: Record<CategoryId, ReviewGroup[]>,
  players: readonly EnginePlayer[],
): Record<string, number> {
  const gains: Record<string, number> = {};
  for (const p of players) gains[p.id] = 0;
  for (const id of CATEGORY_IDS) {
    for (const group of results[id]) {
      for (const playerId of group.playerIds) {
        if (playerId in gains) gains[playerId] = (gains[playerId] ?? 0) + group.points;
      }
    }
  }
  return gains;
}

/** Puntaje descendente; en empate, orden de llegada. Los empates comparten puesto (1, 1, 3). */
export function ranking(players: readonly EnginePlayer[]): RankingEntry[] {
  const sorted = [...players].sort((a, b) => b.score - a.score); // sort es estable
  return sorted.map((p) => ({
    playerId: p.id,
    name: p.name,
    score: p.score,
    rank: 1 + players.filter((q) => q.score > p.score).length,
  }));
}
