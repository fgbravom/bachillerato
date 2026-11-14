import type { Player } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import { infoFeedItem, joinedFeedItem, leftFeedItem, messageToFeedItem, trimFeed } from './feed';

const players: Player[] = [
  {
    id: 'p1',
    name: 'Ana',
    score: 0,
    connected: true,
    isHost: true,
    playing: true,
    filled: 0,
    ready: false,
  },
  {
    id: 'p2',
    name: 'Beto',
    score: 0,
    connected: true,
    isHost: false,
    playing: true,
    filled: 0,
    ready: false,
  },
];

describe('messageToFeedItem', () => {
  it('resuelve el apodo y marca los mensajes propios', () => {
    const item = messageToFeedItem({ playerId: 'p2', text: 'hola' }, players, 'p2', 'm1');
    expect(item).toEqual({
      id: 'm1',
      kind: 'message',
      playerId: 'p2',
      name: 'Beto',
      text: 'hola',
      isSelf: true,
    });
  });

  it('no marca como propios los mensajes ajenos', () => {
    const item = messageToFeedItem({ playerId: 'p1', text: 'ufff' }, players, 'p2', 'm2');
    expect(item.kind === 'message' && item.isSelf).toBe(false);
  });

  it('usa un nombre genérico si el jugador ya no está', () => {
    const item = messageToFeedItem({ playerId: 'zz', text: 'hey' }, players, 'p1', 'm3');
    expect(item.kind === 'message' && item.name).toBe('Alguien');
  });
});

describe('avisos de sistema', () => {
  it('arma los avisos de entrada, salida e info', () => {
    expect(joinedFeedItem('Caro', 's4')).toMatchObject({
      tone: 'join',
      text: 'Caro entró a la sala',
    });
    expect(leftFeedItem('Caro', 's5')).toMatchObject({
      tone: 'leave',
      text: 'Caro salió de la sala',
    });
    expect(infoFeedItem('Nueva ronda', 's6')).toMatchObject({ tone: 'info', text: 'Nueva ronda' });
  });
});

describe('trimFeed', () => {
  it('deja los últimos ítems', () => {
    const items = Array.from({ length: 10 }, (_, i) => infoFeedItem(`m${i}`, `id${i}`));
    const trimmed = trimFeed(items, 4);
    expect(trimmed.map((i) => i.id)).toEqual(['id6', 'id7', 'id8', 'id9']);
  });

  it('no toca listas cortas', () => {
    const items = [infoFeedItem('a', '1')];
    expect(trimFeed(items, 4)).toEqual(items);
  });
});
