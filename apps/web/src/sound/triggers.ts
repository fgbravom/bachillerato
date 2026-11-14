// Qué efecto corresponde a cada evento del servidor y a cada segundo del reloj. Funciones puras:
// no tocan Web Audio ni el DOM, así que se prueban sin navegador. No repiten reglas del juego:
// solo miran lo que ya dice el evento y la foto de la sala previa al evento.

import type { ReviewGroup, RoomState } from '@bach/shared';
import type { ServerEvent } from '../state/session';
import type { SoundId } from './effects';

/** ¿Cambió algún voto de "No vale" entre dos listas de grupos de la misma categoría? */
function votesChanged(before: readonly ReviewGroup[], after: readonly ReviewGroup[]): boolean {
  if (before.length !== after.length) return true;
  return after.some((group) => {
    const old = before.find((g) => g.key === group.key);
    return !old || old.rejectedBy.length !== group.rejectedBy.length;
  });
}

/**
 * Efecto de un evento nuevo del servidor, o `null` si no suena nada. `room` es la foto previa al
 * evento. `room:state` (entrar o reconectar) nunca suena: la foto es estado, no un hecho nuevo.
 */
export function soundForEvent(room: RoomState | null, event: ServerEvent): SoundId | null {
  if (!room) return null;

  switch (event.type) {
    case 'round:letter':
      return event.payload.pickerId === room.selfId ? 'yourTurn' : null;

    case 'round:letter-chosen':
      return 'letterReveal';

    case 'round:writing':
      return 'writeStart';

    case 'round:stopped':
      return event.payload.by === null ? 'timeUp' : 'stop';

    case 'review:update':
      if (!room.review || room.review.category !== event.payload.category) return null;
      return votesChanged(room.review.groups, event.payload.groups) ? 'vote' : null;

    case 'round:end':
      return (event.payload.gains[room.selfId] ?? 0) > 0 ? 'roundEnd' : 'roundEndEmpty';

    case 'game:end':
      return 'gameEnd';

    case 'player:joined':
      // Ni uno mismo ni quien vuelve tras una reconexión (ya estaba en la lista).
      return event.payload.id !== room.selfId &&
        !room.players.some((p) => p.id === event.payload.id)
        ? 'playerJoin'
        : null;

    case 'player:left':
      return event.payload.id !== room.selfId && room.players.some((p) => p.id === event.payload.id)
        ? 'playerLeave'
        : null;

    case 'message:new':
      return event.payload.playerId === room.selfId ? null : 'chat';

    default:
      return null;
  }
}

/** La ruleta está girando: fase de letra y la letra aún sin elegir. */
export function isRouletteSpinning(room: RoomState | null): boolean {
  return room !== null && room.phase === 'LETTER' && room.letter === null;
}

/** Los tics suenan en cada uno de los últimos segundos (10, 9, ... 1) de la escritura. */
export const TICK_SECONDS = 10;

export type TickState = {
  /** Último segundo que sonó dentro de la ronda actual; `null` si aún no suena ninguno. */
  last: number | null;
};

/**
 * Paso del reloj de tics. `seconds` son los segundos que faltan (como en `useCountdown`). Suena
 * solo en `WRITING` sin cerrar (ni en la gracia tras el STOP ni en otras fases) y una sola vez por
 * segundo, aunque se consulte varias veces dentro del mismo segundo.
 */
export function nextTick(
  phase: RoomState['phase'] | null,
  seconds: number | null,
  state: TickState,
  stopped = false,
): { play: boolean; state: TickState } {
  if (phase !== 'WRITING' || stopped || seconds === null || seconds < 1 || seconds > TICK_SECONDS) {
    return { play: false, state: state.last === null ? state : { last: null } };
  }
  if (seconds === state.last) return { play: false, state };
  return { play: true, state: { last: seconds } };
}
