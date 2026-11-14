import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '@bach/shared';
import {
  assertNoAnswerLeak,
  emitsOf,
  fill,
  groupsNow,
  sheetFor,
  startedGame,
  toReview,
  toWriting,
  write,
  writingGame,
} from './testing.js';

describe('respuestas en WRITING', () => {
  it('guarda la respuesta y avisa el avance solo cuando cambia filled', () => {
    const h = writingGame(['Ana', 'Beto']);
    const mark = h.effects.length;

    write(h, 'p1', 'nombre', 'Ana');
    write(h, 'p1', 'nombre', 'Andrea'); // mismo filled: nada
    write(h, 'p1', 'lugar', 'Arica');
    write(h, 'p1', 'lugar', ''); // vacío borra
    const progress = emitsOf(h.since(mark), 'round:progress');

    expect(progress.map((e) => e.payload)).toEqual([
      { playerId: 'p1', filled: 1 },
      { playerId: 'p1', filled: 2 },
      { playerId: 'p1', filled: 1 },
    ]);
    expect(progress.every((e) => e.to.kind === 'room')).toBe(true);
    expect(h.state.current?.sheets['p1']).toEqual({ nombre: 'Andrea' });
  });

  it('Player.filled refleja el avance en WRITING y vuelve a 0 después', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1');
    write(h, 'p2', 'nombre', 'Beto');
    const snap = h.dispatch({ type: 'join', sessionId: 'secret-Ana', name: 'Ana', connId: 'x' });
    const players = snap.effects.flatMap((e) => (e.type === 'snapshot' ? e.snapshot.players : []));
    expect(players.map((p) => [p.id, p.filled])).toEqual([
      ['p1', 7],
      ['p2', 1],
    ]);
    toReview(h);
    const after = h.dispatch({ type: 'join', sessionId: 'secret-Ana', name: 'Ana', connId: 'y' });
    const players2 = after.effects.flatMap((e) =>
      e.type === 'snapshot' ? e.snapshot.players : [],
    );
    expect(players2.every((p) => p.filled === 0)).toBe(true);
  });

  it('un texto sin letras ni números equivale a dejar la categoría vacía', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Ana');
    write(h, 'p1', 'nombre', '!!!');
    expect(h.state.current?.sheets['p1']).toEqual({});
  });

  it('errores: fase, participante, categoría y largo', () => {
    const h = startedGame(['Ana', 'Beto']);
    const upd = (playerId: string, text = 'Ana', category = 'nombre') =>
      h.dispatch({ type: 'updateAnswer', playerId, category: category as 'nombre', text });
    expect(upd('p1').error).toBe('wrong_phase'); // LETTER
    toWriting(h);
    expect(upd('nadie').error).toBe('not_in_room');
    h.join('Caro'); // entra tarde: mira
    expect(upd('p3').error).toBe('not_playing');
    expect(upd('p1', 'A'.repeat(31)).error).toBe('invalid_payload');
    expect(upd('p1', 'Ana', 'otra').error).toBe('invalid_payload');
    expect(upd('p1').error).toBeUndefined();
  });
});

describe('STOP', () => {
  it('sin las 7 categorías da sheet_incomplete y no cambia nada', () => {
    const h = writingGame(['Ana', 'Beto']);
    for (const id of CATEGORY_IDS.slice(0, 6)) write(h, 'p1', id, sheetFor(h, 'p1')[id] ?? '');
    const before = h.state;
    const res = h.dispatch({ type: 'stop', playerId: 'p1' });
    expect(res.error).toBe('sheet_incomplete');
    expect(res.effects).toEqual([]);
    expect(h.state.current?.stopped).toBeNull();
    expect(h.state.deadline).toBe(before.deadline);
  });

  it('con una respuesta que no empieza con la letra da sheet_incomplete', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1', { animal: 'Burro' }); // la letra es A
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBe('sheet_incomplete');
    write(h, 'p1', 'animal', 'Águila'); // con tilde también vale
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBeUndefined();
  });

  it('exige ser participante y estar en WRITING', () => {
    const h = startedGame(['Ana', 'Beto']);
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBe('wrong_phase');
    toWriting(h);
    expect(h.dispatch({ type: 'stop', playerId: 'nadie' }).error).toBe('not_in_room');
    h.join('Caro');
    fill(h, 'p1');
    expect(h.dispatch({ type: 'stop', playerId: 'p3' }).error).toBe('not_playing');
  });

  it('hoja completa: cierra, emite round:stopped y tras 1 s de gracia pasa a REVIEW', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1');
    h.advanceBy(10_000);
    const mark = h.effects.length;
    const res = h.dispatch({ type: 'stop', playerId: 'p1' });
    expect(res.error).toBeUndefined();
    const [stopped] = emitsOf(h.since(mark), 'round:stopped');
    expect(stopped?.payload).toEqual({ by: 'p1', endsAt: h.now + 1_000 });
    expect(stopped?.to).toEqual({ kind: 'room' });
    expect(h.state.current?.stopped).toEqual({ by: 'p1' });
    expect(h.state.phase).toBe('WRITING');

    h.advanceBy(999);
    expect(h.state.phase).toBe('WRITING');
    h.advanceBy(1);
    expect(h.state.phase).toBe('REVIEW');
  });

  it('durante la gracia siguen llegando respuestas pero no otro STOP', () => {
    const h = writingGame(['Ana', 'Beto']);
    fill(h, 'p1');
    h.dispatch({ type: 'stop', playerId: 'p1' });
    h.advanceBy(500);
    write(h, 'p2', 'nombre', 'Alberto'); // llega en la gracia
    fill(h, 'p2');
    expect(h.dispatch({ type: 'stop', playerId: 'p2' }).error).toBe('wrong_phase');
    expect(h.dispatch({ type: 'stop', playerId: 'p1' }).error).toBe('wrong_phase');
    h.advanceBy(500);
    expect(h.state.phase).toBe('REVIEW');
    expect(groupsNow(h).map((g) => g.text)).toEqual(['Anombrep1', 'Anombrep2']);
  });

  it('una respuesta que llega justo al vencer el tiempo cae en la gracia', () => {
    const h = writingGame(['Ana', 'Beto']);
    h.advanceTo(h.state.deadline! - 1);
    h.advanceBy(1); // vence WRITING: abre la gracia
    expect(h.state.current?.stopped).toEqual({ by: null });
    write(h, 'p1', 'nombre', 'Ana');
    expect(h.state.current?.sheets['p1']).toEqual({ nombre: 'Ana' });
  });

  it('tras la gracia ya no se aceptan respuestas', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Ana');
    toReview(h);
    const res = h.dispatch({ type: 'updateAnswer', playerId: 'p1', category: 'nombre', text: 'A' });
    expect(res.error).toBe('wrong_phase');
  });
});

describe('fin de WRITING por tiempo', () => {
  it('al vencer: stopped con by null y round:stopped; luego gracia y REVIEW', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Ana');
    write(h, 'p2', 'nombre', 'Alberto');
    const writingEnds = h.state.deadline!;
    const mark = h.effects.length;
    h.advanceTo(writingEnds);
    const [stopped] = emitsOf(h.since(mark), 'round:stopped');
    expect(stopped?.payload).toEqual({ by: null, endsAt: writingEnds + 1_000 });
    expect(h.state.phase).toBe('WRITING');
    h.advanceTo(writingEnds + 1_000);
    expect(h.state.phase).toBe('REVIEW');
  });

  it('el tiempo sale de settings.writeSeconds y writeMsOverride lo reemplaza', () => {
    const a = writingGame(['Ana', 'Beto'], { settings: { writeSeconds: 30 } });
    expect(a.state.deadline).toBe(a.now + 30_000);
    const b = writingGame(['Ana', 'Beto'], { config: { writeMsOverride: 1_500 } });
    expect(b.state.deadline).toBe(b.now + 1_500);
  });
});

describe('las respuestas ajenas no se filtran durante WRITING', () => {
  it('ningún efecto a otro jugador contiene respuestas ajenas, hasta que empieza REVIEW', () => {
    const h = writingGame(['Ana', 'Beto', 'Caro']);
    const secrets: Record<string, string[]> = {};
    for (const id of ['p1', 'p2', 'p3']) {
      const sheet = sheetFor(h, id, { nombre: `Asecreto${id}` });
      secrets[id] = Object.values(sheet);
      fill(h, id, { nombre: `Asecreto${id}` });
    }
    // Reconexiones y entradas tardías en pleno WRITING: los snapshots tampoco filtran.
    h.disconnect('p2');
    h.reconnect('Beto');
    h.join('Dani'); // mira
    h.dispatch({ type: 'stop', playerId: 'p3' });
    h.advanceBy(1_000);
    expect(h.state.phase).toBe('REVIEW');

    const reviewStart = h.effects.findIndex(
      (e) => e.type === 'emit' && e.event === 'review:category',
    );
    expect(reviewStart).toBeGreaterThan(0);
    expect(() => assertNoAnswerLeak(h.effects.slice(0, reviewStart), secrets)).not.toThrow();

    // Sanity: en REVIEW sí aparecen (a la sala), así que el detector funciona.
    expect(() => assertNoAnswerLeak(h.effects, secrets)).toThrow(/Fuga/);
  });

  it('round:progress solo trae id y cantidad; el snapshot propio trae solo las propias', () => {
    const h = writingGame(['Ana', 'Beto']);
    write(h, 'p1', 'nombre', 'Aardvark');
    write(h, 'p2', 'nombre', 'Alberto');
    const progress = emitsOf(h.effects, 'round:progress');
    for (const e of progress) expect(Object.keys(e.payload).sort()).toEqual(['filled', 'playerId']);

    const res = h.dispatch({ type: 'join', sessionId: 'secret-Beto', name: 'Beto', connId: 'z' });
    const snap = res.effects.find((e) => e.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.snapshot.myAnswers).toEqual({ nombre: 'Alberto' });
    expect(JSON.stringify(res.effects)).not.toContain('Aardvark');
  });
});
