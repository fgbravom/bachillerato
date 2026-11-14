// Tipos del motor de reglas (docs/motor-reglas.md sección 3).

import type {
  Answers,
  CategoryId,
  ErrorCode,
  GameSettings,
  Phase,
  RankingEntry,
  ReviewGroup,
  RoomState,
  RoundEnd,
  ServerToClientEvents,
} from '@bach/shared';

export type PlayerId = string;

export interface EngineConfig {
  minPlayers: number; // MIN_PLAYERS_TO_START
  maxPlayers: number; // MAX_PLAYERS
  letterSpinMs: number; // LETTER_SPIN_SECONDS * 1000
  letterRevealMs: number; // LETTER_REVEAL_SECONDS * 1000
  stopGraceMs: number; // STOP_GRACE_MS
  reviewMs: number; // REVIEW_SECONDS * 1000
  roundEndMs: number; // ROUND_END_SECONDS * 1000
  graceMs: number; // RECONNECT_GRACE_SECONDS * 1000
  writeMsOverride?: number; // solo pruebas e2e: reemplaza settings.writeSeconds * 1000
  lettersOverride?: readonly string[]; // solo pruebas e2e: la ronda n usa la letra [(n - 1) % largo]
}

export interface EnginePlayer {
  id: PlayerId;
  sessionId: string; // secreto
  name: string;
  score: number;
  connected: boolean;
  connId: string | null; // socket actual
  disconnectedAt: number | null; // inicio de la gracia
}

/** Avance de la revisión: una categoría a la vez, saltando las que nadie respondió. */
export interface ReviewProgress {
  order: CategoryId[]; // categorías con al menos una respuesta, en el orden de CATEGORIES
  index: number; // posición en `order`
  ready: PlayerId[]; // quienes marcaron "Listo" en la categoría en curso
}

export interface RoundState {
  letter: string | null; // null mientras gira la ruleta
  pickerId: PlayerId; // a quien le toca detener la ruleta
  playing: PlayerId[]; // participantes, fijos al entrar en LETTER (orden de llegada)
  sheets: Record<PlayerId, Answers>; // hojas; nunca salen a otro jugador durante WRITING
  stopped: { by: PlayerId | null } | null; // WRITING cerrada (gracia en curso)
  groups: Record<CategoryId, ReviewGroup[]> | null; // se arman al entrar en REVIEW
  review: ReviewProgress | null; // solo en REVIEW
  end: RoundEnd | null; // se fija al entrar en ROUND_END
}

export interface GameState {
  phase: Phase;
  config: EngineConfig;
  settings: GameSettings;
  players: EnginePlayer[]; // orden del arreglo = orden de llegada
  hostId: PlayerId | null;
  round: number; // 0 en LOBBY
  usedLetters: string[]; // letras ya sorteadas en la partida
  pickers: PlayerId[]; // quienes ya detuvieron la ruleta en el ciclo de rotación en curso
  current: RoundState | null; // solo de LETTER a ROUND_END
  deadline: number | null; // fin de la fase o subfase; null en LOBBY y GAME_END
  ranking: RankingEntry[] | null; // solo en GAME_END
}

export interface EngineContext {
  now: number;
  rng: () => number;
  newId: () => string;
}

export type Action =
  | { type: 'join'; sessionId: string; name: string; connId: string } // también reconexión y otra pestaña
  | { type: 'disconnect'; playerId: PlayerId; connId: string }
  | { type: 'leave'; playerId: PlayerId } // borrado inmediato
  | { type: 'updateSettings'; playerId: PlayerId; rounds: number; writeSeconds: number }
  | { type: 'start'; playerId: PlayerId }
  | { type: 'stopLetter'; playerId: PlayerId }
  | { type: 'updateAnswer'; playerId: PlayerId; category: CategoryId; text: string }
  | { type: 'stop'; playerId: PlayerId }
  | { type: 'vote'; playerId: PlayerId; key: string; reject: boolean }
  | { type: 'ready'; playerId: PlayerId; ready: boolean }
  | { type: 'message'; playerId: PlayerId; text: string }
  | { type: 'tick' };

export type Recipient =
  | { kind: 'room' }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'roomExcept'; playerId: PlayerId }
  | { kind: 'players'; playerIds: PlayerId[] };

export type EngineEvent =
  | 'player:joined'
  | 'player:left'
  | 'player:updated'
  | 'round:letter'
  | 'round:letter-chosen'
  | 'round:writing'
  | 'round:progress'
  | 'round:stopped'
  | 'review:category'
  | 'review:update'
  | 'round:end'
  | 'game:end'
  | 'message:new';

export type EngineSnapshot = Omit<RoomState, 'code'>; // la red agrega code

export type Effect =
  | {
      [E in EngineEvent]: {
        type: 'emit';
        to: Recipient;
        event: E;
        payload: Parameters<ServerToClientEvents[E]>[0];
      };
    }[EngineEvent]
  | { type: 'snapshot'; playerId: PlayerId; snapshot: EngineSnapshot } // la red envía room:state
  | { type: 'disconnectConn'; connId: string }; // la red cierra el socket viejo

export interface ReduceResult {
  state: GameState;
  effects: Effect[]; // en orden causal
  error?: ErrorCode; // con error, el estado solo refleja advance() y no hay efectos de la acción
  playerId?: PlayerId; // en un join exitoso
}
