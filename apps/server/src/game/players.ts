// Jugadores: entrada y reconexión, desconexión, borrado y anfitrión
// (docs/motor-reglas.md secciones 5 y 7).

import { NICKNAME_MAX_LENGTH, normalizeAnswer } from '@bach/shared';
import { emit, getPlayer, toRoom, toRoomExcept } from './env.js';
import type { Env, Outcome } from './env.js';
import { afterPresenceChange, purgeFromRound } from './review.js';
import { toLobby } from './rounds.js';
import { buildSnapshot, toPlayer } from './snapshot.js';
import type { EnginePlayer, PlayerId } from './types.js';

/** Si el nombre ya existe (comparado con `normalizeAnswer`), agrega ` 2`, ` 3`... sin pasar el largo máximo. */
export function uniqueName(name: string, players: readonly EnginePlayer[]): string {
  const taken = new Set(players.map((p) => normalizeAnswer(p.name)));
  if (!taken.has(normalizeAnswer(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, NICKNAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
    if (!taken.has(normalizeAnswer(candidate))) return candidate;
  }
}

/** El rol pasa al conectado más antiguo; si no hay, al más antiguo. */
export function transferHost(env: Env): void {
  const s = env.state;
  const next = s.players.find((p) => p.connected) ?? s.players[0];
  s.hostId = next?.id ?? null;
  if (next) emit(env, toRoom, 'player:updated', toPlayer(s, next));
}

export function handleJoin(
  env: Env,
  action: { sessionId: string; name: string; connId: string },
): Outcome {
  const s = env.state;
  const existing = s.players.find((p) => p.sessionId === action.sessionId);

  if (existing) {
    if (existing.connected && existing.connId !== null && existing.connId !== action.connId) {
      env.fx.push({ type: 'disconnectConn', connId: existing.connId });
    }
    const wasConnected = existing.connected;
    existing.connected = true;
    existing.connId = action.connId;
    existing.disconnectedAt = null;
    if (!wasConnected) {
      emit(env, toRoomExcept(existing.id), 'player:updated', toPlayer(s, existing));
      afterPresenceChange(env); // un votante más: puede cambiar la mayoría
    }
    env.fx.push({
      type: 'snapshot',
      playerId: existing.id,
      snapshot: buildSnapshot(s, existing.id, env.ctx.now),
    });
    return { playerId: existing.id };
  }

  if (s.players.length >= s.config.maxPlayers) return { error: 'room_full' };

  // Quien entra a mitad de ronda no es participante (`playing`): mira hasta la ronda siguiente.
  const player: EnginePlayer = {
    id: env.ctx.newId(),
    sessionId: action.sessionId,
    name: uniqueName(action.name, s.players),
    score: 0,
    connected: true,
    connId: action.connId,
    disconnectedAt: null,
  };
  s.players.push(player);
  if (s.hostId === null) s.hostId = player.id;
  emit(env, toRoomExcept(player.id), 'player:joined', toPlayer(s, player));
  env.fx.push({
    type: 'snapshot',
    playerId: player.id,
    snapshot: buildSnapshot(s, player.id, env.ctx.now),
  });
  return { playerId: player.id };
}

export function handleDisconnect(env: Env, playerId: PlayerId, connId: string): Outcome {
  const s = env.state;
  const player = getPlayer(s, playerId);
  if (!player || !player.connected || player.connId !== connId) return {};

  player.connected = false;
  player.connId = null;
  player.disconnectedAt = env.ctx.now;
  emit(env, toRoom, 'player:updated', toPlayer(s, player));
  afterPresenceChange(env); // un votante menos: cambia la mayoría y quizás ya están todos listos
  return {};
}

export function removePlayer(env: Env, playerId: PlayerId): void {
  const s = env.state;
  const index = s.players.findIndex((p) => p.id === playerId);
  const player = s.players[index];
  if (!player) return;

  const view = toPlayer(s, player);
  s.players.splice(index, 1);
  s.pickers = s.pickers.filter((id) => id !== playerId);
  emit(env, toRoom, 'player:left', view);

  if (s.hostId === playerId) transferHost(env);

  const inRound =
    s.phase === 'LETTER' ||
    s.phase === 'WRITING' ||
    s.phase === 'REVIEW' ||
    s.phase === 'ROUND_END';
  if (inRound && s.players.length < s.config.minPlayers) {
    toLobby(env);
    return;
  }
  purgeFromRound(env, playerId);
}
