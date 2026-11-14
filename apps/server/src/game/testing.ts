// Arnés de pruebas del motor (solo lo importan las pruebas): reloj, azar e ids controlables.

import { CATEGORY_IDS } from '@bach/shared';
import type { Answers, CategoryId, GameSettings, ReviewGroup } from '@bach/shared';
import { createGame, nextWakeAt, reduce } from './reducer.js';
import type {
  Action,
  Effect,
  EngineConfig,
  EngineEvent,
  GameState,
  PlayerId,
  Recipient,
  ReduceResult,
} from './types.js';

export const START_TIME = 1_000_000;

/** Letras fijas por defecto en las pruebas (la ronda n usa la n-ésima); pasa `undefined` para sortear. */
export const TEST_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export interface HarnessOptions {
  config?: Partial<EngineConfig>;
  settings?: Partial<GameSettings>;
  /** Reemplaza al azar; por defecto una secuencia fija. */
  rng?: () => number;
}

export interface Harness {
  state: GameState;
  now: number;
  /** Todos los efectos emitidos desde que se creó el arnés. */
  effects: Effect[];
  last: ReduceResult;
  dispatch(action: Action): ReduceResult;
  /** Avanza el reloj despertando el motor en cada vencimiento, como la capa de red. */
  advanceTo(ms: number): void;
  advanceBy(ms: number): void;
  /** Entra con una sesión nueva (o la indicada) y devuelve el id del jugador. */
  join(name: string, opts?: { sessionId?: string; connId?: string }): PlayerId;
  /** Entra con varios nombres seguidos. */
  joinAll(...names: string[]): PlayerId[];
  disconnect(playerId: PlayerId): ReduceResult;
  /** Se reconecta con la sesión que `join` usó por defecto para ese nombre. */
  reconnect(name: string): ReduceResult;
  /** Escribe un mensaje de texto. */
  say(playerId: PlayerId, text: string): ReduceResult;
  /** Efectos emitidos desde la marca (un valor de `effects.length`). */
  since(mark: number): Effect[];
  /** Id del jugador por orden de llegada (0 es el primero). */
  idAt(index: number): PlayerId;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  let idCounter = 0;
  let rngCounter = 0;
  const rngSequence = [0.1, 0.6, 0.35, 0.8, 0.2];
  let connCounter = 0;
  const config: Partial<EngineConfig> = { lettersOverride: TEST_LETTERS, ...options.config };

  const h: Harness = {
    state: createGame(config, options.settings),
    now: START_TIME,
    effects: [],
    last: undefined as unknown as ReduceResult,
    dispatch(action) {
      const result = reduce(h.state, action, {
        now: h.now,
        rng: options.rng ?? (() => rngSequence[rngCounter++ % rngSequence.length] ?? 0),
        newId: () => `p${++idCounter}`,
      });
      h.state = result.state;
      h.last = result;
      h.effects.push(...result.effects);
      return result;
    },
    advanceTo(ms) {
      for (
        let wake = nextWakeAt(h.state);
        wake !== null && wake <= ms;
        wake = nextWakeAt(h.state)
      ) {
        h.now = Math.max(h.now, wake);
        h.dispatch({ type: 'tick' });
      }
      h.now = Math.max(h.now, ms);
    },
    advanceBy(ms) {
      h.advanceTo(h.now + ms);
    },
    join(name, opts = {}) {
      const sessionId = opts.sessionId ?? `secret-${name}`;
      const result = h.dispatch({
        type: 'join',
        sessionId,
        name,
        connId: opts.connId ?? `socket-${++connCounter}`,
      });
      if (!result.playerId) throw new Error(`join falló: ${result.error}`);
      return result.playerId;
    },
    joinAll(...names) {
      return names.map((n) => h.join(n));
    },
    disconnect(playerId) {
      const player = h.state.players.find((p) => p.id === playerId);
      if (!player?.connId) throw new Error(`jugador ${playerId} sin conexión`);
      return h.dispatch({ type: 'disconnect', playerId, connId: player.connId });
    },
    reconnect(name) {
      return h.dispatch({
        type: 'join',
        sessionId: `secret-${name}`,
        name,
        connId: `socket-${++connCounter}`,
      });
    },
    say(playerId, text) {
      return h.dispatch({ type: 'message', playerId, text });
    },
    since(mark) {
      return h.effects.slice(mark);
    },
    idAt(index) {
      const p = h.state.players[index];
      if (!p) throw new Error(`no hay jugador en la posición ${index}`);
      return p.id;
    },
  };
  return h;
}

// --- Consulta de efectos ---------------------------------------------------

type Emit<E extends EngineEvent> = Extract<Effect, { type: 'emit'; event: E }>;

/** Efectos `emit` de un evento. */
export function emitsOf<E extends EngineEvent>(effects: readonly Effect[], event: E): Emit<E>[] {
  return effects.filter((e): e is Emit<E> => e.type === 'emit' && e.event === event);
}

export function snapshotsOf(effects: readonly Effect[]) {
  return effects.filter((e): e is Extract<Effect, { type: 'snapshot' }> => e.type === 'snapshot');
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

/** ¿El efecto llega a alguien que no sea `owner`? Un envío a la sala cuenta como "a todos". */
function reachesOthers(to: Recipient, owner: PlayerId): boolean {
  switch (to.kind) {
    case 'room':
    case 'roomExcept':
      return true;
    case 'player':
      return to.playerId !== owner;
    case 'players':
      return to.playerIds.some((id) => id !== owner);
  }
}

/**
 * Falla si algún efecto dirigido a alguien que no sea el dueño contiene alguno de sus textos
 * (`secrets` mapea el id del dueño a sus respuestas, comparadas tal cual).
 */
export function assertNoAnswerLeak(
  effects: readonly Effect[],
  secrets: Readonly<Record<PlayerId, readonly string[]>>,
): void {
  effects.forEach((effect, i) => {
    let to: Recipient;
    let payload: unknown;
    if (effect.type === 'emit') {
      to = effect.to;
      payload = effect.payload;
    } else if (effect.type === 'snapshot') {
      to = { kind: 'player', playerId: effect.playerId };
      payload = effect.snapshot;
    } else {
      return;
    }
    const strings = stringsIn(payload);
    for (const [owner, texts] of Object.entries(secrets)) {
      if (!reachesOthers(to, owner)) continue;
      for (const text of texts) {
        if (strings.some((s) => s.includes(text))) {
          throw new Error(
            `Fuga de "${text}" (de ${owner}) en el efecto #${i}: ${JSON.stringify(effect)}`,
          );
        }
      }
    }
  });
}

// --- Atajos de partida -------------------------------------------------------

/** Crea una sala con `names`, inicia la partida y deja la primera ronda con la ruleta girando. */
export function startedGame(names: string[], options: HarnessOptions = {}): Harness {
  const h = createHarness(options);
  h.joinAll(...names);
  const res = h.dispatch({ type: 'start', playerId: h.idAt(0) });
  if (res.error) throw new Error(`start falló: ${res.error}`);
  return h;
}

/** Quien tiene la ruleta la detiene: la letra queda revelada. */
export function stopLetter(h: Harness): void {
  const pickerId = h.state.current?.pickerId;
  if (!pickerId) throw new Error('no hay ronda');
  const res = h.dispatch({ type: 'stopLetter', playerId: pickerId });
  if (res.error) throw new Error(`stopLetter falló: ${res.error}`);
}

/** Con la ruleta girando: la detiene y espera la revelación; deja la ronda en WRITING. */
export function toWriting(h: Harness): void {
  stopLetter(h);
  h.advanceTo(h.state.deadline!);
  if (h.state.phase !== 'WRITING') throw new Error(`se esperaba WRITING y hay ${h.state.phase}`);
}

/** Crea una sala con `names`, inicia la partida y deja la primera ronda en WRITING. */
export function writingGame(names: string[], options: HarnessOptions = {}): Harness {
  const h = startedGame(names, options);
  toWriting(h);
  return h;
}

/** Letra en juego. */
export function currentLetter(h: Harness): string {
  const letter = h.state.current?.letter;
  if (!letter) throw new Error('no hay letra');
  return letter;
}

/** Hoja completa con la letra de la ronda: `overrides` fija categorías; el resto es único por jugador. */
export function sheetFor(h: Harness, playerId: PlayerId, overrides: Answers = {}): Answers {
  const letter = currentLetter(h);
  const sheet: Answers = {};
  for (const id of CATEGORY_IDS) sheet[id] = overrides[id] ?? `${letter}${id}${playerId}`;
  return sheet;
}

/** El jugador escribe su hoja (respuesta por respuesta, como el cliente). */
export function fill(h: Harness, playerId: PlayerId, overrides: Answers = {}): void {
  const sheet = sheetFor(h, playerId, overrides);
  for (const id of CATEGORY_IDS) write(h, playerId, id, sheet[id] ?? '');
}

export function write(h: Harness, playerId: PlayerId, category: CategoryId, text: string): void {
  const res = h.dispatch({ type: 'updateAnswer', playerId, category, text });
  if (res.error) throw new Error(`updateAnswer falló: ${res.error}`);
}

/** Deja correr WRITING (tiempo y gracia) hasta que empiece la revisión. */
export function toReview(h: Harness): void {
  while (h.state.phase === 'WRITING') h.advanceTo(h.state.deadline!);
  if (h.state.phase !== 'REVIEW') throw new Error(`se esperaba REVIEW y hay ${h.state.phase}`);
}

/** Todos los participantes conectados marcan "Listo" en la categoría en curso. */
export function readyAll(h: Harness): void {
  for (const id of h.state.current?.playing ?? []) {
    const p = h.state.players.find((q) => q.id === id);
    if (p?.connected) h.dispatch({ type: 'ready', playerId: id, ready: true });
  }
}

/** Grupos de la categoría en revisión. */
export function groupsNow(h: Harness): ReviewGroup[] {
  const rs = h.state.current;
  const category = rs?.review?.order[rs.review.index];
  const groups = category ? rs?.groups?.[category] : undefined;
  if (!groups) throw new Error('no hay categoría en revisión');
  return groups;
}

/** Atajo: voto de `playerId` sobre el grupo de `key`. */
export function vote(h: Harness, playerId: PlayerId, key: string, reject = true): ReduceResult {
  return h.dispatch({ type: 'vote', playerId, key, reject });
}
