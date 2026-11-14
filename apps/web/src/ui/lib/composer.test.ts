import { describe, expect, it } from 'vitest';
import { COMPOSER_TEXT, prepareMessage } from './composer';

describe('prepareMessage', () => {
  it('recorta espacios y descarta vacíos', () => {
    expect(prepareMessage('  hola  ', 80)).toBe('hola');
    expect(prepareMessage('   ', 80)).toBeNull();
    expect(prepareMessage('', 80)).toBeNull();
  });

  it('respeta el largo máximo', () => {
    expect(prepareMessage('a'.repeat(100), 80)).toHaveLength(80);
  });
});

describe('COMPOSER_TEXT', () => {
  it('tiene marcador de posición y etiqueta', () => {
    expect(COMPOSER_TEXT.placeholder).not.toBe('');
    expect(COMPOSER_TEXT.label).not.toBe('');
  });
});
