// Ajustes de partida que edita el anfitrión: pasos y límites según las constantes del contrato.

import {
  MAX_WRITE_SECONDS,
  MAX_ROUNDS,
  MIN_WRITE_SECONDS,
  MIN_ROUNDS,
  type GameSettings,
} from '@bach/shared';

export const ROUNDS_STEP = 1;
export const WRITE_SECONDS_STEP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampRounds(rounds: number): number {
  return clamp(Math.round(rounds), MIN_ROUNDS, MAX_ROUNDS);
}

export function clampWriteSeconds(seconds: number): number {
  return clamp(Math.round(seconds), MIN_WRITE_SECONDS, MAX_WRITE_SECONDS);
}

export function stepRounds(settings: GameSettings, direction: 1 | -1): GameSettings {
  return { ...settings, rounds: clampRounds(settings.rounds + direction * ROUNDS_STEP) };
}

export function stepWriteSeconds(settings: GameSettings, direction: 1 | -1): GameSettings {
  return {
    ...settings,
    writeSeconds: clampWriteSeconds(settings.writeSeconds + direction * WRITE_SECONDS_STEP),
  };
}
