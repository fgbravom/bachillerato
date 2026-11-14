import { describe, expect, it } from 'vitest';
import { LETTERS, LETTER_REVEAL_SECONDS, LETTER_SPIN_SECONDS } from '@bach/shared';
import { createHarness, emitsOf, startedGame, stopLetter } from './testing.js';
import type { Harness } from './testing.js';

/** Deja correr el reloj hasta GAME_END (sin que nadie responda nada). */
function playToEnd(h: Harness): void {
  while (h.state.phase !== 'GAME_END') h.advanceTo(h.state.deadline!);
}

/** Letras sorteadas hasta ahora, en orden. */
function lettersOf(h: Harness): string[] {
  return emitsOf(h.effects, 'round:letter-chosen').map((e) => e.payload.letter);
}

describe('ruleta de letra', () => {
  it('empieza girando: letra nula, plazo de 8 s y round:letter con el picker', () => {
    const h = startedGame(['Ana', 'Beto']);
    expect(h.state.phase).toBe('LETTER');
    expect(h.state.current?.letter).toBeNull();
    expect(h.state.deadline).toBe(h.now + LETTER_SPIN_SECONDS * 1000);
    const [ev] = emitsOf(h.effects, 'round:letter');
    expect(ev?.to).toEqual({ kind: 'room' });
    expect(ev?.payload).toEqual({
      round: 1,
      totalRounds: 5,
      pickerId: 'p1',
      endsAt: h.now + 8000,
    });
  });

  it('el picker detiene la ruleta: letra revelada 3 s y luego escritura', () => {
    const h = startedGame(['Ana', 'Beto']);
    h.advanceBy(2_000);
    const mark = h.effects.length;
    stopLetter(h);
    const [chosen] = emitsOf(h.since(mark), 'round:letter-chosen');
    expect(chosen?.payload).toEqual({ letter: 'A', endsAt: h.now + LETTER_REVEAL_SECONDS * 1000 });
    expect(h.state.phase).toBe('LETTER');
    expect(h.state.current?.letter).toBe('A');

    const mark2 = h.effects.length;
    h.advanceTo(h.state.deadline!);
    expect(h.state.phase).toBe('WRITING');
    const [writing] = emitsOf(h.since(mark2), 'round:writing');
    expect(writing?.payload).toEqual({ letter: 'A', endsAt: h.now + 90_000 });
  });

  it('si nadie la detiene, se detiene sola al vencer el plazo', () => {
    const h = startedGame(['Ana', 'Beto']);
    const start = h.now;
    h.advanceTo(start + 7_999);
    expect(h.state.current?.letter).toBeNull();
    h.advanceTo(start + 8_000);
    expect(h.state.current?.letter).toBe('A');
    const [chosen] = emitsOf(h.effects, 'round:letter-chosen');
    expect(chosen?.payload.endsAt).toBe(start + 8_000 + 3_000);
    h.advanceTo(start + 11_000);
    expect(h.state.phase).toBe('WRITING');
  });

  it('si el picker se desconecta, la ruleta igual se detiene sola', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro']);
    h.disconnect('p1');
    expect(h.state.current?.letter).toBeNull();
    h.advanceTo(h.state.deadline!);
    expect(h.state.current?.letter).toBe('A');
  });

  it('solo el picker puede detenerla, y solo mientras gira', () => {
    const h = startedGame(['Ana', 'Beto']);
    expect(h.dispatch({ type: 'stopLetter', playerId: 'p2' }).error).toBe('not_picker');
    expect(h.dispatch({ type: 'stopLetter', playerId: 'nadie' }).error).toBe('not_in_room');
    expect(h.dispatch({ type: 'stopLetter', playerId: 'p1' }).error).toBeUndefined();
    expect(h.dispatch({ type: 'stopLetter', playerId: 'p1' }).error).toBe('wrong_phase');
    h.advanceTo(h.state.deadline!);
    expect(h.dispatch({ type: 'stopLetter', playerId: 'p1' }).error).toBe('wrong_phase');
  });

  it('un stopLetter fuera de LETTER da wrong_phase', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto');
    expect(h.dispatch({ type: 'stopLetter', playerId: 'p1' }).error).toBe('wrong_phase');
  });

  it('el picker rota por orden de llegada entre las rondas', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro'], { settings: { rounds: 4 } });
    const pickers: (string | null)[] = [];
    while (h.state.phase !== 'GAME_END') {
      if (h.state.phase === 'LETTER' && h.state.current?.letter === null) {
        pickers.push(h.state.current.pickerId);
      }
      h.advanceTo(h.state.deadline!);
    }
    expect(pickers).toEqual(['p1', 'p2', 'p3', 'p1']);
  });

  it('el picker salta a quien no participa o se fue: rota solo entre conectados', () => {
    const h = startedGame(['Ana', 'Beto', 'Caro'], { settings: { rounds: 3 } });
    expect(h.state.current?.pickerId).toBe('p1');
    h.disconnect('p2'); // no será participante de la ronda 2
    while (h.state.round === 1) h.advanceTo(h.state.deadline!);
    expect(h.state.current?.playing).toEqual(['p1', 'p3']);
    expect(h.state.current?.pickerId).toBe('p3');
  });
});

describe('letras de la partida', () => {
  it('sin repetir: eligen al azar entre las no usadas (azar mínimo)', () => {
    const h = createHarness({
      config: { lettersOverride: undefined },
      settings: { rounds: 10 },
      rng: () => 0,
    });
    h.joinAll('Ana', 'Beto');
    h.dispatch({ type: 'start', playerId: 'p1' });
    playToEnd(h);
    const letters = lettersOf(h);
    expect(letters).toEqual([...LETTERS].slice(0, 10)); // siempre la primera no usada
  });

  it('sin repetir: azar máximo y letras siempre del alfabeto permitido', () => {
    const h = createHarness({
      config: { lettersOverride: undefined },
      settings: { rounds: 10 },
      rng: () => 0.999999,
    });
    h.joinAll('Ana', 'Beto');
    h.dispatch({ type: 'start', playerId: 'p1' });
    playToEnd(h);
    const letters = lettersOf(h);
    expect(new Set(letters).size).toBe(10);
    expect(letters.every((l) => LETTERS.includes(l))).toBe(true);
    expect(letters[0]).toBe('V');
    expect(letters[1]).toBe('U');
  });

  it('usa ctx.rng: un sorteo intermedio elige la letra correspondiente', () => {
    const h = createHarness({ config: { lettersOverride: undefined }, rng: () => 0.5 });
    h.joinAll('Ana', 'Beto');
    h.dispatch({ type: 'start', playerId: 'p1' });
    stopLetter(h);
    expect(h.state.current?.letter).toBe(LETTERS[Math.floor(0.5 * LETTERS.length)]);
    expect(h.state.usedLetters).toHaveLength(1);
  });

  it('lettersOverride fija la secuencia y la repite con módulo', () => {
    const h = startedGame(['Ana', 'Beto'], {
      config: { lettersOverride: ['M', 'F'] },
      settings: { rounds: 3 },
    });
    playToEnd(h);
    expect(lettersOf(h)).toEqual(['M', 'F', 'M']);
  });

  it('una partida nueva vuelve a tener todas las letras disponibles', () => {
    const h = createHarness({
      config: { lettersOverride: undefined },
      settings: { rounds: 1 },
      rng: () => 0,
    });
    h.joinAll('Ana', 'Beto');
    h.dispatch({ type: 'start', playerId: 'p1' });
    playToEnd(h);
    expect(h.state.usedLetters).toEqual(['A']);
    h.dispatch({ type: 'start', playerId: 'p1' }); // GAME_END -> LOBBY
    h.dispatch({ type: 'start', playerId: 'p1' }); // LOBBY -> nueva partida
    expect(h.state.usedLetters).toEqual([]);
    playToEnd(h);
    expect(lettersOf(h)).toEqual(['A', 'A']);
  });
});
