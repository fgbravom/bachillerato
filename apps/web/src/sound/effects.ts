// Catálogo de efectos de sonido, descrito solo con datos (notas, duración, forma de onda y
// envolvente). Nada aquí toca Web Audio: `engine.ts` lo interpreta. Para ajustar un sonido basta
// con cambiar números en este archivo. Todos los sonidos se sintetizan en el navegador.

/** Timbre de una nota: onda base más armónicos opcionales que le dan carácter (campanita, marimba). */
export type Timbre = {
  wave: OscillatorType;
  /** Armónicos extra: `ratio` multiplica la frecuencia; `vol` es relativo a la nota; `decay` acorta su caída. */
  partials?: readonly { ratio: number; vol: number; decay?: number }[];
  /** Filtro pasabajos opcional (Hz) para apagar el timbre. */
  lowpass?: number;
};

export type Note = {
  /** Frecuencia en Hz (usa `hz('E5')`). */
  freq: number;
  /** Si existe, la frecuencia se desliza hasta este valor a lo largo de la nota (pops, golpes). */
  to?: number;
  /** Segundos desde el inicio del efecto. */
  at: number;
  /** Duración total en segundos; el volumen cae de forma exponencial hasta apagarse al final. */
  dur: number;
  /** Volumen pico de la nota (0 a 1, antes del volumen general). */
  vol: number;
  timbre: Timbre;
  /** Subida inicial en segundos (por defecto 0,006: ataque casi instantáneo). */
  attack?: number;
  /** Segundos que se sostiene el volumen pico antes de empezar a caer. */
  hold?: number;
};

/** Ráfaga corta de ruido filtrado (para dar cuerpo a un golpe suave). */
export type NoiseBurst = {
  at: number;
  dur: number;
  vol: number;
  lowpass: number;
};

export type Effect = {
  notes: readonly Note[];
  noise?: readonly NoiseBurst[];
  /** Separación mínima entre dos disparos del mismo efecto, para que una ráfaga no suene a metralleta. */
  minGapMs?: number;
};

export const SOUND_IDS = [
  'rouletteTick',
  'letterReveal',
  'yourTurn',
  'writeStart',
  'tick',
  'stop',
  'timeUp',
  'vote',
  'roundEnd',
  'roundEndEmpty',
  'gameEnd',
  'playerJoin',
  'playerLeave',
  'chat',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Nombre de nota a frecuencia: `hz('A4')` = 440, `hz('F#5')`, `hz('Bb3')`. */
export function hz(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) throw new Error(`Nota inválida: ${name}`);
  const [, letter = 'A', accidental = '', octave = '4'] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midi = 12 * (Number(octave) + 1) + (SEMITONES[letter] ?? 0) + offset;
  return 440 * 2 ** ((midi - 69) / 12);
}

// --- Timbres ----------------------------------------------------------------

/** Campanita: seno limpio con dos armónicos que cuelgan un poco más que la nota. */
const BELL: Timbre = {
  wave: 'sine',
  partials: [
    { ratio: 2, vol: 0.3, decay: 0.7 },
    { ratio: 3, vol: 0.12, decay: 0.4 },
  ],
};

/** Marimba: seno con un armónico agudo que se apaga rápido (el "toc" de la madera). */
const MARIMBA: Timbre = {
  wave: 'sine',
  partials: [{ ratio: 4, vol: 0.28, decay: 0.2 }],
};

/** Blip: triángulo, redondo y sin armónicos extra. */
const BLIP: Timbre = { wave: 'triangle' };

/** Seno puro, para pops y golpes. */
const SOFT: Timbre = { wave: 'sine' };

/** Marimba apagada (pasabajos), para los cierres sin puntos. */
const MARIMBA_MUTED: Timbre = { ...MARIMBA, lowpass: 900 };

/** Metal del grito de ¡STOP!: diente de sierra con el filo recortado, se oye sobre todo lo demás. */
const BRASS: Timbre = { wave: 'sawtooth', lowpass: 2400 };

/** Zumbido grave del fin de tiempo: triángulo apagado. */
const BUZZ: Timbre = { wave: 'triangle', lowpass: 700 };

const n = (name: string, at: number, dur: number, vol: number, timbre: Timbre): Note => ({
  freq: hz(name),
  at,
  dur,
  vol,
  timbre,
});

export const EFFECTS: Record<SoundId, Effect> = {
  // Giro de la ruleta: clic seco y bajito (do6 en triángulo), 0,03 s. Suena a ritmo de la ruleta.
  rouletteTick: {
    notes: [{ freq: hz('C6'), at: 0, dur: 0.03, vol: 0.06, timbre: BLIP, attack: 0.001 }],
    minGapMs: 60,
  },

  // Salió la letra: golpe de marimba (sol5) y campanita arriba (do6 con mi6), ~1 s.
  letterReveal: {
    notes: [
      n('G5', 0, 0.22, 0.2, MARIMBA),
      n('C6', 0.09, 0.9, 0.22, BELL),
      n('E6', 0.09, 0.6, 0.08, BELL),
    ],
  },

  // Te toca detener la ruleta: dos toques iguales (re5) y una campanita larga (la5 con re6 arriba), ~1 s.
  yourTurn: {
    notes: [
      n('D5', 0, 0.13, 0.22, MARIMBA),
      n('D5', 0.15, 0.13, 0.22, MARIMBA),
      n('A5', 0.3, 0.7, 0.22, BELL),
      n('D6', 0.3, 0.55, 0.08, BELL),
    ],
  },

  // ¡A escribir!: tres notas que suben rápido (do5, sol5, do6) con campanita al final, ~0,6 s.
  writeStart: {
    notes: [
      n('C5', 0, 0.12, 0.2, BLIP),
      n('G5', 0.08, 0.12, 0.2, BLIP),
      n('C6', 0.16, 0.45, 0.22, BELL),
    ],
  },

  // Tic de cuenta regresiva: clic seco y muy bajito (la5 en triángulo), 0,05 s.
  tick: {
    notes: [{ freq: hz('A5'), at: 0, dur: 0.05, vol: 0.09, timbre: BLIP, attack: 0.002 }],
  },

  // ¡STOP!: el más notorio. Golpe grave (de 200 a 70 Hz), estocada metálica de quinta (re5 y la5),
  // soplido de ruido y un "ding" agudo al final, ~1 s.
  stop: {
    notes: [
      { freq: 200, to: 70, at: 0, dur: 0.32, vol: 0.4, timbre: SOFT, attack: 0.003 },
      { ...n('D5', 0, 0.55, 0.2, BRASS), attack: 0.004 },
      { ...n('A5', 0, 0.55, 0.2, BRASS), attack: 0.004 },
      n('D6', 0.18, 0.8, 0.16, BELL),
    ],
    noise: [{ at: 0, dur: 0.15, vol: 0.25, lowpass: 3000 }],
  },

  // Se acabó el tiempo: dos zumbidos graves (la3, mi3) que bajan, ~0,6 s.
  timeUp: {
    notes: [n('A3', 0, 0.28, 0.3, BUZZ), n('E3', 0.22, 0.4, 0.3, BUZZ)],
  },

  // Voto de "No vale": toc corto de marimba (mi5), 0,1 s.
  vote: {
    notes: [n('E5', 0, 0.1, 0.12, MARIMBA)],
    minGapMs: 120,
  },

  // Fin de ronda con puntos: acorde de do mayor (do5, mi5, sol5) como campanita, rasgueado, y do6 arriba, ~0,9 s.
  roundEnd: {
    notes: [
      n('C5', 0, 0.7, 0.14, BELL),
      n('E5', 0.025, 0.65, 0.14, BELL),
      n('G5', 0.05, 0.6, 0.14, BELL),
      n('C6', 0.2, 0.6, 0.1, BELL),
    ],
  },

  // Fin de ronda sin puntos: acorde de re menor (re4, fa4, la4) en marimba apagada, ~0,6 s.
  roundEndEmpty: {
    notes: [
      n('D4', 0, 0.5, 0.17, MARIMBA_MUTED),
      n('F4', 0.03, 0.45, 0.15, MARIMBA_MUTED),
      n('A4', 0.06, 0.4, 0.15, MARIMBA_MUTED),
    ],
  },

  // Podio: arpegio ascendente (sol4 a sol5), acorde de do mayor en alto y destellos, ~1,8 s.
  gameEnd: {
    notes: [
      n('G4', 0, 0.2, 0.2, MARIMBA),
      n('C5', 0.12, 0.2, 0.2, MARIMBA),
      n('E5', 0.24, 0.2, 0.2, MARIMBA),
      n('G5', 0.36, 0.25, 0.2, MARIMBA),
      { ...n('C5', 0.6, 1.2, 0.13, BLIP), hold: 0.25 },
      { ...n('E5', 0.6, 1.2, 0.13, BLIP), hold: 0.25 },
      { ...n('G5', 0.6, 1.2, 0.13, BLIP), hold: 0.25 },
      n('C6', 0.6, 1.2, 0.14, BELL),
      n('E6', 0.95, 0.8, 0.1, BELL),
      n('G6', 1.1, 0.7, 0.09, BELL),
    ],
  },

  // Entra alguien: pop que sube (380 a 640 Hz), ~0,12 s.
  playerJoin: {
    notes: [{ freq: 380, to: 640, at: 0, dur: 0.12, vol: 0.18, timbre: SOFT, attack: 0.008 }],
    minGapMs: 200,
  },

  // Sale alguien: pop que baja (520 a 300 Hz), un poco más apagado, ~0,14 s.
  playerLeave: {
    notes: [{ freq: 520, to: 300, at: 0, dur: 0.14, vol: 0.15, timbre: SOFT, attack: 0.008 }],
    minGapMs: 200,
  },

  // Mensaje de otra persona: blip casi imperceptible (mi6 en seno), 0,06 s, con separación mínima.
  chat: {
    notes: [{ freq: hz('E6'), at: 0, dur: 0.06, vol: 0.05, timbre: SOFT, attack: 0.004 }],
    minGapMs: 400,
  },
};

/** Segundo en que termina el último sonido del efecto (para comprobar los topes de duración). */
export function effectEnd(effect: Effect): number {
  const ends = [
    ...effect.notes.map((note) => note.at + note.dur),
    ...(effect.noise ?? []).map((burst) => burst.at + burst.dur),
  ];
  return Math.max(0, ...ends);
}

/** Tope de duración: 1,2 s para todo, salvo la fanfarria final. */
export const MAX_EFFECT_SECONDS = 1.2;
export const MAX_FANFARE_SECONDS = 2;
