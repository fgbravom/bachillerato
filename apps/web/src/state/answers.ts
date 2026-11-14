// Envío de las respuestas de la hoja al servidor (`answers:update`). Sin sockets ni DOM: recibe una
// función `send` y los temporizadores globales, así se prueba con relojes simulados.
//
// - Cada categoría se envía con retardo (debounce con "trailing"): sale el último texto, a lo más
//   `ANSWER_DEBOUNCE_MS` después de la última tecla (el contrato exige ≤ 300 ms).
// - `flush` envía de inmediato lo pendiente: al llegar `round:stopped`, antes de gritar STOP y al
//   ocultarse la página.
// - Se respeta el límite de `MAX_ANSWER_UPDATES_PER_SECOND` por segundo. Los envíos con retardo usan
//   solo parte del cupo; el resto queda reservado para que un `flush` (hasta una por categoría)
//   nunca choque con el límite del servidor.
// - Se guarda el borrador local: tras una reconexión (`resync`) se reenvía lo que el servidor no tiene.

import {
  ANSWER_MAX_LENGTH,
  CATEGORY_IDS,
  MAX_ANSWER_UPDATES_PER_SECOND,
  type Answers,
  type CategoryId,
} from '@bach/shared';

/** Retardo de envío tras la última tecla de una categoría (≤ 300 ms según el contrato). */
export const ANSWER_DEBOUNCE_MS = 250;
const WINDOW_MS = 1000;
/** Cupo por segundo de los envíos con retardo: deja libre una por categoría para el `flush`. */
export const DEBOUNCED_PER_WINDOW = MAX_ANSWER_UPDATES_PER_SECOND - CATEGORY_IDS.length;

/** Igual que el servidor: sin espacios en los bordes ni dobles, y sin pasar del largo máximo. */
export function sanitizeAnswer(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, ANSWER_MAX_LENGTH);
}

/**
 * Respuestas del servidor con lo escrito localmente por encima: lo local gana donde difiere (es lo
 * que se está tecleando y quizá aún no llegó).
 */
export function mergeAnswers(server: Answers | null, draft: Answers): Answers {
  const merged: Answers = { ...server };
  for (const id of CATEGORY_IDS) {
    const local = draft[id];
    if (local === undefined) continue;
    if (sanitizeAnswer(local) !== sanitizeAnswer(server?.[id] ?? '')) merged[id] = local;
  }
  return merged;
}

export type AnswerSyncOptions = {
  /** Emite `answers:update`; devuelve `false` si no se pudo (sin conexión): queda pendiente. */
  send: (category: CategoryId, text: string) => boolean;
  delayMs?: number;
};

type SendMode = 'debounced' | 'flush';

export class AnswerSync {
  private readonly send: AnswerSyncOptions['send'];
  private readonly delayMs: number;
  private round: number | null = null;
  /** Lo último escrito en cada categoría (texto crudo). */
  private draft: Answers = {};
  /** Lo que el servidor tiene (ya saneado). */
  private sent: Answers = {};
  private readonly timers = new Map<CategoryId, ReturnType<typeof setTimeout>>();
  /** Horas de los últimos envíos, para el límite por segundo. */
  private stamps: number[] = [];

  constructor(options: AnswerSyncOptions) {
    this.send = options.send;
    this.delayMs = options.delayMs ?? ANSWER_DEBOUNCE_MS;
  }

  /** Cambió el texto de una categoría de la ronda `round`. */
  change(round: number, category: CategoryId, text: string): void {
    this.enterRound(round);
    this.draft[category] = text;
    this.clearTimer(category);
    if (this.isDirty(category)) this.schedule(category, this.delayMs, 'debounced');
  }

  /** Envía ya todo lo pendiente (el retardo no corre más). */
  flush(): void {
    for (const category of CATEGORY_IDS) {
      if (!this.isDirty(category)) continue;
      this.clearTimer(category);
      this.fire(category, 'flush');
    }
  }

  /**
   * El servidor mandó la foto de la sala (entrada o reconexión) con `server` como lo que tiene de la
   * hoja: se reenvía de inmediato lo local que difiera.
   */
  resync(round: number, server: Answers | null): void {
    this.enterRound(round);
    this.sent = {};
    for (const id of CATEGORY_IDS) {
      const text = server?.[id];
      if (text !== undefined) this.sent[id] = sanitizeAnswer(text);
    }
    this.flush();
  }

  /** Lo escrito localmente en la ronda `round` (vacío si el borrador es de otra ronda). */
  getDraft(round: number): Answers {
    return this.round === round ? { ...this.draft } : {};
  }

  /** Nueva ronda, o salida de la sala: se descarta todo lo pendiente. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.draft = {};
    this.sent = {};
    this.round = null;
  }

  private enterRound(round: number): void {
    if (this.round === round) return;
    this.reset();
    this.round = round;
  }

  private isDirty(category: CategoryId): boolean {
    // Una categoría que no se ha tocado localmente nunca está pendiente: tras recargar la página el
    // borrador nace vacío y no debe pisar con "" lo que el servidor ya tiene.
    const local = this.draft[category];
    if (local === undefined) return false;
    return sanitizeAnswer(local) !== (this.sent[category] ?? '');
  }

  private clearTimer(category: CategoryId): void {
    const timer = this.timers.get(category);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(category);
  }

  private schedule(category: CategoryId, ms: number, mode: SendMode): void {
    this.timers.set(
      category,
      setTimeout(() => {
        this.timers.delete(category);
        this.fire(category, mode);
      }, ms),
    );
  }

  private fire(category: CategoryId, mode: SendMode): void {
    if (!this.isDirty(category)) return;
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < WINDOW_MS);
    const cap = mode === 'flush' ? MAX_ANSWER_UPDATES_PER_SECOND : DEBOUNCED_PER_WINDOW;
    if (this.stamps.length >= cap) {
      // Sin cupo: se vuelve a intentar cuando salga el envío más antiguo de la ventana.
      const wait = Math.max(1, (this.stamps[0] ?? now) + WINDOW_MS - now);
      this.schedule(category, wait, mode);
      return;
    }
    const text = sanitizeAnswer(this.draft[category] ?? '');
    // Sin conexión no se marca como enviado: lo repone `resync` al volver.
    if (!this.send(category, text)) return;
    this.stamps.push(now);
    this.sent[category] = text;
  }
}
