// API pública del motor de reglas (docs/motor-reglas.md).

export { DEFAULT_ENGINE_CONFIG } from './config.js';
export { createGame, nextWakeAt, reduce } from './reducer.js';
export { buildSnapshot } from './snapshot.js';
export type {
  Action,
  Effect,
  EngineConfig,
  EngineContext,
  EngineEvent,
  EnginePlayer,
  EngineSnapshot,
  GameState,
  PlayerId,
  ReduceResult,
  Recipient,
  ReviewProgress,
  RoundState,
} from './types.js';
