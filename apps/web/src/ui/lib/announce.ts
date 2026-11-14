// Texto que los lectores de pantalla anuncian al cambiar de fase. Cambia solo al cambiar de
// fase, de letra o de categoría (nunca con cada segundo ni cada tecla), así se anuncia una vez.

import type { Phase } from '@bach/shared';

export type PhaseAnnouncementInput = {
  phase: Phase;
  round: number;
  totalRounds: number;
  letter: string | null;
  isPicker: boolean;
  pickerName: string;
  /** Participa en la ronda en curso. */
  playing: boolean;
  /** Categoría en revisión (etiqueta) y su posición, desde 0. */
  reviewLabel: string | null;
  reviewIndex: number;
  reviewTotal: number;
};

export function phaseAnnouncement(input: PhaseAnnouncementInput): string {
  const { phase, round, totalRounds, letter, isPicker, pickerName, playing } = input;
  const roundText = `Ronda ${round} de ${totalRounds}.`;
  switch (phase) {
    case 'LETTER':
      if (letter) return `${roundText} Salió la letra ${letter}. Empezamos en unos segundos.`;
      return isPicker
        ? `${roundText} Te toca detener la letra: aprieta Stop.`
        : `${roundText} Le toca a ${pickerName} detener la letra.`;
    case 'WRITING':
      return playing
        ? `Letra ${letter ?? ''}. Escribe una palabra por categoría que empiece con ${letter ?? 'esa letra'}.`
        : `Letra ${letter ?? ''}. Esta ronda solo miras: juegas desde la siguiente.`;
    case 'REVIEW':
      return input.reviewLabel
        ? `Revisión: ${input.reviewLabel}, ${input.reviewIndex + 1} de ${input.reviewTotal}.`
        : 'Revisión de respuestas.';
    case 'ROUND_END':
      return `Fin de la ronda ${round}.`;
    default:
      return '';
  }
}
