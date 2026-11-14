// Constantes del contrato (PLAN.md secciones 2 y 4). Nadie las duplica: se importan de aquí.

import type { Category } from './types.js';

// --- Categorías y letras --------------------------------------------------

/** Ids de las categorías, en el orden de la hoja. */
export const CATEGORY_IDS = [
  'nombre',
  'lugar',
  'cosa',
  'fruta',
  'animal',
  'tv',
  'cantante',
] as const;

/** Categorías fijas del MVP (las de la hoja original), en el orden de la tabla del plan. */
export const CATEGORIES: readonly Category[] = [
  { id: 'nombre', label: 'Nombre o apellido' },
  { id: 'lugar', label: 'Ciudad o país' },
  { id: 'cosa', label: 'Color o cosa' },
  { id: 'fruta', label: 'Fruta o verdura' },
  { id: 'animal', label: 'Animal o ave' },
  { id: 'tv', label: 'Serie, programa de TV o personaje' },
  { id: 'cantante', label: 'Cantante' },
];

/** Letras que pueden salir (sin K, Ñ, Q, W, X, Y, Z). Una por ronda, sin repetir en la partida. */
export const LETTERS = 'ABCDEFGHIJLMNOPRSTUV';

// --- Límites de entrada ---------------------------------------------------

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;
export const MESSAGE_MAX_LENGTH = 80;
/** Largo máximo de la respuesta de una categoría. */
export const ANSWER_MAX_LENGTH = 30;
export const MAX_TEXT_MESSAGES_PER_SECOND = 3;
export const MAX_ANSWER_UPDATES_PER_SECOND = 20;

// --- Reglas del juego (valores por defecto, sección 2) --------------------

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 12;

export const DEFAULT_ROUNDS = 5;
export const DEFAULT_WRITE_SECONDS = 90;
/** Rango permitido para los ajustes que cambia el anfitrión. */
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 10;
export const MIN_WRITE_SECONDS = 30;
export const MAX_WRITE_SECONDS = 180;

/** Máximo que gira la ruleta; si nadie la detiene, se detiene sola. */
export const LETTER_SPIN_SECONDS = 8;
/** Tiempo con la letra en grande antes de empezar a escribir. */
export const LETTER_REVEAL_SECONDS = 3;
/** Gracia tras el STOP (o el fin del tiempo) para que lleguen las últimas teclas. */
export const STOP_GRACE_MS = 1000;
/** Tiempo de revisión por categoría, o antes si todos marcan "Listo". */
export const REVIEW_SECONDS = 20;
/** Pausa de fin de ronda mostrando puntos de la ronda y acumulados. */
export const ROUND_END_SECONDS = 10;

/** Puntos por categoría sobre respuestas válidas. */
export const SCORE_REPEATED = 50;
export const SCORE_UNIQUE = 100;
export const SCORE_ALONE = 200;

// --- Sesiones y salas -----------------------------------------------------

/** Un jugador caído conserva su puesto, puntaje y hoja durante este tiempo. */
export const RECONNECT_GRACE_SECONDS = 30;
/** Una sala vacía se borra tras este tiempo. */
export const EMPTY_ROOM_TTL_SECONDS = 60;

export const ROOM_CODE_LENGTH = 4;
/** Letras sin caracteres ambiguos (sin I, L ni O). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export const SESSION_ID_MIN_LENGTH = 8;
export const SESSION_ID_MAX_LENGTH = 64;
