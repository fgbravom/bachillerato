// Foto de la sala para un jugador concreto. La red agrega `code`.

import { CATEGORIES, CATEGORY_IDS } from '@bach/shared';
import type { Answers, Player, ReviewState } from '@bach/shared';
import type { EnginePlayer, EngineSnapshot, GameState, PlayerId, RoundState } from './types.js';

/** Hay una ronda en curso (de LETTER a ROUND_END). */
export function roundOf(state: GameState): RoundState | null {
  const inRound =
    state.phase === 'LETTER' ||
    state.phase === 'WRITING' ||
    state.phase === 'REVIEW' ||
    state.phase === 'ROUND_END';
  return inRound ? state.current : null;
}

/** Categorías con texto en la hoja. */
export function filledCount(sheet: Answers | undefined): number {
  return sheet ? CATEGORY_IDS.filter((id) => sheet[id] !== undefined).length : 0;
}

/** Vista pública de un jugador: nunca incluye el `sessionId`. */
export function toPlayer(state: GameState, p: EnginePlayer): Player {
  const round = roundOf(state);
  const playing = round?.playing.includes(p.id) ?? false;
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isHost: state.hostId === p.id,
    playing,
    filled: state.phase === 'WRITING' && playing ? filledCount(round?.sheets[p.id]) : 0,
    ready: state.phase === 'REVIEW' && (round?.review?.ready.includes(p.id) ?? false),
  };
}

/** La categoría en revisión con sus grupos; null fuera de REVIEW. */
export function currentReview(state: GameState): ReviewState | null {
  const round = state.phase === 'REVIEW' ? state.current : null;
  const review = round?.review;
  const category = review?.order[review.index];
  const groups = category ? round?.groups?.[category] : undefined;
  if (!review || !category || !groups) return null;
  return {
    category,
    index: review.index,
    total: review.order.length,
    groups: structuredClone(groups),
  };
}

export function buildSnapshot(state: GameState, viewerId: PlayerId, now: number): EngineSnapshot {
  const round = roundOf(state);
  const writing = state.phase === 'WRITING' ? round : null;
  const playingNow = writing?.playing.includes(viewerId) ?? false;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    categories: CATEGORIES.map((c) => ({ ...c })),
    players: state.players.map((p) => toPlayer(state, p)),
    hostId: state.hostId ?? '',
    selfId: viewerId,
    round: state.round,
    totalRounds: state.settings.rounds,
    pickerId: state.phase === 'LETTER' ? (round?.pickerId ?? null) : null,
    letter: round?.letter ?? null,
    endsAt: state.deadline,
    serverNow: now,
    stopped: writing?.stopped ? { ...writing.stopped } : null,
    // Solo las propias, y solo en WRITING: las ajenas nunca salen del motor antes de REVIEW.
    myAnswers: writing && playingNow ? { ...writing.sheets[viewerId] } : null,
    review: currentReview(state),
    roundEnd: state.phase === 'ROUND_END' && round?.end ? structuredClone(round.end) : null,
    ranking: state.phase === 'GAME_END' ? (state.ranking ?? null) : null,
  };
}
