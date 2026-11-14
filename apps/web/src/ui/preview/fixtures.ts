// Datos simulados para la vista previa. Respetan exactamente los tipos del contrato.

import {
  CATEGORIES,
  CATEGORY_IDS,
  DEFAULT_ROUNDS,
  DEFAULT_WRITE_SECONDS,
  type Answers,
  type CategoryId,
  type Player,
  type RankingEntry,
  type ReviewGroup,
  type ReviewState,
  type RoomState,
  type RoundEnd,
} from '@bach/shared';
import { rejectsNeeded } from '../lib/review';
import { buildRanking } from '../lib/ranking';
import { infoFeedItem, joinedFeedItem, messageToFeedItem } from '../lib/feed';
import type { FeedItem } from '../types';

/** Letra de las rondas de ejemplo. */
export const LETTER = 'F';

const BASE_NAMES = ['Pipe', 'Cami', 'Nacho', 'Fran', 'Jose'];
const CROWD_NAMES = [
  'Pipe',
  'Cami',
  'Maximiliano',
  'Fran',
  'Josefa Ignacia',
  'Nacho',
  'Gabo',
  'Pancho',
  'Isi',
  'Javi',
  'Catalina F.',
  'Lalo',
];

export function makePlayers(
  names: readonly string[],
  patch: (p: Player, i: number) => Partial<Player> = () => ({}),
): Player[] {
  return names.map((name, i) => {
    const base: Player = {
      id: `p${i + 1}`,
      name,
      score: Math.max(0, (names.length - i) * 140 - (i % 3) * 50),
      connected: true,
      isHost: i === 0,
      playing: true,
      filled: 0,
      ready: false,
    };
    return { ...base, ...patch(base, i) };
  });
}

export type RoomOverrides = Partial<RoomState>;

/** Sala base de 5 jugadores en LOBBY. Quien mira es `p1` (anfitrión) salvo que se indique `selfId`. */
export function makeRoom(now: number, overrides: RoomOverrides = {}): RoomState {
  const players = overrides.players ?? makePlayers(BASE_NAMES);
  return {
    code: 'KQXM',
    phase: 'LOBBY',
    settings: { rounds: DEFAULT_ROUNDS, writeSeconds: DEFAULT_WRITE_SECONDS },
    categories: [...CATEGORIES],
    players,
    hostId: 'p1',
    selfId: 'p1',
    round: 0,
    totalRounds: DEFAULT_ROUNDS,
    pickerId: null,
    letter: null,
    endsAt: null,
    serverNow: now,
    stopped: null,
    myAnswers: null,
    review: null,
    roundEnd: null,
    ranking: null,
    ...overrides,
  };
}

export function makeLobbyRoom(
  now: number,
  opts: { selfId?: string; crowd?: boolean; solo?: boolean } = {},
): RoomState {
  const players = opts.solo
    ? makePlayers(['Pipe'], () => ({ score: 0 }))
    : makePlayers(opts.crowd ? CROWD_NAMES : BASE_NAMES, () => ({ score: 0 }));
  return makeRoom(now, { players, selfId: opts.selfId ?? 'p1' });
}

// --- Letra ----------------------------------------------------------------

/** Sala en LETTER. La picker es `p1` (quien mira) o `p2` (Cami). Sin `letter`, la ruleta gira. */
export function makeLetterRoom(
  now: number,
  opts: { pickerIsSelf: boolean; letter: string | null; endsInMs: number; crowd?: boolean },
): RoomState {
  const players = makePlayers(opts.crowd ? CROWD_NAMES : BASE_NAMES);
  return makeRoom(now, {
    phase: 'LETTER',
    players,
    round: 2,
    totalRounds: 5,
    pickerId: opts.pickerIsSelf ? 'p1' : 'p2',
    letter: opts.letter,
    endsAt: now + opts.endsInMs,
  });
}

// --- Escritura ------------------------------------------------------------

export const ANSWERS_PARTIAL: Answers = {
  nombre: 'Felipe',
  lugar: 'Francia',
  cosa: 'Manzana roja',
  fruta: '',
};

export const ANSWERS_COMPLETE: Answers = {
  nombre: 'Felipe',
  lugar: 'Francia',
  cosa: 'Fucsia',
  fruta: 'Frutilla',
  animal: 'Flamenco',
  tv: 'Friends',
  cantante: 'Fito Páez',
};

/** Avance de los demás jugadores (de `p2` en adelante), en el orden de `CROWD_NAMES`. */
const OTHERS_FILLED = [5, 2, 7, 0, 3, 6, 1, 4, 7, 2, 5];

export function makeWritingRoom(
  now: number,
  opts: {
    answers: Answers;
    /** Quien mira no participa (entró tarde). */
    spectator?: boolean;
    crowd?: boolean;
    secondsLeft?: number;
    stopped?: { by: string | null } | null;
  },
): RoomState {
  const names = opts.crowd ? CROWD_NAMES : BASE_NAMES;
  const spectatorId = opts.spectator ? `p${names.length + 1}` : null;
  const players = makePlayers(spectatorId ? [...names, 'Tomás'] : names, (p, i) => ({
    playing: p.id !== spectatorId,
    filled: i === 0 || p.id === spectatorId ? 0 : (OTHERS_FILLED[i - 1] ?? 0),
    connected: !(opts.crowd && i === 8),
  }));
  return makeRoom(now, {
    phase: 'WRITING',
    players,
    selfId: spectatorId ?? 'p1',
    round: 2,
    totalRounds: 5,
    pickerId: 'p2',
    letter: LETTER,
    endsAt: now + (opts.secondsLeft ?? DEFAULT_WRITE_SECONDS - 25) * 1000,
    stopped: opts.stopped ?? null,
    myAnswers: spectatorId ? null : opts.answers,
  });
}

// --- Revisión -------------------------------------------------------------

function group(
  text: string,
  playerIds: string[],
  status: ReviewGroup['status'] = 'valid',
  points = 0,
  rejectedBy: string[] = [],
): ReviewGroup {
  return {
    key: text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ''),
    text,
    playerIds,
    rejectedBy,
    status,
    points,
  };
}

/**
 * Recalcula estado y puntos como lo haría el servidor (solo para que la vista previa reaccione a los
 * votos): rechazada con más de la mitad de los votantes; 200 al único válido, 100 sin repetidos,
 * 50 con repetidos. La verdad vive en el motor del servidor; esto es una maqueta.
 */
export function rescore(groups: readonly ReviewGroup[], players: readonly Player[]): ReviewGroup[] {
  const voted = groups.map((g) => {
    if (g.status === 'wrong_letter') return g;
    const voters = players.filter(
      (p) => p.playing && p.connected && !g.playerIds.includes(p.id),
    ).length;
    const needed = rejectsNeeded(voters);
    const rejected = needed > 0 && g.rejectedBy.length >= needed;
    return { ...g, status: rejected ? ('rejected' as const) : ('valid' as const) };
  });
  const valid = voted.filter((g) => g.status === 'valid');
  return voted.map((g) => {
    if (g.status !== 'valid') return { ...g, points: 0 };
    if (valid.length === 1 && g.playerIds.length === 1) return { ...g, points: 200 };
    return { ...g, points: g.playerIds.length > 1 ? 50 : 100 };
  });
}

/** Mezcla de 50 / 100 / anulada por letra / rechazada en la categoría de fruta (índice 3). */
export function makeReviewGroups(): ReviewGroup[] {
  return [
    group('Frutilla', ['p1', 'p2'], 'valid', 50),
    group('Fresa', ['p3'], 'valid', 100, ['p4']),
    group('Manzana', ['p4'], 'wrong_letter', 0),
    group('Frambuesa', ['p5'], 'rejected', 0, ['p1', 'p2', 'p3']),
  ];
}

/** Categoría con un único valor válido: sale el sello de 200. */
export function makeAloneGroups(): ReviewGroup[] {
  return [
    group('Flamenco', ['p1'], 'valid', 200),
    group('Zorro', ['p3'], 'wrong_letter', 0),
    group('Foca de mar', ['p2'], 'rejected', 0, ['p1', 'p3', 'p4']),
  ];
}

export function makeReviewRoom(
  now: number,
  opts: {
    /** `author`: Pipe escribió en varios grupos; `voter`: Cami vota; `spectator`: entró tarde. */
    view: 'author' | 'voter' | 'spectator';
    crowd?: boolean;
    category?: CategoryId;
    groups?: ReviewGroup[];
    readyIds?: string[];
  },
): RoomState {
  const names = opts.crowd ? CROWD_NAMES : BASE_NAMES;
  const spectatorId = opts.view === 'spectator' ? `p${names.length + 1}` : null;
  const readyIds = opts.readyIds ?? ['p3'];
  const players = makePlayers(spectatorId ? [...names, 'Tomás'] : names, (p) => ({
    playing: p.id !== spectatorId,
    ready: readyIds.includes(p.id),
  }));
  const category = opts.category ?? 'fruta';
  const index = CATEGORY_IDS.indexOf(category);
  const review: ReviewState = {
    category,
    index,
    total: CATEGORY_IDS.length,
    groups: opts.groups ?? makeReviewGroups(),
  };
  return makeRoom(now, {
    phase: 'REVIEW',
    players,
    selfId: spectatorId ?? (opts.view === 'voter' ? 'p2' : 'p1'),
    round: 2,
    totalRounds: 5,
    pickerId: 'p2',
    letter: LETTER,
    endsAt: now + 14_000,
    review,
  });
}

// --- Fin de ronda ---------------------------------------------------------

function makeResults(): Record<CategoryId, ReviewGroup[]> {
  return {
    nombre: [
      group('Felipe', ['p1'], 'valid', 100),
      group('Francisca', ['p2'], 'valid', 100),
      group('Fernanda', ['p3', 'p5'], 'valid', 50),
    ],
    lugar: [
      group('Francia', ['p1', 'p2'], 'valid', 50),
      group('Finlandia', ['p3'], 'valid', 100),
      group('Filipinas', ['p4'], 'valid', 100),
    ],
    cosa: [
      group('Fucsia', ['p1'], 'valid', 100),
      group('Fuente', ['p2'], 'rejected', 0, ['p1', 'p3', 'p4']),
      group('Foco', ['p3'], 'valid', 100),
    ],
    fruta: makeReviewGroups(),
    animal: [group('Flamenco', ['p1'], 'valid', 200), group('Zorro', ['p3'], 'wrong_letter', 0)],
    tv: [group('Friends', ['p1', 'p3'], 'valid', 50), group('Frozen', ['p2'], 'valid', 100)],
    cantante: [group('Fito Páez', ['p1'], 'valid', 100), group('Fey', ['p2'], 'valid', 100)],
  };
}

function gainsFrom(results: Record<CategoryId, ReviewGroup[]>): Record<string, number> {
  const gains: Record<string, number> = {};
  for (const groups of Object.values(results)) {
    for (const g of groups) {
      if (g.status !== 'valid') continue;
      for (const id of g.playerIds) gains[id] = (gains[id] ?? 0) + g.points;
    }
  }
  return gains;
}

export function makeRoundEndRoom(
  now: number,
  opts: { last?: boolean; crowd?: boolean; selfId?: string; timeUp?: boolean } = {},
): RoomState {
  const names = opts.crowd ? CROWD_NAMES : BASE_NAMES;
  const base = makePlayers(names, (_p, i) => ({ score: Math.max(0, (names.length - i) * 300) }));
  const results = makeResults();
  const gains = gainsFrom(results);
  const scores: Record<string, number> = {};
  for (const p of base) scores[p.id] = p.score + (gains[p.id] ?? 0);
  const roundEnd: RoundEnd = {
    letter: LETTER,
    gains,
    scores,
    results,
    stoppedBy: opts.timeUp ? null : 'p2',
  };
  const round = opts.last ? 5 : 2;
  return makeRoom(now, {
    phase: 'ROUND_END',
    players: base.map((p) => ({ ...p, score: scores[p.id] ?? p.score })),
    selfId: opts.selfId ?? 'p1',
    round,
    totalRounds: 5,
    letter: LETTER,
    endsAt: now + 7_000,
    roundEnd,
  });
}

export function makeRanking(opts: { tie?: boolean; crowd?: boolean } = {}): RankingEntry[] {
  const names = opts.crowd ? CROWD_NAMES : ['Pipe', 'Cami', 'Nacho', 'Fran', 'Jose'];
  const scores = opts.tie
    ? [1450, 1450, 1100, 900, 900, 600, 450, 300, 300, 150, 0, 0]
    : [1650, 1400, 1150, 900, 650, 500, 450, 300, 250, 150, 50, 0];
  return buildRanking(names.map((name, i) => ({ id: `p${i + 1}`, name, score: scores[i] ?? 0 })));
}

// --- Mensajes de ejemplo --------------------------------------------------

export function makeFeed(
  players: readonly Player[],
  selfId: string,
  kind: 'lobby' | 'review',
): FeedItem[] {
  const msg = (n: number, playerId: string, text: string) =>
    messageToFeedItem({ playerId, text }, players, selfId, `m${n}`);
  const items: FeedItem[] = [
    joinedFeedItem(players[1]?.name ?? 'Cami', 'j1'),
    joinedFeedItem(players[2]?.name ?? 'Nacho', 'j2'),
  ];
  if (kind === 'lobby') {
    items.push(msg(1, 'p2', 'Hola! quién parte?'), msg(2, 'p1', 'Esperen que lleguen los demás'));
    items.push(infoFeedItem('Recuerda: sin diccionario, los jugadores validan.', 'i1'));
    return items;
  }
  items.push(
    msg(3, 'p3', '¡Fresa es fruta, no es color!'),
    msg(4, 'p4', 'jajaja Manzana no empieza con F'),
    msg(5, 'p1', 'Frambuesa sí vale, ¡voten bien!'),
  );
  return items;
}
