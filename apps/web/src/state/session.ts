// Reductor puro del estado de la sala en el cliente. Sin sockets, sin DOM, sin reloj propio:
// recibe cada evento del servidor y la hora local (`now`) y devuelve el estado siguiente.
//
// El servidor manda la foto completa (`room:state`) al entrar, reconectar, cambiar ajustes y volver a
// la sala de espera. Todo lo demás son eventos incrementales que se aplican aquí. El estado de la
// sala conserva la forma de `RoomState` para pasárselo tal cual a las pantallas.

import {
  type Answers,
  type CategoryId,
  type Player,
  type RoomState,
  type ServerEventName,
  type ServerToClientEvents,
} from '@bach/shared';
import { computeServerOffset } from '../ui/lib/clock';
import {
  infoFeedItem,
  joinedFeedItem,
  leftFeedItem,
  messageToFeedItem,
  trimFeed,
} from '../ui/lib/feed';
import type { FeedItem } from '../ui/types';

type PayloadOf<K extends ServerEventName> =
  Parameters<ServerToClientEvents[K]> extends [infer P, ...unknown[]] ? P : undefined;

/** Un evento del servidor con su nombre y datos, listo para el reductor. */
export type ServerEvent = {
  [K in ServerEventName]: { type: K; payload: PayloadOf<K> };
}[ServerEventName];

export type SessionState = {
  /** Foto local de la sala; `null` mientras no se está dentro de ninguna. */
  room: RoomState | null;
  /** Mensajes y avisos de la sala actual (se vacía al cambiar de sala). */
  feed: FeedItem[];
  /** Contador para generar ids estables de la lista de mensajes. */
  feedSeq: number;
  /** `serverNow - Date.now()` medido al recibir el último `room:state`. */
  serverOffsetMs: number;
};

export const initialSession: SessionState = {
  room: null,
  feed: [],
  feedSeq: 0,
  serverOffsetMs: 0,
};

/** Agrega un ítem a la lista de mensajes con un id nuevo. */
function withFeed(state: SessionState, make: (id: string) => FeedItem): SessionState {
  const id = `f${state.feedSeq}`;
  return {
    ...state,
    feedSeq: state.feedSeq + 1,
    feed: trimFeed([...state.feed, make(id)]),
  };
}

/** El anfitrión es quien trae `isHost`; si nadie lo trae (transición), se conserva el anterior si sigue en la sala. */
function resolveHostId(players: readonly Player[], previous: string): string {
  const host = players.find((p) => p.isHost);
  if (host) return host.id;
  return players.some((p) => p.id === previous) ? previous : '';
}

function upsertPlayer(room: RoomState, player: Player): RoomState {
  const exists = room.players.some((p) => p.id === player.id);
  const players = exists
    ? room.players.map((p) => (p.id === player.id ? player : p))
    : [...room.players, player];
  return { ...room, players, hostId: resolveHostId(players, room.hostId) };
}

function nameOf(room: RoomState, playerId: string | null): string {
  return room.players.find((p) => p.id === playerId)?.name ?? 'Alguien';
}

/** Vuelve a cero lo propio de una ronda (avance y "Listo"); no toca a quien ya está limpio. */
function clearRoundFlags(player: Player): Player {
  return player.filled === 0 && !player.ready ? player : { ...player, filled: 0, ready: false };
}

/** Aplica el puntaje acumulado a cada jugador que aparezca en `scores`. */
function applyScores(
  players: readonly Player[],
  scores: Readonly<Record<string, number>>,
): Player[] {
  return players.map((p) => {
    const score = scores[p.id];
    return score === undefined || score === p.score ? p : { ...p, score };
  });
}

export function reduceSession(
  state: SessionState,
  event: ServerEvent,
  /** Hora local en ms (`Date.now()`). */
  now: number,
): SessionState {
  if (event.type === 'room:state') {
    const incoming = event.payload;
    const sameRoom = state.room !== null && state.room.code === incoming.code;
    return {
      room: incoming,
      feed: sameRoom ? state.feed : [],
      feedSeq: sameRoom ? state.feedSeq : 0,
      serverOffsetMs: computeServerOffset(incoming.serverNow, now),
    };
  }

  const room = state.room;
  // Sin foto previa no hay nada que actualizar: un evento suelto no puede inventar una sala.
  if (!room) return state;

  switch (event.type) {
    case 'player:joined': {
      const known = room.players.some((p) => p.id === event.payload.id);
      const next = { ...state, room: upsertPlayer(room, event.payload) };
      return known ? next : withFeed(next, (id) => joinedFeedItem(event.payload.name, id));
    }

    case 'player:left': {
      const players = room.players.filter((p) => p.id !== event.payload.id);
      const next: SessionState = {
        ...state,
        room: { ...room, players, hostId: resolveHostId(players, room.hostId) },
      };
      return withFeed(next, (id) => leftFeedItem(event.payload.name, id));
    }

    case 'player:updated':
      return { ...state, room: upsertPlayer(room, event.payload) };

    case 'round:letter': {
      const { round, totalRounds, pickerId, endsAt } = event.payload;
      const next: SessionState = {
        ...state,
        room: {
          ...room,
          phase: 'LETTER',
          players: room.players.map(clearRoundFlags),
          round,
          totalRounds,
          pickerId,
          letter: null,
          endsAt,
          stopped: null,
          myAnswers: null,
          review: null,
          roundEnd: null,
          ranking: null,
        },
      };
      // Separa los mensajes de la ronda anterior en el chat de la revisión.
      return withFeed(next, (id) => infoFeedItem(`Ronda ${round} de ${totalRounds}`, id));
    }

    case 'round:letter-chosen':
      return {
        ...state,
        room: { ...room, letter: event.payload.letter, endsAt: event.payload.endsAt },
      };

    case 'round:writing': {
      const self = room.players.find((p) => p.id === room.selfId);
      return {
        ...state,
        room: {
          ...room,
          phase: 'WRITING',
          letter: event.payload.letter,
          endsAt: event.payload.endsAt,
          pickerId: null,
          stopped: null,
          // Solo quien participa tiene hoja; quien mira no recibe `myAnswers`.
          myAnswers: self?.playing ? {} : null,
          review: null,
          roundEnd: null,
        },
      };
    }

    case 'round:progress': {
      const { playerId, filled } = event.payload;
      return {
        ...state,
        room: {
          ...room,
          players: room.players.map((p) => (p.id === playerId ? { ...p, filled } : p)),
        },
      };
    }

    case 'round:stopped': {
      const { by, endsAt } = event.payload;
      const next: SessionState = {
        ...state,
        room: { ...room, stopped: { by }, endsAt },
      };
      return withFeed(next, (id) =>
        infoFeedItem(by === null ? 'Se acabó el tiempo' : `${nameOf(room, by)} gritó ¡STOP!`, id),
      );
    }

    case 'review:category': {
      const { category, index, total, groups, endsAt } = event.payload;
      return {
        ...state,
        room: {
          ...room,
          phase: 'REVIEW',
          pickerId: null,
          endsAt,
          stopped: null,
          myAnswers: null,
          review: { category, index, total, groups },
          // Cada categoría parte sin nadie listo.
          players: room.players.map((p) => (p.ready ? { ...p, ready: false } : p)),
        },
      };
    }

    case 'review:update': {
      const { category, groups, ready } = event.payload;
      // Una actualización de otra categoría llegó tarde: no aplica a la que se está viendo.
      if (!room.review || room.review.category !== category) return state;
      return {
        ...state,
        room: {
          ...room,
          review: { ...room.review, groups },
          players: room.players.map((p) =>
            ready.includes(p.id) === p.ready ? p : { ...p, ready: !p.ready },
          ),
        },
      };
    }

    case 'round:end': {
      const { endsAt, ...roundEnd } = event.payload;
      return {
        ...state,
        room: {
          ...room,
          phase: 'ROUND_END',
          players: applyScores(room.players, roundEnd.scores).map((p) =>
            p.ready ? { ...p, ready: false } : p,
          ),
          letter: roundEnd.letter,
          endsAt,
          pickerId: null,
          stopped: null,
          myAnswers: null,
          review: null,
          roundEnd,
        },
      };
    }

    case 'game:end': {
      const { ranking } = event.payload;
      const scores = Object.fromEntries(ranking.map((r) => [r.playerId, r.score]));
      return {
        ...state,
        room: {
          ...room,
          phase: 'GAME_END',
          players: applyScores(room.players, scores),
          endsAt: null,
          pickerId: null,
          stopped: null,
          myAnswers: null,
          review: null,
          roundEnd: null,
          ranking,
        },
      };
    }

    case 'message:new':
      return withFeed(state, (id) =>
        messageToFeedItem(event.payload, room.players, room.selfId, id),
      );

    // `system:error` y `system:online` los maneja el cliente; no forman parte de la foto de la sala.
    case 'system:error':
    case 'system:online':
      return state;
  }
}

// --- Respuestas propias ---------------------------------------------------

/**
 * Anota en la foto de la sala lo que la persona acaba de teclear, sin esperar al servidor: así
 * `room.myAnswers` siempre trae lo último escrito. Solo vale dentro de la escritura de esa ronda.
 */
export function withLocalAnswer(
  state: SessionState,
  round: number,
  category: CategoryId,
  text: string,
): SessionState {
  const room = state.room;
  if (!room || room.phase !== 'WRITING' || room.round !== round || room.myAnswers === null) {
    return state;
  }
  return { ...state, room: { ...room, myAnswers: { ...room.myAnswers, [category]: text } } };
}

/** Cambia las respuestas propias de la foto (usado al reponer lo local tras una reconexión). */
export function withMyAnswers(state: SessionState, answers: Answers): SessionState {
  const room = state.room;
  if (!room || room.phase !== 'WRITING' || room.myAnswers === null) return state;
  return { ...state, room: { ...room, myAnswers: answers } };
}
