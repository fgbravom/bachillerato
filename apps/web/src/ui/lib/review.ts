// Revisión (fase REVIEW): quién puede votar, cuántos votos hacen falta y cómo se muestra cada
// grupo de respuestas. El servidor manda el estado y los puntos; aquí solo se interpreta.

import {
  SCORE_ALONE,
  SCORE_REPEATED,
  SCORE_UNIQUE,
  type Player,
  type ReviewGroup,
} from '@bach/shared';

/**
 * Votantes posibles de un grupo: participantes conectados que no son autores de esa respuesta.
 * Es la misma cuenta del plan (sección 2), para mostrar "1 de 2".
 */
export function eligibleVoters(group: ReviewGroup, players: readonly Player[]): Player[] {
  return players.filter((p) => p.playing && p.connected && !group.playerIds.includes(p.id));
}

/** Votos de "No vale" que la rechazan: más de la mitad de los votantes posibles. 0 si no hay votantes. */
export function rejectsNeeded(voterCount: number): number {
  return voterCount <= 0 ? 0 : Math.floor(voterCount / 2) + 1;
}

export type VoteInfo = {
  /** Votos actuales ("No vale"). */
  votes: number;
  /** Votos necesarios para rechazarla (0 si nadie puede votar). */
  needed: number;
  /** Quien mira ya votó "No vale". */
  voted: boolean;
  /** Quien mira puede marcar o desmarcar. */
  canVote: boolean;
  /** Por qué no puede votar (para mostrarlo); `null` si puede. */
  blockedReason: 'spectator' | 'author' | 'wrong_letter' | 'no_voters' | null;
};

export function voteInfo(group: ReviewGroup, players: readonly Player[], selfId: string): VoteInfo {
  const self = players.find((p) => p.id === selfId);
  const voters = eligibleVoters(group, players);
  const needed = rejectsNeeded(voters.length);
  // Solo cuentan los votos de quienes siguen pudiendo votar, igual que en el servidor.
  const votes = group.rejectedBy.filter((id) => voters.some((p) => p.id === id)).length;
  const voted = group.rejectedBy.includes(selfId);
  let blockedReason: VoteInfo['blockedReason'] = null;
  if (!self?.playing) blockedReason = 'spectator';
  else if (group.playerIds.includes(selfId)) blockedReason = 'author';
  else if (group.status === 'wrong_letter') blockedReason = 'wrong_letter';
  else if (needed === 0) blockedReason = 'no_voters';
  return { votes, needed, voted, canVote: blockedReason === null, blockedReason };
}

/** Participantes que no escribieron nada en la categoría (no aparecen en ningún grupo). */
export function missingAnswerers(
  players: readonly Player[],
  groups: readonly ReviewGroup[],
): Player[] {
  const answered = new Set(groups.flatMap((g) => g.playerIds));
  return players.filter((p) => p.playing && !answered.has(p.id));
}

/** Cuántos participantes conectados aún no marcan "Listo". */
export function pendingReady(players: readonly Player[]): number {
  return players.filter((p) => p.playing && p.connected && !p.ready).length;
}

export type StampTone = 'repeated' | 'unique' | 'alone' | 'none';

/** Color del sello de puntos: cada valor tiene el suyo. */
export function stampTone(group: Pick<ReviewGroup, 'status' | 'points'>): StampTone {
  if (group.status !== 'valid') return 'none';
  if (group.points >= SCORE_ALONE) return 'alone';
  if (group.points >= SCORE_UNIQUE) return 'unique';
  if (group.points >= SCORE_REPEATED) return 'repeated';
  return 'none';
}

/** Texto bajo la respuesta cuando no vale; `null` si está vigente. */
export function statusNote(group: Pick<ReviewGroup, 'status'>, letter: string): string | null {
  if (group.status === 'wrong_letter') return `No empieza con ${letter}`;
  if (group.status === 'rejected') return 'No vale';
  return null;
}

/** Etiqueta para lectores de pantalla del sello de puntos. */
export function stampLabel(group: Pick<ReviewGroup, 'status' | 'points'>): string {
  if (group.status === 'valid' && group.points > 0) return `${group.points} puntos`;
  return 'Sin puntos';
}
