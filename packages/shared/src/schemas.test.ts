import { describe, expect, it } from 'vitest';
import {
  ANSWER_MAX_LENGTH,
  CATEGORIES,
  CATEGORY_IDS,
  ERROR_CODES,
  LETTERS,
  MAX_ROUNDS,
  PHASES,
  answersUpdateSchema,
  emptyPayloadSchema,
  messageSendSchema,
  reviewReadySchema,
  reviewVoteSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomSettingsSchema,
} from './index.js';

const sessionId = 'session-1234';

describe('constantes', () => {
  it('las categorías siguen el orden de los ids', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([...CATEGORY_IDS]);
    expect(CATEGORIES).toHaveLength(7);
  });

  it('las letras no repiten y alcanzan para todas las rondas', () => {
    expect(LETTERS).toHaveLength(20);
    expect(new Set(LETTERS).size).toBe(LETTERS.length);
    expect(LETTERS.length).toBeGreaterThanOrEqual(MAX_ROUNDS);
    for (const banned of 'KÑQWXYZ') expect(LETTERS).not.toContain(banned);
  });

  it('las fases y los códigos de error no repiten', () => {
    expect(new Set(PHASES).size).toBe(PHASES.length);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('room:create / room:join', () => {
  it('limpia el apodo', () => {
    const r = roomCreateSchema.parse({ name: '  Ana   María ', sessionId });
    expect(r.name).toBe('Ana María');
  });

  it('rechaza apodos cortos, largos o con caracteres de control', () => {
    expect(roomCreateSchema.safeParse({ name: 'A', sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: 'x'.repeat(17), sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: 'Ana\u0000', sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: 'Ana‮B', sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: 'x'.repeat(16), sessionId }).success).toBe(true);
  });

  it('exige al menos una letra o un número en el apodo', () => {
    expect(roomCreateSchema.safeParse({ name: '!!', sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: '😀😀', sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: '😀a', sessionId }).success).toBe(true);
    expect(roomCreateSchema.safeParse({ name: 'Ñandú', sessionId }).success).toBe(true);
  });

  it.each(['ㅤ', 'ᅟ', 'ᅠ', 'ﾠ', '⠀'])('rechaza el relleno invisible en apodos (%j)', (filler) => {
    expect(roomCreateSchema.safeParse({ name: filler + filler, sessionId }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: `Ana${filler}`, sessionId }).success).toBe(false);
    expect(
      roomJoinSchema.safeParse({ code: 'ABCD', name: `${filler}Ana`, sessionId }).success,
    ).toBe(false);
  });

  it('valida el sessionId', () => {
    expect(roomCreateSchema.safeParse({ name: 'Ana', sessionId: 'corto' }).success).toBe(false);
    expect(roomCreateSchema.safeParse({ name: 'Ana', sessionId: 'con espacios!' }).success).toBe(
      false,
    );
    expect(roomCreateSchema.safeParse({ name: 'Ana' }).success).toBe(false);
  });

  it('el código se acepta en minúsculas y sale en mayúsculas', () => {
    const r = roomJoinSchema.parse({ code: ' abcd ', name: 'Ana', sessionId });
    expect(r.code).toBe('ABCD');
  });

  it('rechaza códigos mal formados', () => {
    for (const code of ['ABC', 'ABCDE', 'AB1D', '', 123]) {
      expect(roomJoinSchema.safeParse({ code, name: 'Ana', sessionId }).success).toBe(false);
    }
  });
});

describe('room:settings', () => {
  it('acepta valores dentro de rango', () => {
    expect(roomSettingsSchema.safeParse({ rounds: 5, writeSeconds: 90 }).success).toBe(true);
    expect(roomSettingsSchema.safeParse({ rounds: 1, writeSeconds: 30 }).success).toBe(true);
    expect(roomSettingsSchema.safeParse({ rounds: 10, writeSeconds: 180 }).success).toBe(true);
  });

  it('rechaza fuera de rango, decimales y tipos incorrectos', () => {
    expect(roomSettingsSchema.safeParse({ rounds: 0, writeSeconds: 90 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: 11, writeSeconds: 90 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: 5, writeSeconds: 29 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: 5, writeSeconds: 181 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: 2.5, writeSeconds: 90 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: '5', writeSeconds: 90 }).success).toBe(false);
    expect(roomSettingsSchema.safeParse({ rounds: 5 }).success).toBe(false);
  });
});

describe('eventos sin datos', () => {
  it('acepta nada o null, nada más', () => {
    expect(emptyPayloadSchema.safeParse(undefined).success).toBe(true);
    expect(emptyPayloadSchema.safeParse(null).success).toBe(true);
    expect(emptyPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe('answers:update', () => {
  it('limpia el texto', () => {
    const r = answersUpdateSchema.parse({ category: 'fruta', text: '  Fresa   roja ' });
    expect(r).toEqual({ category: 'fruta', text: 'Fresa roja' });
  });

  it('acepta el texto vacío (el jugador borró el campo)', () => {
    expect(answersUpdateSchema.parse({ category: 'cosa', text: '   ' }).text).toBe('');
  });

  it('acepta cada categoría y rechaza las que no existen', () => {
    for (const category of CATEGORY_IDS) {
      expect(answersUpdateSchema.safeParse({ category, text: 'a' }).success).toBe(true);
    }
    expect(answersUpdateSchema.safeParse({ category: 'color', text: 'a' }).success).toBe(false);
    expect(answersUpdateSchema.safeParse({ text: 'a' }).success).toBe(false);
  });

  it('limita el largo a 30 caracteres', () => {
    const ok = 'a'.repeat(ANSWER_MAX_LENGTH);
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: ok }).success).toBe(true);
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: ok + 'a' }).success).toBe(false);
  });

  it('rechaza caracteres de control y rellenos invisibles', () => {
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: 'a\u0000b' }).success).toBe(
      false,
    );
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: 'a‮b' }).success).toBe(false);
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: 'aㅤ' }).success).toBe(false);
  });

  it('rechaza textos que no son string', () => {
    expect(answersUpdateSchema.safeParse({ category: 'cosa', text: 5 }).success).toBe(false);
  });
});

describe('review:vote / review:ready', () => {
  it('acepta un voto con key y reject', () => {
    expect(reviewVoteSchema.parse({ key: 'fresa', reject: true })).toEqual({
      key: 'fresa',
      reject: true,
    });
  });

  it('rechaza keys vacías o demasiado largas y reject que no es booleano', () => {
    expect(reviewVoteSchema.safeParse({ key: '', reject: true }).success).toBe(false);
    expect(reviewVoteSchema.safeParse({ key: 'a'.repeat(31), reject: true }).success).toBe(false);
    expect(reviewVoteSchema.safeParse({ key: 'fresa', reject: 1 }).success).toBe(false);
    expect(reviewVoteSchema.safeParse({ key: 'fresa' }).success).toBe(false);
  });

  it('ready exige un booleano', () => {
    expect(reviewReadySchema.safeParse({ ready: true }).success).toBe(true);
    expect(reviewReadySchema.safeParse({ ready: 'si' }).success).toBe(false);
    expect(reviewReadySchema.safeParse({}).success).toBe(false);
  });
});

describe('message:send', () => {
  it('recorta y colapsa espacios', () => {
    expect(messageSendSchema.parse({ text: '  ¡Fuente   no es un color!  ' }).text).toBe(
      '¡Fuente no es un color!',
    );
  });

  it('rechaza vacío, largo, saltos de línea y rellenos invisibles', () => {
    expect(messageSendSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(messageSendSchema.safeParse({ text: 'x'.repeat(81) }).success).toBe(false);
    expect(messageSendSchema.safeParse({ text: 'x'.repeat(80) }).success).toBe(true);
    expect(messageSendSchema.safeParse({ text: 'hola\u0007chao' }).success).toBe(false);
    // Los saltos de línea cuentan como espacio y se colapsan.
    expect(messageSendSchema.parse({ text: 'hola\nchao' }).text).toBe('hola chao');
    expect(messageSendSchema.safeParse({ text: 'ㅤ' }).success).toBe(false);
  });
});
