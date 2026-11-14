import type { Player, ReviewGroup } from '@bach/shared';
import { describe, expect, it } from 'vitest';
import {
  eligibleVoters,
  missingAnswerers,
  pendingReady,
  rejectsNeeded,
  stampLabel,
  stampTone,
  statusNote,
  voteInfo,
} from './review';

function player(id: string, patch: Partial<Player> = {}): Player {
  return {
    id,
    name: id.toUpperCase(),
    score: 0,
    connected: true,
    isHost: false,
    playing: true,
    filled: 0,
    ready: false,
    ...patch,
  };
}

function group(patch: Partial<ReviewGroup> = {}): ReviewGroup {
  return {
    key: 'fresa',
    text: 'Fresa',
    playerIds: ['a'],
    rejectedBy: [],
    status: 'valid',
    points: 100,
    ...patch,
  };
}

const players = [player('a'), player('b'), player('c'), player('d')];

describe('eligibleVoters', () => {
  it('excluye autores, desconectados y quienes no juegan', () => {
    const list = [
      player('a'),
      player('b'),
      player('c', { connected: false }),
      player('d', { playing: false }),
      player('e'),
    ];
    expect(eligibleVoters(group({ playerIds: ['a'] }), list).map((p) => p.id)).toEqual(['b', 'e']);
  });
});

describe('rejectsNeeded', () => {
  it('es más de la mitad de los votantes', () => {
    expect(rejectsNeeded(1)).toBe(1);
    expect(rejectsNeeded(2)).toBe(2);
    expect(rejectsNeeded(3)).toBe(2);
    expect(rejectsNeeded(4)).toBe(3);
    expect(rejectsNeeded(11)).toBe(6);
  });

  it('sin votantes no hay nada que votar', () => {
    expect(rejectsNeeded(0)).toBe(0);
  });
});

describe('voteInfo', () => {
  it('un votante cualquiera puede votar y ve el contador', () => {
    const info = voteInfo(group({ rejectedBy: ['c'] }), players, 'b');
    expect(info).toEqual({ votes: 1, needed: 2, voted: false, canVote: true, blockedReason: null });
  });

  it('marca si ya votó (para poder desmarcar)', () => {
    expect(voteInfo(group({ rejectedBy: ['b'] }), players, 'b').voted).toBe(true);
  });

  it('el autor no puede votar su propia respuesta', () => {
    const info = voteInfo(group(), players, 'a');
    expect(info.canVote).toBe(false);
    expect(info.blockedReason).toBe('author');
  });

  it('quien no participa solo mira', () => {
    const list = [...players, player('z', { playing: false })];
    const info = voteInfo(group(), list, 'z');
    expect(info.canVote).toBe(false);
    expect(info.blockedReason).toBe('spectator');
  });

  it('una respuesta anulada por letra no se vota', () => {
    const info = voteInfo(group({ status: 'wrong_letter', points: 0 }), players, 'b');
    expect(info.blockedReason).toBe('wrong_letter');
  });

  it('una rechazada sigue permitiendo desmarcar', () => {
    const info = voteInfo(
      group({ status: 'rejected', points: 0, rejectedBy: ['b', 'c'] }),
      players,
      'b',
    );
    expect(info.canVote).toBe(true);
    expect(info.voted).toBe(true);
  });

  it('si el único participante es el autor, nadie puede votar', () => {
    const info = voteInfo(group(), [player('a')], 'a');
    expect(info.needed).toBe(0);
  });
});

describe('missingAnswerers', () => {
  it('lista a los participantes que no están en ningún grupo', () => {
    const groups = [group({ playerIds: ['a', 'b'] }), group({ key: 'x', playerIds: ['c'] })];
    const list = [...players, player('e', { playing: false })];
    expect(missingAnswerers(list, groups).map((p) => p.id)).toEqual(['d']);
  });
});

describe('pendingReady', () => {
  it('cuenta participantes conectados sin "Listo"', () => {
    const list = [
      player('a', { ready: true }),
      player('b'),
      player('c', { connected: false }),
      player('d', { playing: false }),
    ];
    expect(pendingReady(list)).toBe(1);
  });
});

describe('sello y estado', () => {
  it('cada puntaje tiene su tono', () => {
    expect(stampTone({ status: 'valid', points: 50 })).toBe('repeated');
    expect(stampTone({ status: 'valid', points: 100 })).toBe('unique');
    expect(stampTone({ status: 'valid', points: 200 })).toBe('alone');
    expect(stampTone({ status: 'rejected', points: 0 })).toBe('none');
    expect(stampTone({ status: 'wrong_letter', points: 0 })).toBe('none');
  });

  it('explica por qué no vale', () => {
    expect(statusNote({ status: 'wrong_letter' }, 'F')).toBe('No empieza con F');
    expect(statusNote({ status: 'rejected' }, 'F')).toBe('No vale');
    expect(statusNote({ status: 'valid' }, 'F')).toBeNull();
  });

  it('etiqueta de lector de pantalla', () => {
    expect(stampLabel({ status: 'valid', points: 200 })).toBe('200 puntos');
    expect(stampLabel({ status: 'rejected', points: 0 })).toBe('Sin puntos');
  });
});
