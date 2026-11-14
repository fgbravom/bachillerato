import { describe, expect, it } from 'vitest';
import type { Answers } from '@bach/shared';
import {
  emitsOf,
  fill,
  groupsNow,
  readyAll,
  toReview,
  vote,
  write,
  writingGame,
} from './testing.js';
import type { Harness } from './testing.js';

/** Ronda con letra A donde cada jugador responde `nombre` con lo indicado (el resto es único). */
function reviewGame(names: string[], nombre: string[]): Harness {
  const h = writingGame(names);
  nombre.forEach((text, i) => fill(h, h.idAt(i), { nombre: text }));
  toReview(h);
  return h;
}

const pointsOf = (h: Harness) => Object.fromEntries(groupsNow(h).map((g) => [g.key, g.points]));

describe('grupos y puntos de una categoría', () => {
  it('50, 100 y 200: repetida, única y sola', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'ANA', 'Andrea']);
    expect(h.state.phase).toBe('REVIEW');
    const [first, second] = groupsNow(h);
    expect(first).toMatchObject({ key: 'ana', text: 'Ana', playerIds: ['p1', 'p2'], points: 50 });
    expect(second).toMatchObject({ key: 'andrea', playerIds: ['p3'], points: 100 });

    // 200: Caro queda como única respuesta válida cuando los otros dos se anulan o rechazan.
    const solo = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    vote(solo, 'p1', 'alberto'); // con 2 jugadores basta el voto del otro
    expect(pointsOf(solo)).toEqual({ ana: 200, alberto: 0 });
  });

  it('agrupa tras normalizar (mayúsculas, tildes, espacios) y el texto es el del primer autor', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ágata Rosa', 'agata   rosa', 'AGATA ROSA']);
    const groups = groupsNow(h);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'agata rosa',
      text: 'Ágata Rosa',
      playerIds: ['p1', 'p2', 'p3'],
      points: 50,
    });
  });

  it('el orden de los grupos es estable: por llegada del primer autor', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Zeta', 'Alfa', 'Zeta']);
    // Ana llegó primero con "Zeta" (anulada por la letra); su grupo va antes que el de Beto
    expect(groupsNow(h).map((g) => g.key)).toEqual(['zeta', 'alfa']);
  });

  it('wrong_letter: anulada automáticamente, sin puntos y no cuenta para el 200 ajeno', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Bruno']);
    const [ok, wrong] = groupsNow(h);
    expect(ok).toMatchObject({ status: 'valid', points: 200 });
    expect(wrong).toMatchObject({ key: 'bruno', status: 'wrong_letter', points: 0 });
  });

  it('un voto sobre una respuesta anulada por la letra da unknown_answer', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Bruno', 'Ana']);
    expect(vote(h, 'p1', 'bruno').error).toBe('unknown_answer'); // anulada: no votable
    expect(vote(h, 'p2', 'bruno').error).toBe('own_answer');
    expect(vote(h, 'p2', 'ana').error).toBeUndefined();
  });
});

describe('votos "No vale"', () => {
  it('own_answer, unknown_answer, not_playing y wrong_phase', () => {
    const h = writingGame(['Ana', 'Beto', 'Caro']);
    fill(h, 'p1', { nombre: 'Ana' });
    expect(vote(h, 'p2', 'ana').error).toBe('wrong_phase'); // aún en WRITING
    fill(h, 'p2', { nombre: 'Alberto' });
    fill(h, 'p3', { nombre: 'Alberto' });
    h.join('Dani'); // llegó tarde: mira
    toReview(h);

    expect(vote(h, 'p1', 'ana').error).toBe('own_answer');
    expect(vote(h, 'p2', 'nada').error).toBe('unknown_answer');
    expect(vote(h, 'p4', 'ana').error).toBe('not_playing');
    expect(vote(h, 'nadie', 'ana').error).toBe('not_in_room');
    expect(vote(h, 'p2', 'ana').error).toBeUndefined();
  });

  it('solo se vota en la categoría en curso', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    // 'alugarp1' es de la categoría siguiente: todavía no se puede votar
    expect(vote(h, 'p2', 'alugarp1').error).toBe('unknown_answer');
  });

  it('con 2 jugadores basta el voto del otro', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    vote(h, 'p2', 'ana');
    expect(groupsNow(h)[0]).toMatchObject({ status: 'rejected', points: 0, rejectedBy: ['p2'] });
    expect(groupsNow(h)[1]).toMatchObject({ status: 'valid', points: 200 }); // la rechazada "no puso nada"
  });

  it('con 3 jugadores hacen falta 2 votos de los 2 posibles', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    vote(h, 'p2', 'ana');
    expect(groupsNow(h)[0]?.status).toBe('valid'); // 1 > 1 no
    vote(h, 'p3', 'ana');
    expect(groupsNow(h)[0]).toMatchObject({ status: 'rejected', points: 0 });
    vote(h, 'p3', 'ana', false); // desmarcar
    expect(groupsNow(h)[0]).toMatchObject({ status: 'valid', rejectedBy: ['p2'] });
  });

  it('con 4 jugadores hacen falta 2 votos de los 3 posibles', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro', 'Dani'], ['Ana', 'Alberto', 'Alicia', 'Alma']);
    vote(h, 'p2', 'ana');
    expect(groupsNow(h)[0]?.status).toBe('valid'); // 1 > 1.5 no
    vote(h, 'p3', 'ana');
    expect(groupsNow(h)[0]?.status).toBe('rejected'); // 2 > 1.5
  });

  it('los autores de un grupo repetido no cuentan como votantes posibles', () => {
    // Ana y Beto escribieron lo mismo: solo Caro y Dani pueden votar ese grupo (posibles = 2).
    const h = reviewGame(['Ana', 'Beto', 'Caro', 'Dani'], ['Ana', 'Ana', 'Alicia', 'Alma']);
    vote(h, 'p3', 'ana');
    expect(groupsNow(h)[0]?.status).toBe('valid'); // 1 > 1 no
    vote(h, 'p4', 'ana');
    expect(groupsNow(h)[0]).toMatchObject({ status: 'rejected', points: 0 });
  });

  it('votar lo mismo dos veces no cambia nada ni emite de nuevo', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    vote(h, 'p2', 'ana');
    const mark = h.effects.length;
    expect(vote(h, 'p2', 'ana').error).toBeUndefined();
    expect(h.since(mark)).toEqual([]);
  });

  it('cada voto emite review:update a la sala con grupos y listos', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    const mark = h.effects.length;
    vote(h, 'p2', 'ana');
    const [update] = emitsOf(h.since(mark), 'review:update');
    expect(update?.to).toEqual({ kind: 'room' });
    expect(update?.payload.category).toBe('nombre');
    expect(update?.payload.ready).toEqual([]);
    expect(update?.payload.groups[0]?.rejectedBy).toEqual(['p2']);
  });

  it('recalcula los puntos en vivo con cada voto', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alberto']);
    expect(pointsOf(h)).toEqual({ ana: 100, alberto: 50 });
    vote(h, 'p3', 'ana');
    vote(h, 'p2', 'ana');
    expect(pointsOf(h)).toEqual({ ana: 0, alberto: 50 }); // Alberto sigue repetido: 50
    // Ana rechaza "Alberto": posibles = {Ana} (autores Beto y Caro quedan fuera)
    vote(h, 'p1', 'alberto');
    expect(pointsOf(h)).toEqual({ ana: 0, alberto: 0 });
  });
});

describe('mayoría con presencia: se recalcula al conectarse o desconectarse alguien', () => {
  it('4 jugadores: al irse votantes que no votaron baja el umbral', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro', 'Dani'], ['Ana', 'Alberto', 'Alicia', 'Alma']);
    vote(h, 'p2', 'ana'); // 1 de 3 posibles: sigue válida
    expect(groupsNow(h)[0]?.status).toBe('valid');

    const mark = h.effects.length;
    h.disconnect('p3'); // posibles = {Beto, Dani}: 1 > 1 no
    expect(groupsNow(h)[0]?.status).toBe('valid');
    h.disconnect('p4'); // posibles = {Beto}: 1 > 0.5
    expect(groupsNow(h)[0]).toMatchObject({ status: 'rejected', points: 0 });
    expect(emitsOf(h.since(mark), 'review:update')).toHaveLength(1);

    h.reconnect('Dani'); // vuelve un votante: posibles = {Beto, Dani}: 1 > 1 no
    expect(groupsNow(h)[0]?.status).toBe('valid');
  });

  it('el voto de quien se desconecta deja de contar mientras está caído', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    vote(h, 'p2', 'ana');
    h.disconnect('p3'); // posibles = {Beto}: 1 > 0.5 -> rechazada
    expect(groupsNow(h)[0]?.status).toBe('rejected');
    h.reconnect('Caro');
    expect(groupsNow(h)[0]?.status).toBe('valid');
    h.disconnect('p2'); // Beto se cae: su voto no cuenta; posibles = {Caro}: 0 > 0.5 no
    expect(groupsNow(h)[0]).toMatchObject({ status: 'valid', rejectedBy: ['p2'] });
  });

  it('sin votantes posibles la respuesta queda válida', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    vote(h, 'p2', 'ana');
    expect(groupsNow(h)[0]?.status).toBe('rejected');
    h.disconnect('p2');
    expect(groupsNow(h)[0]?.status).toBe('valid'); // nadie puede votar
  });
});

describe('"Listo" y avance entre categorías', () => {
  it('con todos listos pasa a la siguiente categoría y reinicia "Listo"', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    expect(h.state.current?.review?.index).toBe(0);
    h.dispatch({ type: 'ready', playerId: 'p1', ready: true });
    h.dispatch({ type: 'ready', playerId: 'p2', ready: true });
    expect(h.state.current?.review?.index).toBe(0);
    const mark = h.effects.length;
    h.dispatch({ type: 'ready', playerId: 'p3', ready: true });

    expect(h.state.current?.review).toMatchObject({ index: 1, ready: [] });
    const fx = h.since(mark);
    expect(emitsOf(fx, 'review:update')).toHaveLength(1); // el último "Listo"
    const [cat] = emitsOf(fx, 'review:category');
    expect(cat?.payload).toMatchObject({ category: 'lugar', index: 1, total: 7 });
    expect(cat?.payload.endsAt).toBe(h.now + 20_000);
  });

  it('cada "Listo" emite review:update con la lista de listos; desmarcar lo quita', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    h.dispatch({ type: 'ready', playerId: 'p1', ready: true });
    h.dispatch({ type: 'ready', playerId: 'p2', ready: true });
    h.dispatch({ type: 'ready', playerId: 'p1', ready: false });
    const updates = emitsOf(h.effects, 'review:update').map((e) => e.payload.ready);
    expect(updates).toEqual([['p1'], ['p1', 'p2'], ['p2']]);
    const snap = h.dispatch({ type: 'join', sessionId: 'secret-Caro', name: 'Caro', connId: 'q' });
    const players = snap.effects.flatMap((e) => (e.type === 'snapshot' ? e.snapshot.players : []));
    expect(players.map((p) => [p.id, p.ready])).toEqual([
      ['p1', false],
      ['p2', true],
      ['p3', false],
    ]);
  });

  it('al vencer los 20 s avanza aunque falten listos', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    h.advanceBy(19_999);
    expect(h.state.current?.review?.index).toBe(0);
    h.advanceBy(1);
    expect(h.state.current?.review?.index).toBe(1);
    expect(h.state.deadline).toBe(h.now + 20_000);
  });

  it('los desconectados no frenan: si faltaba solo quien se cayó, avanza', () => {
    const h = reviewGame(['Ana', 'Beto', 'Caro'], ['Ana', 'Alberto', 'Alicia']);
    h.dispatch({ type: 'ready', playerId: 'p1', ready: true });
    h.dispatch({ type: 'ready', playerId: 'p2', ready: true });
    h.disconnect('p3');
    expect(h.state.current?.review?.index).toBe(1);
  });

  it('quien mira (no participante) no puede marcar "Listo" ni frena el avance', () => {
    const h = reviewGame(['Ana', 'Beto'], ['Ana', 'Alberto']);
    h.join('Caro');
    expect(h.dispatch({ type: 'ready', playerId: 'p3', ready: true }).error).toBe('not_playing');
    readyAll(h);
    expect(h.state.current?.review?.index).toBe(1);
  });

  it('"Listo" fuera de REVIEW da wrong_phase', () => {
    const h = writingGame(['Ana', 'Beto']);
    expect(h.dispatch({ type: 'ready', playerId: 'p1', ready: true }).error).toBe('wrong_phase');
  });

  it('las categorías sin ninguna respuesta se saltan; total cuenta solo las revisadas', () => {
    const h = writingGame(['Ana', 'Beto']);
    const some: Answers[] = [
      { nombre: 'Ana', animal: 'Águila' },
      { nombre: 'Alberto', animal: 'Águila' },
    ];
    some.forEach((sheet, i) => {
      for (const [cat, text] of Object.entries(sheet)) {
        write(h, h.idAt(i), cat as 'nombre', text);
      }
    });
    toReview(h);
    const [first] = emitsOf(h.effects, 'review:category');
    expect(first?.payload).toMatchObject({ category: 'nombre', index: 0, total: 2 });
    readyAll(h);
    const second = emitsOf(h.effects, 'review:category')[1];
    expect(second?.payload).toMatchObject({ category: 'animal', index: 1, total: 2 });
    readyAll(h);
    expect(h.state.phase).toBe('ROUND_END');
    expect(emitsOf(h.effects, 'review:category')).toHaveLength(2);
  });

  it('si nadie respondió nada, salta la revisión y va directo a ROUND_END sin puntos', () => {
    const h = writingGame(['Ana', 'Beto']);
    while (h.state.phase === 'WRITING') h.advanceTo(h.state.deadline!);
    expect(h.state.phase).toBe('ROUND_END');
    expect(emitsOf(h.effects, 'review:category')).toHaveLength(0);
    const [end] = emitsOf(h.effects, 'round:end');
    expect(end?.payload.gains).toEqual({ p1: 0, p2: 0 });
    expect(Object.values(end?.payload.results ?? {}).every((g) => g.length === 0)).toBe(true);
  });
});
