// Esquemas Zod de cada mensaje entrante (cliente -> servidor). Nada del cliente se cree sin pasar por aquí.

import { z } from 'zod';
import {
  ANSWER_MAX_LENGTH,
  CATEGORY_IDS,
  MAX_ROUNDS,
  MAX_WRITE_SECONDS,
  MESSAGE_MAX_LENGTH,
  MIN_ROUNDS,
  MIN_WRITE_SECONDS,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROOM_CODE_LENGTH,
  SESSION_ID_MAX_LENGTH,
  SESSION_ID_MIN_LENGTH,
} from './constants.js';

// Caracteres de control y de formato (incluye saltos de línea y marcas bidireccionales).
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/u;
// Rellenos que se ven en blanco pero no son espacios ni caracteres de control: Hangul Filler
// (U+3164, U+115F, U+1160, U+FFA0) y el patrón braille vacío (U+2800).
const INVISIBLE_FILLERS = /[ㅤᅟᅠﾠ⠀]/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Apodo: se recortan los espacios de los bordes, los espacios dobles se colapsan, se prohíben los
 * caracteres de control y los rellenos invisibles, y debe traer al menos una letra o un número.
 */
export const nicknameSchema = z
  .string()
  .max(NICKNAME_MAX_LENGTH * 4)
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(NICKNAME_MIN_LENGTH)
      .max(NICKNAME_MAX_LENGTH)
      .refine((s) => !CONTROL_CHARS.test(s) && !INVISIBLE_FILLERS.test(s))
      .refine((s) => HAS_LETTER_OR_DIGIT.test(s)),
  );

export const sessionIdSchema = z
  .string()
  .min(SESSION_ID_MIN_LENGTH)
  .max(SESSION_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Código de sala: se acepta en minúsculas y con espacios en los bordes; sale en mayúsculas. */
export const roomCodeSchema = z
  .string()
  .max(ROOM_CODE_LENGTH * 4)
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`)));

/** Id de categoría: uno de `CATEGORY_IDS`. */
export const categoryIdSchema = z.enum(CATEGORY_IDS);

// --- room:* / game:* ------------------------------------------------------

export const roomCreateSchema = z.object({
  name: nicknameSchema,
  sessionId: sessionIdSchema,
});
export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;

export const roomJoinSchema = z.object({
  code: roomCodeSchema,
  name: nicknameSchema,
  sessionId: sessionIdSchema,
});
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;

export const roomSettingsSchema = z.object({
  rounds: z.number().int().min(MIN_ROUNDS).max(MAX_ROUNDS),
  writeSeconds: z.number().int().min(MIN_WRITE_SECONDS).max(MAX_WRITE_SECONDS),
});
export type RoomSettingsPayload = z.infer<typeof roomSettingsSchema>;

/** Eventos sin datos (`game:start`, `letter:stop`, `round:stop`): se acepta nada o null. */
export const emptyPayloadSchema = z.union([z.undefined(), z.null()]);

// --- answers:update -------------------------------------------------------

/**
 * Respuesta de una categoría: se recorta, se colapsan los espacios, no pasa de 30 caracteres ni
 * trae caracteres de control o rellenos invisibles. Vacía es válido (el jugador borró el campo).
 */
export const answersUpdateSchema = z.object({
  category: categoryIdSchema,
  text: z
    .string()
    .max(ANSWER_MAX_LENGTH * 4)
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .max(ANSWER_MAX_LENGTH)
        .refine((s) => !CONTROL_CHARS.test(s) && !INVISIBLE_FILLERS.test(s)),
    ),
});
export type AnswersUpdatePayload = z.infer<typeof answersUpdateSchema>;

// --- review:* -------------------------------------------------------------

/** `key` es la respuesta normalizada del grupo; normalizada nunca pasa del largo de una respuesta. */
export const reviewVoteSchema = z.object({
  key: z.string().min(1).max(ANSWER_MAX_LENGTH),
  reject: z.boolean(),
});
export type ReviewVotePayload = z.infer<typeof reviewVoteSchema>;

export const reviewReadySchema = z.object({
  ready: z.boolean(),
});
export type ReviewReadyPayload = z.infer<typeof reviewReadySchema>;

// --- message:send ---------------------------------------------------------

/** Texto: se recorta, se colapsan los espacios, no puede quedar vacío ni pasar de 80 caracteres ni traer caracteres de control o rellenos invisibles. */
export const messageSendSchema = z.object({
  text: z
    .string()
    .max(MESSAGE_MAX_LENGTH * 4)
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(1)
        .max(MESSAGE_MAX_LENGTH)
        .refine((s) => !CONTROL_CHARS.test(s) && !INVISIBLE_FILLERS.test(s)),
    ),
});
export type MessageSendPayload = z.infer<typeof messageSendSchema>;
