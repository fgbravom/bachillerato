// Ruleta de letras (fase LETTER). La animación es cosmética: aterriza en la letra del servidor.

import { LETTERS } from '@bach/shared';

/** Cada cuánto cambia la letra mientras gira. */
export const SPIN_TICK_MS = 70;
/** Giro lento para quien pidió menos movimiento. */
export const REDUCED_SPIN_TICK_MS = 450;
/** Letras que se muestran al frenar, contando la final. */
export const LANDING_STEPS = 6;

/** Letra siguiente en el abecedario del juego (da la vuelta al final). */
export function nextLetter(letter: string): string {
  const index = LETTERS.indexOf(letter);
  return LETTERS[(index + 1) % LETTERS.length] ?? LETTERS[0] ?? 'A';
}

/**
 * Letras que se muestran al frenar: las `steps - 1` anteriores a `target` en el abecedario y,
 * al final, `target`. Con el giro a 70 ms por letra el salto desde la que estaba en pantalla no se
 * nota, y el frenado dura poco (el servidor da solo 3 s de letra revelada).
 */
export function landingPath(target: string, steps = LANDING_STEPS): string[] {
  const total = LETTERS.length;
  const targetIndex = LETTERS.indexOf(target);
  if (targetIndex < 0) return [target];
  const path: string[] = [];
  for (let back = steps - 1; back >= 0; back--) {
    path.push(LETTERS[(targetIndex - back + total * 2) % total] ?? target);
  }
  return path;
}

/**
 * Demora (ms) antes de mostrar cada letra del frenado: parte rápido y se va frenando,
 * con el último paso más largo para que se sienta el "golpe".
 */
export function landingDelays(steps: number, baseMs = SPIN_TICK_MS): number[] {
  return Array.from({ length: steps }, (_, i) => {
    const progress = steps <= 1 ? 1 : i / (steps - 1);
    return Math.round(baseMs * (1 + 5 * progress ** 2.2));
  });
}
