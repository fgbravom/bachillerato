// Configuración por defecto del motor, armada con las constantes de @bach/shared.

import {
  LETTER_REVEAL_SECONDS,
  LETTER_SPIN_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  RECONNECT_GRACE_SECONDS,
  REVIEW_SECONDS,
  ROUND_END_SECONDS,
  STOP_GRACE_MS,
} from '@bach/shared';
import type { EngineConfig } from './types.js';

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  minPlayers: MIN_PLAYERS_TO_START,
  maxPlayers: MAX_PLAYERS,
  letterSpinMs: LETTER_SPIN_SECONDS * 1000,
  letterRevealMs: LETTER_REVEAL_SECONDS * 1000,
  stopGraceMs: STOP_GRACE_MS,
  reviewMs: REVIEW_SECONDS * 1000,
  roundEndMs: ROUND_END_SECONDS * 1000,
  graceMs: RECONNECT_GRACE_SECONDS * 1000,
};
