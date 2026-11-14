import { describe, expect, it } from 'vitest';
import { normalizeAnswer, startsWithLetter } from './text.js';

describe('normalizeAnswer', () => {
  it('pasa a minúsculas', () => {
    expect(normalizeAnswer('FRESA')).toBe('fresa');
  });

  it('quita tildes y diéresis', () => {
    expect(normalizeAnswer('Cóndor')).toBe('condor');
    expect(normalizeAnswer('Valparaíso')).toBe('valparaiso');
    expect(normalizeAnswer('pingüino')).toBe('pinguino');
  });

  it('conserva la ñ', () => {
    expect(normalizeAnswer('Año')).toBe('año');
    expect(normalizeAnswer('ÑANDÚ')).toBe('ñandu');
    expect(normalizeAnswer('ano')).not.toBe(normalizeAnswer('año'));
  });

  it('funciona con texto en forma descompuesta (NFD)', () => {
    expect(normalizeAnswer('año')).toBe('año');
    expect(normalizeAnswer('cóndor')).toBe('condor');
  });

  it('quita puntuación', () => {
    expect(normalizeAnswer('¡La micro!')).toBe('la micro');
    expect(normalizeAnswer('Dr. House')).toBe('dr house');
  });

  it('trata guiones como separador', () => {
    expect(normalizeAnswer('Jean-Paul')).toBe('jean paul');
  });

  it('colapsa espacios dobles y recorta los bordes', () => {
    expect(normalizeAnswer('  Frank   Sinatra \t')).toBe('frank sinatra');
  });

  it('devuelve vacío si no queda nada', () => {
    expect(normalizeAnswer(' ¿?! ')).toBe('');
  });

  it('es idempotente', () => {
    const once = normalizeAnswer('  ¡Torres  del Páine! ');
    expect(normalizeAnswer(once)).toBe(once);
  });

  it('agrupa respuestas iguales escritas distinto', () => {
    expect(normalizeAnswer('Árbol')).toBe(normalizeAnswer(' arbol '));
  });
});

describe('startsWithLetter', () => {
  it('acepta con tildes y mayúsculas', () => {
    expect(startsWithLetter('Árbol', 'A')).toBe(true);
    expect(startsWithLetter('ÁRBOL', 'a')).toBe(true);
  });

  it('ignora espacios y puntuación al inicio', () => {
    expect(startsWithLetter('  fresa ', 'F')).toBe(true);
    expect(startsWithLetter('¡Fresa!', 'F')).toBe(true);
  });

  it('la ñ no vale para la N', () => {
    expect(startsWithLetter('ñandú', 'N')).toBe(false);
    expect(startsWithLetter('Ñandú', 'n')).toBe(false);
  });

  it('rechaza otra letra', () => {
    expect(startsWithLetter('manzana', 'P')).toBe(false);
  });

  it('vacío o solo signos no vale', () => {
    expect(startsWithLetter('', 'A')).toBe(false);
    expect(startsWithLetter('   ', 'A')).toBe(false);
    expect(startsWithLetter('¿?', 'A')).toBe(false);
  });

  it('una letra vacía no vale', () => {
    expect(startsWithLetter('árbol', '')).toBe(false);
  });
});
