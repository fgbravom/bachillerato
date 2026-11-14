// Revisión: grupos por categoría, votos "No vale", "Listo" y avance
// (docs/motor-reglas.md sección 5, "REVIEW").

import { CATEGORY_IDS, normalizeAnswer, startsWithLetter } from '@bach/shared';
import type { CategoryId, ReviewGroup } from '@bach/shared';
import { emit, getPlayer, toRoom } from './env.js';
import type { Env, Outcome } from './env.js';
import { endRound } from './rounds.js';
import { assignPoints } from './scoring.js';
import type { GameState, PlayerId, RoundState } from './types.js';

/** Categoría que se está revisando; null fuera de REVIEW. */
function currentCategory(rs: RoundState): CategoryId | null {
  return rs.review?.order[rs.review.index] ?? null;
}

/** Votantes posibles de un grupo: participantes conectados que no son autores. */
export function possibleVoters(s: GameState, rs: RoundState, group: ReviewGroup): PlayerId[] {
  return rs.playing.filter(
    (id) => !group.playerIds.includes(id) && getPlayer(s, id)?.connected === true,
  );
}

/**
 * Arma los grupos de una categoría: respuestas iguales tras `normalizeAnswer`, en orden de
 * llegada de sus autores (el texto es el del primero). Las vacías no forman grupo.
 */
function buildGroups(s: GameState, rs: RoundState, category: CategoryId): ReviewGroup[] {
  const byKey = new Map<string, ReviewGroup>();
  for (const p of s.players) {
    if (!rs.playing.includes(p.id)) continue;
    const text = rs.sheets[p.id]?.[category];
    if (text === undefined) continue;
    const key = normalizeAnswer(text);
    if (key === '') continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.playerIds.push(p.id);
    } else {
      byKey.set(key, {
        key,
        text,
        playerIds: [p.id],
        rejectedBy: [],
        status: startsWithLetter(text, rs.letter ?? '') ? 'valid' : 'wrong_letter',
        points: 0,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * Recalcula estado y puntos de los grupos de una categoría a partir de los votos y de quién está
 * conectado. Un grupo se rechaza cuando los votos de votantes posibles superan la mitad de ellos;
 * sin votantes posibles queda válido. `wrong_letter` no cambia.
 */
function applyStatus(s: GameState, rs: RoundState, groups: ReviewGroup[]): void {
  for (const g of groups) {
    if (g.status === 'wrong_letter') continue;
    const voters = possibleVoters(s, rs, g);
    const rejections = g.rejectedBy.filter((id) => voters.includes(id)).length;
    g.status = voters.length > 0 && rejections > voters.length / 2 ? 'rejected' : 'valid';
  }
  assignPoints(groups);
}

function emitUpdate(env: Env): void {
  const rs = env.state.current;
  const category = rs ? currentCategory(rs) : null;
  if (!rs?.review || !rs.groups || !category) return;
  emit(env, toRoom, 'review:update', {
    category,
    groups: structuredClone(rs.groups[category]),
    ready: [...rs.review.ready],
  });
}

/** Entra a la categoría `index` de la revisión: "Listo" se reinicia y corre el plazo. */
function enterCategory(env: Env, index: number): void {
  const s = env.state;
  const rs = s.current;
  if (!rs?.review || !rs.groups) throw new Error('enterCategory sin revisión');
  rs.review.index = index;
  rs.review.ready = [];
  const category = rs.review.order[index];
  if (!category) throw new Error('enterCategory fuera de rango');
  const groups = rs.groups[category];
  applyStatus(s, rs, groups);
  s.deadline = env.ctx.now + s.config.reviewMs;
  emit(env, toRoom, 'review:category', {
    category,
    index,
    total: rs.review.order.length,
    groups: structuredClone(groups),
    endsAt: s.deadline,
  });
}

/**
 * Pasa de WRITING a REVIEW. Se revisan solo las categorías con al menos una respuesta (las que
 * nadie respondió se saltan para no gastar 20 s en nada). Si no hay ninguna, va directo a ROUND_END.
 */
export function beginReview(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (!rs) throw new Error('beginReview sin ronda');
  const groups = {} as Record<CategoryId, ReviewGroup[]>;
  for (const id of CATEGORY_IDS) groups[id] = buildGroups(s, rs, id);
  rs.groups = groups;
  const order = CATEGORY_IDS.filter((id) => groups[id].length > 0);
  if (order.length === 0) {
    endRound(env);
    return;
  }
  rs.review = { order, index: 0, ready: [] };
  s.phase = 'REVIEW';
  enterCategory(env, 0);
}

/** Siguiente categoría, o fin de la ronda si era la última. */
export function nextCategory(env: Env): void {
  const rs = env.state.current;
  if (!rs?.review) throw new Error('nextCategory sin revisión');
  if (rs.review.index + 1 < rs.review.order.length) enterCategory(env, rs.review.index + 1);
  else endRound(env);
}

/** Todos los participantes conectados marcaron "Listo": avanza (si hay al menos uno conectado). */
function checkAllReady(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (s.phase !== 'REVIEW' || !rs?.review) return;
  const review = rs.review;
  const here = rs.playing.filter((id) => getPlayer(s, id)?.connected === true);
  if (here.length > 0 && here.every((id) => review.ready.includes(id))) nextCategory(env);
}

/**
 * Cambió quién está conectado (o quién juega): recalcula la categoría en curso, avisa si algo
 * cambió y revisa si ya están todos listos.
 */
export function afterPresenceChange(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (s.phase !== 'REVIEW' || !rs?.review || !rs.groups) return;
  const category = currentCategory(rs);
  if (!category) return;
  const groups = rs.groups[category];
  const before = JSON.stringify(groups);
  applyStatus(s, rs, groups);
  if (JSON.stringify(groups) !== before) emitUpdate(env);
  checkAllReady(env);
}

/** Un participante se fue para siempre: sus respuestas y votos dejan lo que queda por revisar. */
export function purgeFromRound(env: Env, playerId: PlayerId): void {
  const rs = env.state.current;
  if (!rs) return;
  rs.playing = rs.playing.filter((id) => id !== playerId);
  delete rs.sheets[playerId];
  // Las categorías ya revisadas quedan congeladas (autores, votos y puntos tal como se cerraron):
  // purgarlas sin recalcular dejaría puntos que no calzan con los autores. Solo se limpian la
  // categoría en curso y las que faltan. En ROUND_END (sin `review`) ya está todo cerrado.
  if (rs.groups && rs.review) {
    for (const id of rs.review.order.slice(rs.review.index)) {
      rs.groups[id] = rs.groups[id].filter((g) => {
        g.playerIds = g.playerIds.filter((p) => p !== playerId);
        g.rejectedBy = g.rejectedBy.filter((p) => p !== playerId);
        return g.playerIds.length > 0;
      });
    }
  }
  if (rs.review) rs.review.ready = rs.review.ready.filter((id) => id !== playerId);
  afterPresenceChange(env);
}

export function handleVote(env: Env, playerId: PlayerId, key: string, reject: boolean): Outcome {
  const s = env.state;
  const rs = s.current;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.phase !== 'REVIEW' || !rs?.review || !rs.groups) return { error: 'wrong_phase' };
  if (!rs.playing.includes(playerId)) return { error: 'not_playing' };
  const category = currentCategory(rs);
  const groups = category ? rs.groups[category] : undefined;
  const group = groups?.find((g) => g.key === key);
  if (!groups || !group) return { error: 'unknown_answer' };
  if (group.playerIds.includes(playerId)) return { error: 'own_answer' };
  if (group.status === 'wrong_letter') return { error: 'unknown_answer' };

  const voted = group.rejectedBy.includes(playerId);
  if (voted === reject) return {}; // sin cambios
  group.rejectedBy = reject
    ? [...group.rejectedBy, playerId]
    : group.rejectedBy.filter((id) => id !== playerId);
  applyStatus(s, rs, groups);
  emitUpdate(env);
  return {};
}

export function handleReady(env: Env, playerId: PlayerId, ready: boolean): Outcome {
  const s = env.state;
  const rs = s.current;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.phase !== 'REVIEW' || !rs?.review) return { error: 'wrong_phase' };
  if (!rs.playing.includes(playerId)) return { error: 'not_playing' };

  const marked = rs.review.ready.includes(playerId);
  if (marked === ready) return {}; // sin cambios
  rs.review.ready = ready
    ? [...rs.review.ready, playerId]
    : rs.review.ready.filter((id) => id !== playerId);
  emitUpdate(env);
  checkAllReady(env);
  return {};
}
