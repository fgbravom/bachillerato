// Eventos de Socket.IO: nombres y payloads tipados (PLAN.md sección 4).
// `ClientToServerEvents` y `ServerToClientEvents` se usan como genéricos de Socket.IO:
//   new Server<ClientToServerEvents, ServerToClientEvents>(...)
//   io<ServerToClientEvents, ClientToServerEvents>(...)

import type {
  AnswersUpdatePayload,
  MessageSendPayload,
  ReviewReadyPayload,
  ReviewVotePayload,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomSettingsPayload,
} from './schemas.js';
import type {
  CategoryId,
  ErrorCode,
  Player,
  RankingEntry,
  ReviewGroup,
  ReviewState,
  RoomState,
  RoundEnd,
} from './types.js';

export const CLIENT_EVENTS = {
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_SETTINGS: 'room:settings',
  GAME_START: 'game:start',
  LETTER_STOP: 'letter:stop',
  ANSWERS_UPDATE: 'answers:update',
  ROUND_STOP: 'round:stop',
  REVIEW_VOTE: 'review:vote',
  REVIEW_READY: 'review:ready',
  MESSAGE_SEND: 'message:send',
} as const;

export const SERVER_EVENTS = {
  ROOM_STATE: 'room:state',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  PLAYER_UPDATED: 'player:updated',
  ROUND_LETTER: 'round:letter',
  ROUND_LETTER_CHOSEN: 'round:letter-chosen',
  ROUND_WRITING: 'round:writing',
  ROUND_PROGRESS: 'round:progress',
  ROUND_STOPPED: 'round:stopped',
  REVIEW_CATEGORY: 'review:category',
  REVIEW_UPDATE: 'review:update',
  ROUND_END: 'round:end',
  GAME_END: 'game:end',
  MESSAGE_NEW: 'message:new',
  SYSTEM_ERROR: 'system:error',
  SYSTEM_ONLINE: 'system:online',
} as const;

// --- Acuses (ack) de room:create y room:join ------------------------------

export type AckError = { ok: false; error: ErrorCode };
/** Acuse de `room:create` y `room:join`. Tras un éxito, el servidor además emite `room:state`. */
export type RoomAck = { ok: true; code: string; playerId: string } | AckError;

// --- Payloads servidor -> cliente -----------------------------------------

/** Empieza a girar la ruleta. `endsAt` = plazo para que `pickerId` la detenga. */
export type RoundLetterPayload = {
  round: number;
  totalRounds: number;
  pickerId: string;
  endsAt: number;
};
/** La ruleta se detuvo. `endsAt` = inicio de la escritura. */
export type RoundLetterChosenPayload = { letter: string; endsAt: number };
/** Empieza la escritura. `endsAt` = fin del tiempo. */
export type RoundWritingPayload = { letter: string; endsAt: number };
export type RoundProgressPayload = { playerId: string; filled: number };
/** Se bloquean las hojas. `by` = quien gritó STOP (null si se acabó el tiempo); `endsAt` = fin de la gracia. */
export type RoundStoppedPayload = { by: string | null; endsAt: number };
/** Empieza la revisión de una categoría. */
export type ReviewCategoryPayload = ReviewState & { endsAt: number };
/** Cambió algo en la categoría en revisión (un voto o un "Listo"). */
export type ReviewUpdatePayload = {
  category: CategoryId;
  groups: ReviewGroup[];
  /** Ids de quienes marcaron "Listo". */
  ready: string[];
};
export type RoundEndPayload = RoundEnd & { endsAt: number };
export type GameEndPayload = { ranking: RankingEntry[] };
export type MessageNewPayload = { playerId: string; text: string };
export type SystemErrorPayload = { code: ErrorCode };
export type SystemOnlinePayload = { count: number };

// --- Mapas de eventos para los genéricos de Socket.IO ---------------------

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, ack: (res: RoomAck) => void) => void;
  'room:join': (payload: RoomJoinPayload, ack: (res: RoomAck) => void) => void;
  'room:settings': (payload: RoomSettingsPayload) => void;
  'game:start': () => void;
  'letter:stop': () => void;
  'answers:update': (payload: AnswersUpdatePayload) => void;
  'round:stop': () => void;
  'review:vote': (payload: ReviewVotePayload) => void;
  'review:ready': (payload: ReviewReadyPayload) => void;
  'message:send': (payload: MessageSendPayload) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'player:joined': (player: Player) => void;
  'player:left': (player: Player) => void;
  'player:updated': (player: Player) => void;
  'round:letter': (payload: RoundLetterPayload) => void;
  'round:letter-chosen': (payload: RoundLetterChosenPayload) => void;
  'round:writing': (payload: RoundWritingPayload) => void;
  'round:progress': (payload: RoundProgressPayload) => void;
  'round:stopped': (payload: RoundStoppedPayload) => void;
  'review:category': (payload: ReviewCategoryPayload) => void;
  'review:update': (payload: ReviewUpdatePayload) => void;
  'round:end': (payload: RoundEndPayload) => void;
  'game:end': (payload: GameEndPayload) => void;
  'message:new': (payload: MessageNewPayload) => void;
  'system:error': (payload: SystemErrorPayload) => void;
  'system:online': (payload: SystemOnlinePayload) => void;
}

export type ClientEventName = keyof ClientToServerEvents;
export type ServerEventName = keyof ServerToClientEvents;
