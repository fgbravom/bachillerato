// Hoja de escritura (fase WRITING): estado de cada campo y de la hoja completa. Solo ayuda
// visual y habilita el botón ¡STOP!; el servidor vuelve a validar todo antes de cerrar la ronda.

import { startsWithLetter, type Answers, type CategoryId } from '@bach/shared';

/** `empty`: sin texto; `ok`: empieza con la letra; `wrong`: tiene texto pero no empieza con la letra. */
export type FieldState = 'empty' | 'ok' | 'wrong';

export function fieldState(text: string, letter: string): FieldState {
  if (text.trim() === '') return 'empty';
  return startsWithLetter(text, letter) ? 'ok' : 'wrong';
}

export type SheetProgress = {
  /** Campos con texto (valga o no). */
  filled: number;
  /** Campos con texto que no empieza con la letra. */
  wrong: number;
  /** Campos vacíos. */
  empty: number;
  /** Todas las categorías con texto y todas con la letra: se puede gritar STOP. */
  complete: boolean;
};

export function sheetProgress(
  answers: Answers,
  categoryIds: readonly CategoryId[],
  letter: string,
): SheetProgress {
  let filled = 0;
  let wrong = 0;
  for (const id of categoryIds) {
    const state = fieldState(answers[id] ?? '', letter);
    if (state !== 'empty') filled += 1;
    if (state === 'wrong') wrong += 1;
  }
  const empty = categoryIds.length - filled;
  return { filled, wrong, empty, complete: categoryIds.length > 0 && empty === 0 && wrong === 0 };
}

/** Categorías con texto, sin mirar la letra (es lo que cuenta `Player.filled`). */
export function countFilled(answers: Answers, categoryIds: readonly CategoryId[]): number {
  return categoryIds.filter((id) => (answers[id] ?? '').trim() !== '').length;
}

/**
 * Índice del siguiente campo vacío después de `from` (da la vuelta al final). `-1` si no queda
 * ninguno vacío: ahí conviene cerrar el teclado en vez de saltar a un campo ya escrito.
 */
export function nextEmptyIndex(texts: readonly string[], from: number): number {
  const total = texts.length;
  for (let step = 1; step <= total; step++) {
    const index = (from + step) % total;
    if (index === from) break;
    if ((texts[index] ?? '').trim() === '') return index;
  }
  return -1;
}

/** Qué falta para poder gritar STOP, en una frase corta. */
export function stopHint(progress: SheetProgress, letter: string): string {
  if (progress.complete) return '¡Hoja completa! Grita STOP cuando quieras.';
  const parts: string[] = [];
  if (progress.empty > 0) {
    parts.push(progress.empty === 1 ? 'Falta 1 categoría' : `Faltan ${progress.empty} categorías`);
  }
  if (progress.wrong > 0) {
    parts.push(
      progress.wrong === 1
        ? `1 no empieza con ${letter}`
        : `${progress.wrong} no empiezan con ${letter}`,
    );
  }
  return parts.join(' · ');
}
