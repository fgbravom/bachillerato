// Reductor del motor: aplica una acción y devuelve el estado nuevo con sus efectos.

import {
  DEFAULT_ROUNDS,
  DEFAULT_WRITE_SECONDS,
  MAX_ROUNDS,
  MAX_WRITE_SECONDS,
  MIN_ROUNDS,
  MIN_WRITE_SECONDS,
} from '@bach/shared';
import type { GameSettings } from '@bach/shared';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { emit, getPlayer, toRoom } from './env.js';
import type { Env, Outcome } from './env.js';
import { handleMessage } from './messages.js';
import { handleDisconnect, handleJoin, removePlayer } from './players.js';
import { beginReview, handleReady, handleVote, nextCategory } from './review.js';
import {
  beginWriting,
  closeWriting,
  endGame,
  handleStop,
  handleStopLetter,
  handleUpdateAnswer,
  revealLetter,
  startRound,
  toLobby,
} from './rounds.js';
import { buildSnapshot, toPlayer } from './snapshot.js';
import type {
  Action,
  EngineConfig,
  EngineContext,
  GameState,
  PlayerId,
  ReduceResult,
} from './types.js';

/** Tope de vencimientos procesados en una sola acción; superarlo indica un bucle. */
const MAX_ADVANCE_LOOPS = 50;

export function createGame(
  config: Partial<EngineConfig> = {},
  settings: Partial<GameSettings> = {},
): GameState {
  return {
    phase: 'LOBBY',
    config: { ...DEFAULT_ENGINE_CONFIG, ...config },
    settings: { rounds: DEFAULT_ROUNDS, writeSeconds: DEFAULT_WRITE_SECONDS, ...settings },
    players: [],
    hostId: null,
    round: 0,
    usedLetters: [],
    pickers: [],
    current: null,
    deadline: null,
    ranking: null,
  };
}

/** Un vencimiento pendiente. En empate gana el de menor `priority`: gracia y luego plazo. */
type Due =
  | { kind: 'grace'; at: number; priority: 0; playerId: PlayerId }
  | { kind: 'deadline'; at: number; priority: 1 };

function nextDue(state: GameState): Due | null {
  const dues: Due[] = [];
  for (const p of state.players) {
    if (!p.connected && p.disconnectedAt !== null) {
      dues.push({
        kind: 'grace',
        at: p.disconnectedAt + state.config.graceMs,
        priority: 0,
        playerId: p.id,
      });
    }
  }
  if (state.deadline !== null) dues.push({ kind: 'deadline', at: state.deadline, priority: 1 });

  // El orden de inserción desempata entre gracias del mismo instante (orden de llegada).
  return dues.reduce<Due | null>(
    (best, due) =>
      !best || due.at < best.at || (due.at === best.at && due.priority < best.priority)
        ? due
        : best,
    null,
  );
}

/** Instante del próximo vencimiento (gracia o plazo de la fase), o null si no hay. */
export function nextWakeAt(state: GameState): number | null {
  return nextDue(state)?.at ?? null;
}

/** Procesa, en orden, los vencimientos que ya pasaron. */
function advance(env: Env): void {
  for (let i = 0; i <= MAX_ADVANCE_LOOPS; i++) {
    const due = nextDue(env.state);
    if (!due || due.at > env.ctx.now) return;
    if (i === MAX_ADVANCE_LOOPS) throw new Error('advance: demasiados vencimientos seguidos');
    switch (due.kind) {
      case 'grace':
        removePlayer(env, due.playerId);
        break;
      case 'deadline':
        onDeadline(env);
        break;
      default:
        return assertNever(due);
    }
  }
}

function onDeadline(env: Env): void {
  const s = env.state;
  const rs = s.current;
  switch (s.phase) {
    case 'LETTER':
      // Girando: la ruleta se detiene sola. Revelada: empieza la escritura.
      if (rs?.letter === null) revealLetter(env);
      else beginWriting(env);
      break;
    case 'WRITING':
      // Sin cerrar: se acabó el tiempo. Cerrada: terminó la gracia.
      if (rs?.stopped) beginReview(env);
      else closeWriting(env, null);
      break;
    case 'REVIEW':
      nextCategory(env);
      break;
    case 'ROUND_END':
      if (s.round < s.settings.rounds) startRound(env);
      else endGame(env);
      break;
    default:
      s.deadline = null;
  }
}

function handleUpdateSettings(
  env: Env,
  playerId: PlayerId,
  rounds: number,
  writeSeconds: number,
): Outcome {
  const s = env.state;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.hostId !== playerId) return { error: 'not_host' };
  if (s.phase !== 'LOBBY') return { error: 'wrong_phase' };
  const roundsOk = Number.isInteger(rounds) && rounds >= MIN_ROUNDS && rounds <= MAX_ROUNDS;
  const secondsOk =
    Number.isInteger(writeSeconds) &&
    writeSeconds >= MIN_WRITE_SECONDS &&
    writeSeconds <= MAX_WRITE_SECONDS;
  if (!roundsOk || !secondsOk) return { error: 'invalid_payload' };

  s.settings = { rounds, writeSeconds };
  for (const p of s.players) {
    if (p.connected) {
      env.fx.push({
        type: 'snapshot',
        playerId: p.id,
        snapshot: buildSnapshot(s, p.id, env.ctx.now),
      });
    }
  }
  return {};
}

function handleStart(env: Env, playerId: PlayerId): Outcome {
  const s = env.state;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  if (s.hostId !== playerId) return { error: 'not_host' };

  // "Jugar de nuevo": desde GAME_END el anfitrión vuelve a la sala de espera.
  if (s.phase === 'GAME_END') {
    toLobby(env);
    return {};
  }
  if (s.phase !== 'LOBBY') return { error: 'wrong_phase' };
  if (s.players.filter((p) => p.connected).length < s.config.minPlayers) {
    return { error: 'not_enough_players' };
  }

  for (const p of s.players) {
    if (p.score !== 0) {
      p.score = 0;
      emit(env, toRoom, 'player:updated', toPlayer(s, p));
    }
  }
  s.round = 0;
  s.usedLetters = [];
  s.pickers = [];
  startRound(env);
  return {};
}

function dispatch(env: Env, action: Action): Outcome {
  switch (action.type) {
    case 'join':
      return handleJoin(env, action);
    case 'disconnect':
      return handleDisconnect(env, action.playerId, action.connId);
    case 'leave':
      if (!getPlayer(env.state, action.playerId)) return { error: 'not_in_room' };
      removePlayer(env, action.playerId);
      return {};
    case 'updateSettings':
      return handleUpdateSettings(env, action.playerId, action.rounds, action.writeSeconds);
    case 'start':
      return handleStart(env, action.playerId);
    case 'stopLetter':
      return handleStopLetter(env, action.playerId);
    case 'updateAnswer':
      return handleUpdateAnswer(env, action.playerId, action.category, action.text);
    case 'stop':
      return handleStop(env, action.playerId);
    case 'vote':
      return handleVote(env, action.playerId, action.key, action.reject);
    case 'ready':
      return handleReady(env, action.playerId, action.ready);
    case 'message':
      return handleMessage(env, action.playerId, action.text);
    case 'tick':
      return {};
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Caso no manejado: ${JSON.stringify(value)}`);
}

/**
 * Aplica `action` a una copia del estado. Primero procesa los vencimientos pasados (`advance`);
 * si la acción falla, el estado solo refleja eso y los efectos son únicamente los de `advance`.
 */
export function reduce(state: GameState, action: Action, ctx: EngineContext): ReduceResult {
  const env: Env = { state: structuredClone(state), ctx, fx: [] };
  advance(env);
  const advanced = env.fx.length;
  const outcome = dispatch(env, action);
  if (outcome.error) {
    return { state: env.state, effects: env.fx.slice(0, advanced), error: outcome.error };
  }
  const result: ReduceResult = { state: env.state, effects: env.fx };
  if (outcome.playerId !== undefined) result.playerId = outcome.playerId;
  return result;
}
