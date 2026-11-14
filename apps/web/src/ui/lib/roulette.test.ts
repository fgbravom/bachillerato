import { LETTERS } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { LANDING_STEPS, landingDelays, landingPath, nextLetter } from './roulette';

describe('nextLetter', () => {
  it('avanza por el abecedario del juego y da la vuelta', () => {
    expect(nextLetter('A')).toBe('B');
    expect(nextLetter('J')).toBe('L');
    expect(nextLetter('V')).toBe('A');
  });
});

describe('landingPath', () => {
  it('termina siempre en la letra del servidor', () => {
    for (const target of LETTERS) {
      const path = landingPath(target);
      expect(path.at(-1)).toBe(target);
      expect(path).toHaveLength(LANDING_STEPS);
    }
  });

  it('recorre el abecedario en orden y da la vuelta al principio', () => {
    expect(landingPath('F', 3)).toEqual(['D', 'E', 'F']);
    expect(landingPath('B', 4)).toEqual(['T', 'U', 'V', 'A', 'B'].slice(1));
  });

  it('solo pasa por letras del abecedario del juego', () => {
    for (const letter of landingPath('A')) expect(LETTERS).toContain(letter);
  });

  it('con una letra desconocida no revienta', () => {
    expect(landingPath('?')).toEqual(['?']);
  });
});

describe('landingDelays', () => {
  it('frena: cada demora es igual o mayor a la anterior', () => {
    const delays = landingDelays(10);
    expect(delays).toHaveLength(10);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1] ?? 0);
    }
  });

  it('el frenado completo cabe holgado en los 3 s de letra revelada', () => {
    const total = landingDelays(LANDING_STEPS).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(1500);
  });
});
