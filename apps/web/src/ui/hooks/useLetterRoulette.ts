import { LETTERS } from '@bach/shared';
import { useEffect, useRef, useState } from 'react';
import {
  REDUCED_SPIN_TICK_MS,
  SPIN_TICK_MS,
  landingDelays,
  landingPath,
  nextLetter,
} from '../lib/roulette';
import { useMediaQuery } from './useMediaQuery';

export type LetterRoulette = {
  /** Letra que se ve ahora. */
  shown: string;
  /** Ya quedó en la letra del servidor. */
  landed: boolean;
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Letras girando mientras `target` es `null`. Al llegar la letra del servidor, frena en unos pasos
 * y queda en ella (la animación es solo cosmética: la letra siempre es la del servidor). Si el
 * componente nace con la letra ya conocida (reconexión), no gira: aparece directo.
 */
export function useLetterRoulette(target: string | null): LetterRoulette {
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const [state, setState] = useState<LetterRoulette>(() => ({
    shown: target ?? LETTERS[0] ?? 'A',
    landed: target !== null,
  }));
  const bornLanded = useRef(target !== null);

  // Girando: una letra nueva cada pocos milisegundos.
  useEffect(() => {
    if (target !== null) return;
    bornLanded.current = false;
    const id = setInterval(
      () => setState((s) => ({ shown: nextLetter(s.shown), landed: false })),
      reduced ? REDUCED_SPIN_TICK_MS : SPIN_TICK_MS,
    );
    return () => clearInterval(id);
  }, [target, reduced]);

  // Llegó la letra: frena y aterriza.
  useEffect(() => {
    if (target === null || bornLanded.current) return;
    const path = reduced ? [target] : landingPath(target);
    const delays = reduced ? [0] : landingDelays(path.length);
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const letter = path[index] ?? target;
      const last = index >= path.length - 1;
      setState({ shown: letter, landed: last });
      index += 1;
      if (!last) timer = setTimeout(step, delays[index] ?? SPIN_TICK_MS);
    };
    timer = setTimeout(step, delays[0] ?? 0);
    return () => clearTimeout(timer);
  }, [target, reduced]);

  return state;
}
