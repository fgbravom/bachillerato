// Tabla de fin de ronda: puntos ganados y acumulados por jugador.

import type { Player, RoundEnd } from '@bach/shared';

export type RoundRow = {
  playerId: string;
  name: string;
  /** Puntos de esta ronda. */
  gain: number;
  /** Acumulado. */
  score: number;
  /** Posición por acumulado; los empates la comparten (1, 1, 3...). */
  rank: number;
  isSelf: boolean;
  /** Gritó STOP en esta ronda. */
  isStopper: boolean;
  /** Jugó la ronda (quien entró tarde aparece con 0 y sin detalle). */
  playing: boolean;
};

/**
 * Filas ordenadas por acumulado (y por ganancia de la ronda en empates; luego orden de llegada).
 * Usa los puntajes del `RoundEnd`, que son los que manda el servidor para esta ronda.
 */
export function buildRoundRows(
  players: readonly Player[],
  roundEnd: Pick<RoundEnd, 'gains' | 'scores' | 'stoppedBy'>,
  selfId: string,
): RoundRow[] {
  const rows: RoundRow[] = players
    .map((player, index) => ({
      index,
      row: {
        playerId: player.id,
        name: player.name,
        gain: roundEnd.gains[player.id] ?? 0,
        score: roundEnd.scores[player.id] ?? player.score,
        rank: 0,
        isSelf: player.id === selfId,
        isStopper: roundEnd.stoppedBy === player.id,
        playing: player.playing,
      },
    }))
    .sort((a, b) => b.row.score - a.row.score || b.row.gain - a.row.gain || a.index - b.index)
    .map(({ row }) => row);
  return rows.map((row) => ({
    ...row,
    rank: rows.findIndex((r) => r.score === row.score) + 1,
  }));
}
