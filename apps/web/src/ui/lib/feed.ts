// Constructores de `FeedItem` a partir de los eventos del contrato. El store los usa para
// alimentar la lista de mensajes; las pantallas solo reciben el arreglo ya armado.

import type { MessageNewPayload, Player } from '@bach/shared';
import type { FeedItem } from '../types';

/** Tope de ítems que conviene guardar en memoria. */
export const MAX_FEED_ITEMS = 200;

const UNKNOWN_PLAYER = 'Alguien';

export function messageToFeedItem(
  payload: MessageNewPayload,
  players: readonly Player[],
  selfId: string,
  id: string,
): FeedItem {
  const author = players.find((p) => p.id === payload.playerId);
  return {
    id,
    kind: 'message',
    playerId: payload.playerId,
    name: author?.name ?? UNKNOWN_PLAYER,
    text: payload.text,
    isSelf: payload.playerId === selfId,
  };
}

export function joinedFeedItem(name: string, id: string): FeedItem {
  return { id, kind: 'system', tone: 'join', text: `${name} entró a la sala` };
}

export function leftFeedItem(name: string, id: string): FeedItem {
  return { id, kind: 'system', tone: 'leave', text: `${name} salió de la sala` };
}

export function infoFeedItem(text: string, id: string): FeedItem {
  return { id, kind: 'system', tone: 'info', text };
}

/** Deja solo los últimos `max` ítems. */
export function trimFeed(items: readonly FeedItem[], max: number = MAX_FEED_ITEMS): FeedItem[] {
  return items.length <= max ? [...items] : items.slice(items.length - max);
}
