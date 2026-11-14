// Ciclo de rondas: ruleta de letra, escritura, STOP, fin de ronda y fin de partida
// (docs/motor-reglas.md sección 5).

import {
  ANSWER_MAX_LENGTH,
  CATEGORY_IDS,
  LETTERS,
  normalizeAnswer,
  startsWithLetter,
} from '@bach/shared';
import type { Answers, CategoryId, ReviewGroup, RoundEnd } from '@bach/shared';
import { emit, getPlayer, toRoom } from './env.js';
import type { Env, Outcome } from './env.js';
import { computeGains, ranking } from './scoring.js';
import { buildSnapshot, filledCount, toPlayer } from './snapshot.js';
import type { PlayerId, RoundState } from './types.js';

function writeMs(env: Env): number {
  const { config, settings } = env.state;
  return config.writeMsOverride ?? settings.writeSeconds * 1000;
}

/** Ids de quienes se ven como participantes de la ronda en curso (derivado de fase y ronda). */
function playingIds(env: Env): Set<PlayerId> {
  return new Set(env.state.players.filter((p) => toPlayer(env.state, p).playing).map((p) => p.id));
}

/** Avisa con `player:updated` a quienes cambiaron de participar a no participar, o al revés. */
function emitPlayingChanges(env: Env, before: ReadonlySet<PlayerId>): void {
  const after = playingIds(env);
  for (const p of env.state.players) {
    if (before.has(p.id) !== after.has(p.id)) {
      emit(env, toRoom, 'player:updated', toPlayer(env.state, p));
    }
  }
}

/** Rotación por orden de llegada: cada participante detiene la ruleta una vez por ciclo. */
function pickNext(env: Env, participants: PlayerId[]): PlayerId {
  const s = env.state;
  let candidates = participants.filter((id) => !s.pickers.includes(id));
  if (candidates.length === 0) {
    s.pickers = [];
    candidates = participants;
  }
  const picker = candidates[0];
  if (picker === undefined) throw new Error('pickNext sin participantes');
  s.pickers.push(picker);
  return picker;
}

/** Empieza una ronda: fija a los participantes (los conectados ahora) y parte la ruleta. */
export function startRound(env: Env): void {
  const s = env.state;
  const participants = s.players.filter((p) => p.connected).map((p) => p.id);
  if (participants.length === 0) {
    endGame(env);
    return;
  }
  const before = playingIds(env);
  s.round += 1;
  const sheets: Record<PlayerId, Answers> = {};
  for (const id of participants) sheets[id] = {};
  const round: RoundState = {
    letter: null,
    pickerId: pickNext(env, participants),
    playing: participants,
    sheets,
    stopped: null,
    groups: null,
    review: null,
    end: null,
  };
  s.current = round;
  s.phase = 'LETTER';
  s.deadline = env.ctx.now + s.config.letterSpinMs;
  emitPlayingChanges(env, before);
  emit(env, toRoom, 'round:letter', {
    round: s.round,
    totalRounds: s.settings.rounds,
    pickerId: round.pickerId,
    endsAt: s.deadline,
  });
}

/** Sortea la letra de la ronda: la de `lettersOverride` o una al azar entre las no usadas. */
function chooseLetter(env: Env): string {
  const s = env.state;
  const override = s.config.lettersOverride;
  let letter: string | undefined;
  if (override && override.length > 0) {
    letter = override[(s.round - 1) % override.length];
  } else {
    let pool = [...LETTERS].filter((l) => !s.usedLetters.includes(l));
    if (pool.length === 0) {
      s.usedLetters = []; // no ocurre con 10 rondas como máximo; evita quedarse sin letras
      pool = [...LETTERS];
    }
    letter = pool[Math.min(pool.length - 1, Math.floor(env.ctx.rng() * pool.length))];
  }
  if (letter === undefined) throw new Error('chooseLetter sin letra');
  s.usedLetters.push(letter);
  return letter;
}

/** La ruleta se detiene (por `letter:stop` o por plazo): se revela la letra unos segundos. */
export function revealLetter(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (!rs) throw new Error('revealLetter sin ronda');
  rs.letter = chooseLetter(env);
  s.deadline = env.ctx.now + s.config.letterRevealMs;
  emit(env, toRoom, 'round:letter-chosen', { letter: rs.letter, endsAt: s.deadline });
}

export function beginWriting(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (!rs?.letter) throw new Error('beginWriting sin letra');
  s.phase = 'WRITING';
  s.deadline = env.ctx.now + writeMs(env);
  emit(env, toRoom, 'round:writing', { letter: rs.letter, endsAt: s.deadline });
}

/** Cierra las hojas (STOP o fin del tiempo) y abre la gracia para las últimas teclas. */
export function closeWriting(env: Env, by: PlayerId | null): void {
  const s = env.state;
  const rs = s.current;
  if (!rs) throw new Error('closeWriting sin ronda');
  rs.stopped = { by };
  s.deadline = env.ctx.now + s.config.stopGraceMs;
  emit(env, toRoom, 'round:stopped', { by, endsAt: s.deadline });
}

/** Cierra la ronda: suma los puntos finales de cada categoría y muestra la tabla. */
export function endRound(env: Env): void {
  const s = env.state;
  const rs = s.current;
  if (!rs?.letter) throw new Error('endRound sin letra');
  const results = {} as Record<CategoryId, ReviewGroup[]>;
  for (const id of CATEGORY_IDS) results[id] = rs.groups?.[id] ?? [];
  const gains = computeGains(results, s.players);
  const scores: Record<string, number> = {};
  for (const p of s.players) {
    p.score += gains[p.id] ?? 0;
    scores[p.id] = p.score;
  }
  const end: RoundEnd = {
    letter: rs.letter,
    gains,
    scores,
    results,
    stoppedBy: rs.stopped?.by ?? null,
  };
  rs.end = end;
  rs.review = null;
  s.phase = 'ROUND_END';
  s.deadline = env.ctx.now + s.config.roundEndMs;
  emit(env, toRoom, 'round:end', { ...structuredClone(end), endsAt: s.deadline });
}

export function endGame(env: Env): void {
  const s = env.state;
  const before = playingIds(env);
  s.current = null;
  s.phase = 'GAME_END';
  s.deadline = null;
  s.ranking = ranking(s.players);
  emitPlayingChanges(env, before);
  emit(env, toRoom, 'game:end', { ranking: s.ranking });
}

export function toLobby(env: Env): void {
  const s = env.state;
  s.phase = 'LOBBY';
  s.round = 0;
  s.current = null;
  s.deadline = null;
  s.ranking = null;
  for (const p of s.players) {
    if (p.connected) {
      env.fx.push({
        type: 'snapshot',
        playerId: p.id,
        snapshot: buildSnapshot(s, p.id, env.ctx.now),
      });
    }
  }
}

export function handleStopLetter(env: Env, playerId: PlayerId): Outcome {
  const s = env.state;
  const rs = s.current;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.phase !== 'LETTER' || !rs || rs.letter !== null) return { error: 'wrong_phase' };
  if (rs.pickerId !== playerId) return { error: 'not_picker' };
  revealLetter(env);
  return {};
}

export function handleUpdateAnswer(
  env: Env,
  playerId: PlayerId,
  category: CategoryId,
  rawText: string,
): Outcome {
  const s = env.state;
  const rs = s.current;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.phase !== 'WRITING' || !rs) return { error: 'wrong_phase' };
  const sheet = rs.sheets[playerId];
  if (!rs.playing.includes(playerId) || !sheet) return { error: 'not_playing' };
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!CATEGORY_IDS.includes(category) || text.length > ANSWER_MAX_LENGTH) {
    return { error: 'invalid_payload' };
  }

  const before = filledCount(sheet);
  // Un texto sin letras ni números (solo signos) equivale a dejar la categoría vacía.
  if (normalizeAnswer(text) === '') delete sheet[category];
  else sheet[category] = text;
  const filled = filledCount(sheet);
  if (filled !== before) emit(env, toRoom, 'round:progress', { playerId, filled });
  return {};
}

/** STOP: exige las 7 categorías con texto y empezando con la letra. */
export function handleStop(env: Env, playerId: PlayerId): Outcome {
  const s = env.state;
  const rs = s.current;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.phase !== 'WRITING' || !rs || rs.stopped) return { error: 'wrong_phase' };
  const sheet = rs.sheets[playerId];
  if (!rs.playing.includes(playerId) || !sheet) return { error: 'not_playing' };
  const letter = rs.letter ?? '';
  const complete = CATEGORY_IDS.every((id) => {
    const text = sheet[id];
    return text !== undefined && startsWithLetter(text, letter);
  });
  if (!complete) return { error: 'sheet_incomplete' };
  closeWriting(env, playerId);
  return {};
}
