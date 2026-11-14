// Chat de la sala (docs/motor-reglas.md sección 6, "message").

import { emit, getPlayer, toRoom } from './env.js';
import type { Env, Outcome } from './env.js';
import type { PlayerId } from './types.js';

export function handleMessage(env: Env, playerId: PlayerId, rawText: string): Outcome {
  const s = env.state;
  if (!getPlayer(s, playerId)) return { error: 'not_in_room' };
  const text = rawText.trim();
  if (text === '') return {};
  // En LETTER y WRITING no hay chat: todos miran la hoja o la ruleta.
  if (s.phase === 'LETTER' || s.phase === 'WRITING') return { error: 'wrong_phase' };
  emit(env, toRoom, 'message:new', { playerId, text });
  return {};
}
