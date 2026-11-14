// Tipos del contrato (PLAN.md sección 4).

import type { CATEGORY_IDS } from './constants.js';

export type CategoryId = (typeof CATEGORY_IDS)[number];
export type Category = { id: CategoryId; label: string };

export const PHASES = ['LOBBY', 'LETTER', 'WRITING', 'REVIEW', 'ROUND_END', 'GAME_END'] as const;
export type Phase = (typeof PHASES)[number];

/** Respuestas de un jugador por categoría; las vacías pueden faltar. */
export type Answers = Partial<Record<CategoryId, string>>;

/**
 * Jugador visible para toda la sala. `id` es el identificador público (el que viaja en eventos);
 * el `sessionId` secreto del navegador nunca sale del servidor.
 */
export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  /** Participa en la ronda en curso. */
  playing: boolean;
  /** Categorías con texto en WRITING (0 fuera de ella). */
  filled: number;
  /** Marcó "Listo" en la categoría en revisión. */
  ready: boolean;
};

export type GameSettings = {
  rounds: number;
  writeSeconds: number;
};

export const ANSWER_STATUSES = ['valid', 'rejected', 'wrong_letter'] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

/** Respuestas iguales (tras normalizar) de una categoría, agrupadas. */
export type ReviewGroup = {
  /** Respuesta normalizada; identifica al grupo dentro de la categoría. */
  key: string;
  /** Como la escribió el primer autor. */
  text: string;
  /** Autores. */
  playerIds: string[];
  /** Quienes votaron "No vale". */
  rejectedBy: string[];
  status: AnswerStatus;
  /** Puntos que recibe cada autor (0 si no es válida). */
  points: number;
};

export type ReviewState = {
  category: CategoryId;
  /** Desde 0. */
  index: number;
  total: number;
  /** Sin respuestas vacías. */
  groups: ReviewGroup[];
};

export type RoundEnd = {
  letter: string;
  /** Puntos de la ronda por jugador. */
  gains: Record<string, number>;
  /** Acumulado por jugador. */
  scores: Record<string, number>;
  /** Detalle final de cada categoría. */
  results: Record<CategoryId, ReviewGroup[]>;
  /** Quien gritó STOP; null si se acabó el tiempo. */
  stoppedBy: string | null;
};

export type RankingEntry = {
  playerId: string;
  name: string;
  score: number;
  /** Empates comparten posición (1, 1, 3...). */
  rank: number;
};

export const ERROR_CODES = [
  'invalid_payload',
  'rate_limited',
  'room_not_found',
  'room_full',
  'name_invalid',
  'name_taken',
  'not_in_room',
  'not_host',
  'not_picker',
  'not_playing',
  'wrong_phase',
  'not_enough_players',
  'sheet_incomplete',
  'own_answer',
  'unknown_answer',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Foto completa de la sala para quien entra o se reconecta (`room:state`). */
export type RoomState = {
  code: string;
  phase: Phase;
  settings: GameSettings;
  categories: Category[];
  players: Player[];
  hostId: string;
  /** Id del jugador que recibe esta foto. */
  selfId: string;
  /** Ronda actual (desde 1); 0 en LOBBY. */
  round: number;
  totalRounds: number;
  /** A quién le toca detener la ruleta. */
  pickerId: string | null;
  /** null mientras gira la ruleta. */
  letter: string | null;
  /** Fin de la fase o subfase en curso (hora del servidor, ms); null si no tiene reloj. */
  endsAt: number | null;
  /** Hora del servidor al armar la foto, para calcular el desfase de reloj. */
  serverNow: number;
  /** WRITING ya cerrada (gracia en curso). */
  stopped: { by: string | null } | null;
  /** Solo las propias, en WRITING. */
  myAnswers: Answers | null;
  review: ReviewState | null;
  roundEnd: RoundEnd | null;
  /** Clasificación final, solo en GAME_END. */
  ranking: RankingEntry[] | null;
};
