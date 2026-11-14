import { CATEGORY_IDS, type Answers } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { countFilled, fieldState, nextEmptyIndex, sheetProgress, stopHint } from './sheet';

const full: Answers = {
  nombre: 'Felipe',
  lugar: 'Francia',
  cosa: 'Fucsia',
  fruta: 'Frutilla',
  animal: 'Flamenco',
  tv: 'Friends',
  cantante: 'Fito Páez',
};

describe('fieldState', () => {
  it('distingue vacío, bueno y mal', () => {
    expect(fieldState('', 'F')).toBe('empty');
    expect(fieldState('   ', 'F')).toBe('empty');
    expect(fieldState('Frutilla', 'F')).toBe('ok');
    expect(fieldState('  frutilla', 'F')).toBe('ok');
    expect(fieldState('Manzana', 'F')).toBe('wrong');
  });

  it('ignora las tildes al comparar la letra', () => {
    expect(fieldState('Árbol', 'A')).toBe('ok');
  });
});

describe('sheetProgress', () => {
  it('con las 7 buenas, está completa', () => {
    expect(sheetProgress(full, CATEGORY_IDS, 'F')).toEqual({
      filled: 7,
      wrong: 0,
      empty: 0,
      complete: true,
    });
  });

  it('una respuesta con otra letra impide completar', () => {
    const progress = sheetProgress({ ...full, fruta: 'Manzana' }, CATEGORY_IDS, 'F');
    expect(progress).toMatchObject({ filled: 7, wrong: 1, empty: 0, complete: false });
  });

  it('una vacía impide completar', () => {
    const { cantante: _omit, ...partial } = full;
    const progress = sheetProgress(partial, CATEGORY_IDS, 'F');
    expect(progress).toMatchObject({ filled: 6, wrong: 0, empty: 1, complete: false });
  });

  it('una hoja sin categorías no cuenta como completa', () => {
    expect(sheetProgress({}, [], 'F').complete).toBe(false);
  });
});

describe('countFilled', () => {
  it('cuenta categorías con texto, valga o no la letra', () => {
    expect(countFilled({ nombre: 'Ana', lugar: '  ', cosa: 'x' }, CATEGORY_IDS)).toBe(2);
    expect(countFilled({}, CATEGORY_IDS)).toBe(0);
  });
});

describe('nextEmptyIndex', () => {
  it('salta al siguiente campo vacío', () => {
    expect(nextEmptyIndex(['a', '', 'c', ''], 0)).toBe(1);
    expect(nextEmptyIndex(['a', 'b', 'c', ''], 0)).toBe(3);
  });

  it('da la vuelta al final', () => {
    expect(nextEmptyIndex(['', 'b', 'c'], 2)).toBe(0);
  });

  it('devuelve -1 si no queda ninguno vacío', () => {
    expect(nextEmptyIndex(['a', 'b', 'c'], 1)).toBe(-1);
  });

  it('no vuelve al mismo campo aunque esté vacío', () => {
    expect(nextEmptyIndex(['a', '', 'c'], 1)).toBe(-1);
  });
});

describe('stopHint', () => {
  it('explica lo que falta', () => {
    expect(stopHint({ filled: 3, wrong: 0, empty: 4, complete: false }, 'F')).toBe(
      'Faltan 4 categorías',
    );
    expect(stopHint({ filled: 6, wrong: 0, empty: 1, complete: false }, 'F')).toBe(
      'Falta 1 categoría',
    );
    expect(stopHint({ filled: 7, wrong: 2, empty: 0, complete: false }, 'F')).toBe(
      '2 no empiezan con F',
    );
    expect(stopHint({ filled: 6, wrong: 1, empty: 1, complete: false }, 'F')).toBe(
      'Falta 1 categoría · 1 no empieza con F',
    );
  });

  it('con la hoja completa invita a gritar', () => {
    expect(stopHint({ filled: 7, wrong: 0, empty: 0, complete: true }, 'F')).toContain('STOP');
  });
});
