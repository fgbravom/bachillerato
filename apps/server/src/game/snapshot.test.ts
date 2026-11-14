import { describe, expect, it } from 'vitest';
import { buildSnapshot } from './index.js';
import {
  createHarness,
  fill,
  readyAll,
  startedGame,
  stopLetter,
  toReview,
  write,
  writingGame,
} from './testing.js';

const snap = (h: ReturnType<typeof createHarness>, id: string) => buildSnapshot(h.state, id, h.now);

describe('buildSnapshot', () => {
  it('LOBBY: sin ronda, letra ni reloj; categorías del contrato', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto');
    const s = snap(h, 'p2');
    expect(s).toMatchObject({
      phase: 'LOBBY',
      selfId: 'p2',
      hostId: 'p1',
      round: 0,
      totalRounds: 5,
      pickerId: null,
      letter: null,
      endsAt: null,
      serverNow: h.now,
      stopped: null,
      myAnswers: null,
      review: null,
      roundEnd: null,
      ranking: null,
    });
    expect(s.categories.map((c) => c.id)).toEqual([
      'nombre',
      'lugar',
      'cosa',
      'fruta',
      'animal',
      'tv',
      'cantante',
    ]);
    expect('code' in s).toBe(false);
  });

  it('LETTER girando: picker y reloj, sin letra; revelada: con letra', () => {
    const h = startedGame(['Ana', 'Beto']);
    expect(snap(h, 'p2')).toMatchObject({
      phase: 'LETTER',
      round: 1,
      pickerId: 'p1',
      letter: null,
      endsAt: h.state.deadline,
      players: [
        { id: 'p1', playing: true },
        { id: 'p2', playing: true },
      ],
    });
    stopLetter(h);
    expect(snap(h, 'p2')).toMatchObject({ phase: 'LETTER', letter: 'A', pickerId: 'p1' });
  });

  it('WRITING: solo las propias respuestas; el resto de los jugadores no las ve', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Aardvark');
    write(h, 'p2', 'nombre', 'Alberto');
    expect(snap(h, 'p1').myAnswers).toEqual({ nombre: 'Aardvark' });
    expect(snap(h, 'p2').myAnswers).toEqual({ nombre: 'Alberto' });
    expect(snap(h, 'p1')).toMatchObject({ letter: 'A', pickerId: null, stopped: null });
    expect(JSON.stringify(snap(h, 'p1'))).not.toContain('Alberto');
    expect(JSON.stringify(snap(h, 'p2'))).not.toContain('Aardvark');
  });

  it('WRITING cerrada: expone stopped; una hoja vacía es {} para el participante', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1');
    h.dispatch({ type: 'stop', playerId: 'p1' });
    expect(snap(h, 'p1').stopped).toEqual({ by: 'p1' });
    expect(snap(h, 'p2').myAnswers).toEqual({});
  });

  it('REVIEW: categoría en curso con sus grupos; myAnswers deja de venir', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'Alberto' });
    toReview(h);
    const s = snap(h, 'p2');
    expect(s.myAnswers).toBeNull();
    expect(s.review).toMatchObject({ category: 'nombre', index: 0, total: 7 });
    expect(s.review?.groups.map((g) => g.text)).toEqual(['Ana', 'Alberto']);
    expect(s.endsAt).toBe(h.state.deadline);
    expect(s.stopped).toBeNull();
  });

  it('ROUND_END y GAME_END traen su resultado y nada más', () => {
    const h = writingGame(['Ana', 'Beto'], { settings: { rounds: 1 } });
    fill(h, 'p1', { nombre: 'Ana' });
    fill(h, 'p2', { nombre: 'Alberto' });
    toReview(h);
    while (h.state.phase === 'REVIEW') readyAll(h);
    const end = snap(h, 'p1');
    expect(end.phase).toBe('ROUND_END');
    expect(end.review).toBeNull();
    expect(end.roundEnd).toMatchObject({
      letter: 'A',
      stoppedBy: null,
      gains: { p1: 700, p2: 700 },
      scores: { p1: 700, p2: 700 },
    });
    h.advanceTo(h.state.deadline!);
    const fin = snap(h, 'p1');
    expect(fin.phase).toBe('GAME_END');
    expect(fin.roundEnd).toBeNull();
    expect(fin.letter).toBeNull();
    expect(fin.ranking?.map((r) => [r.playerId, r.rank])).toEqual([
      ['p1', 1],
      ['p2', 1],
    ]);
    expect(fin.players.every((p) => !p.playing)).toBe(true);
  });

  it('un snapshot no comparte referencias con el estado', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Ana');
    const s = snap(h, 'p1');
    if (s.myAnswers) s.myAnswers.nombre = 'Manipulado';
    expect(h.state.current?.sheets['p1']?.nombre).toBe('Ana');
  });
});
