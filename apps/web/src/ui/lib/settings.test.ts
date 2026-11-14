import {
  MAX_WRITE_SECONDS,
  MAX_ROUNDS,
  MIN_WRITE_SECONDS,
  MIN_ROUNDS,
  type GameSettings,
} from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { clampWriteSeconds, clampRounds, stepWriteSeconds, stepRounds } from './settings';

const base: GameSettings = { rounds: 3, writeSeconds: 90 };

describe('stepRounds', () => {
  it('suma y resta de a una ronda sin tocar el tiempo', () => {
    expect(stepRounds(base, 1)).toEqual({ rounds: 4, writeSeconds: 90 });
    expect(stepRounds(base, -1)).toEqual({ rounds: 2, writeSeconds: 90 });
  });

  it('no sale del rango', () => {
    expect(stepRounds({ ...base, rounds: MAX_ROUNDS }, 1).rounds).toBe(MAX_ROUNDS);
    expect(stepRounds({ ...base, rounds: MIN_ROUNDS }, -1).rounds).toBe(MIN_ROUNDS);
  });
});

describe('stepWriteSeconds', () => {
  it('cambia de a 10 segundos sin tocar las rondas', () => {
    expect(stepWriteSeconds(base, 1)).toEqual({ rounds: 3, writeSeconds: 100 });
    expect(stepWriteSeconds(base, -1)).toEqual({ rounds: 3, writeSeconds: 80 });
  });

  it('no sale del rango', () => {
    expect(stepWriteSeconds({ ...base, writeSeconds: MAX_WRITE_SECONDS }, 1).writeSeconds).toBe(
      MAX_WRITE_SECONDS,
    );
    expect(stepWriteSeconds({ ...base, writeSeconds: MIN_WRITE_SECONDS }, -1).writeSeconds).toBe(
      MIN_WRITE_SECONDS,
    );
  });
});

describe('clamp', () => {
  it('acota y redondea', () => {
    expect(clampRounds(0)).toBe(MIN_ROUNDS);
    expect(clampRounds(99)).toBe(MAX_ROUNDS);
    expect(clampRounds(2.6)).toBe(3);
    expect(clampWriteSeconds(1)).toBe(MIN_WRITE_SECONDS);
    expect(clampWriteSeconds(999)).toBe(MAX_WRITE_SECONDS);
  });
});
