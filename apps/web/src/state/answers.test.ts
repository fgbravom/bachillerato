import { MAX_ANSWER_UPDATES_PER_SECOND, type CategoryId } from '@bach/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_DEBOUNCE_MS,
  AnswerSync,
  DEBOUNCED_PER_WINDOW,
  mergeAnswers,
  sanitizeAnswer,
} from './answers';

type Sent = { category: CategoryId; text: string; at: number };

const IDS: CategoryId[] = ['nombre', 'lugar', 'cosa', 'fruta', 'animal', 'tv', 'cantante'];

function setup(online = true) {
  const sent: Sent[] = [];
  const state = { online };
  const sync = new AnswerSync({
    send(category, text) {
      if (!state.online) return false;
      sent.push({ category, text, at: Date.now() });
      return true;
    },
  });
  return { sync, sent, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sanitizeAnswer y mergeAnswers', () => {
  it('recorta y colapsa espacios como el servidor', () => {
    expect(sanitizeAnswer('  Ana   María ')).toBe('Ana María');
    expect(sanitizeAnswer('x'.repeat(40))).toHaveLength(30);
  });

  it('lo local gana donde difiere del servidor y se ignoran las diferencias de espacios', () => {
    const merged = mergeAnswers(
      { nombre: 'Felipe', lugar: 'Fra' },
      { nombre: 'Felipe ', lugar: 'Francia', cosa: 'Fucsia' },
    );
    expect(merged).toEqual({ nombre: 'Felipe', lugar: 'Francia', cosa: 'Fucsia' });
    expect(mergeAnswers(null, {})).toEqual({});
  });
});

describe('retardo (debounce con trailing)', () => {
  it('el retardo es de 300 ms o menos', () => {
    expect(ANSWER_DEBOUNCE_MS).toBeLessThanOrEqual(300);
  });

  it('envía solo el último texto, tras el retardo de la última tecla', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'F');
    vi.advanceTimersByTime(100);
    sync.change(1, 'nombre', 'Fe');
    vi.advanceTimersByTime(100);
    sync.change(1, 'nombre', 'Fel');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ category: 'nombre', text: 'Fel', at: 200 + ANSWER_DEBOUNCE_MS }]);
  });

  it('cada categoría tiene su propio retardo', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    vi.advanceTimersByTime(150);
    sync.change(1, 'lugar', 'Francia');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS - 150);
    expect(sent.map((s) => s.category)).toEqual(['nombre']);
    vi.advanceTimersByTime(150);
    expect(sent.map((s) => s.category)).toEqual(['nombre', 'lugar']);
  });

  it('envía el texto saneado (sin espacios de más)', () => {
    const { sync, sent } = setup();
    sync.change(1, 'cosa', '  Color   rojo ');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    expect(sent[0]?.text).toBe('Color rojo');
  });

  it('no envía de nuevo lo que el servidor ya tiene', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    sync.change(1, 'nombre', 'Felipe ');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toHaveLength(1);
  });

  it('borrar un campo ya enviado envía el texto vacío', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    sync.change(1, 'nombre', '');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    expect(sent.map((s) => s.text)).toEqual(['Felipe', '']);
  });

  it('volver al texto ya enviado cancela el envío pendiente', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    sync.change(1, 'nombre', 'Felipex');
    sync.change(1, 'nombre', 'Felipe');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toHaveLength(1);
  });
});

describe('flush', () => {
  it('envía de inmediato todo lo pendiente y el retardo no vuelve a enviarlo', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    sync.change(1, 'lugar', 'Francia');
    sync.flush();
    expect(sent.map((s) => s.category)).toEqual(['nombre', 'lugar']);
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('sin nada pendiente no envía', () => {
    const { sync, sent } = setup();
    sync.flush();
    expect(sent).toEqual([]);
  });

  it('la hoja completa sale entera aunque los envíos con retardo hayan usado su cupo', () => {
    const { sync, sent } = setup();
    // Dos rondas de teclas en las siete categorías dentro del mismo segundo: 13 envíos y uno diferido.
    for (const text of ['F1', 'F2']) {
      for (const id of IDS) sync.change(1, id, text);
      vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    }
    expect(sent).toHaveLength(DEBOUNCED_PER_WINDOW);

    for (const id of IDS) sync.change(1, id, 'F3');
    sync.flush();
    expect(sent).toHaveLength(MAX_ANSWER_UPDATES_PER_SECOND);
    const last = new Map(sent.map((s) => [s.category, s.text]));
    expect([...last.values()]).toEqual(IDS.map(() => 'F3'));
  });

  it('sin conexión no marca nada como enviado y resync lo repone', () => {
    const { sync, sent, state } = setup(false);
    sync.change(1, 'nombre', 'Felipe');
    sync.flush();
    expect(sent).toEqual([]);
    state.online = true;
    sync.resync(1, {});
    expect(sent.map((s) => [s.category, s.text])).toEqual([['nombre', 'Felipe']]);
  });
});

describe('límite por segundo', () => {
  it('nunca pasa del cupo de envíos en una ventana de un segundo', () => {
    const { sync, sent } = setup();
    const expected = new Map<CategoryId, string>();
    // Escritura rápida: las siete categorías cambian cada 300 ms (justo tras cada retardo).
    for (let t = 0; t < 6000; t += 300) {
      IDS.forEach((id, i) => {
        const text = `F${t}-${i}`;
        expected.set(id, text);
        sync.change(1, id, text);
      });
      vi.advanceTimersByTime(300);
    }
    const debounced = [...sent];
    sync.flush();
    vi.advanceTimersByTime(3000);

    expect(debounced.length).toBeGreaterThan(0);
    for (const s of debounced) {
      const inWindow = debounced.filter((o) => o.at >= s.at && o.at < s.at + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(DEBOUNCED_PER_WINDOW);
    }
    for (const s of sent) {
      const inWindow = sent.filter((o) => o.at >= s.at && o.at < s.at + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(MAX_ANSWER_UPDATES_PER_SECOND);
    }
    // Aunque se difirieron envíos, el servidor termina con lo último escrito en cada categoría.
    const last = new Map(sent.map((s) => [s.category, s.text]));
    expect(last).toEqual(expected);
  });

  it('con el cupo agotado difiere el envío en vez de perderlo', () => {
    const { sync, sent } = setup();
    for (const text of ['F1', 'F2']) {
      for (const id of IDS) sync.change(1, id, text);
      vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    }
    expect(sent).toHaveLength(DEBOUNCED_PER_WINDOW);
    expect(sent.some((s) => s.category === 'cantante' && s.text === 'F2')).toBe(false);

    // Cuando sale de la ventana el envío más antiguo, queda libre el cupo y sale el diferido.
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(DEBOUNCED_PER_WINDOW + 1);
    expect(sent.at(-1)).toMatchObject({ category: 'cantante', text: 'F2' });
  });
});

describe('reconexión y rondas', () => {
  it('resync reenvía lo local que el servidor no tiene y respeta lo que sí tiene', () => {
    const { sync, sent } = setup();
    sync.change(2, 'nombre', 'Felipe');
    sync.change(2, 'lugar', 'Francia');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    sent.length = 0;

    // Se cayó la conexión: lo último de "lugar" no llegó; el servidor tiene "Fra".
    sync.change(2, 'lugar', 'Francia del sur');
    sync.change(2, 'cosa', 'Fucsia');
    sync.resync(2, { nombre: 'Felipe', lugar: 'Fra' });
    expect(sent.map((s) => [s.category, s.text]).sort()).toEqual([
      ['cosa', 'Fucsia'],
      ['lugar', 'Francia del sur'],
    ]);
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('resync de una ronda distinta descarta el borrador viejo', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    sync.resync(2, {});
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toEqual([]);
    expect(sync.getDraft(1)).toEqual({});
  });

  it('getDraft devuelve lo tecleado en esa ronda', () => {
    const { sync } = setup();
    sync.change(3, 'nombre', 'Fe');
    expect(sync.getDraft(3)).toEqual({ nombre: 'Fe' });
    expect(sync.getDraft(4)).toEqual({});
  });

  it('cambiar de ronda o resetear cancela lo pendiente', () => {
    const { sync, sent } = setup();
    sync.change(1, 'nombre', 'Felipe');
    sync.change(2, 'lugar', 'Francia');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    expect(sent.map((s) => s.category)).toEqual(['lugar']);

    sync.change(2, 'cosa', 'Fucsia');
    sync.reset();
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS * 2);
    expect(sent).toHaveLength(1);
    expect(sync.getDraft(2)).toEqual({});
  });
});

describe('recarga de la página', () => {
  it('con el borrador vacío, resync y flush no pisan lo que el servidor ya tiene', () => {
    const { sync, sent } = setup();
    sync.resync(1, { nombre: 'Felipe', lugar: 'Francia' });
    sync.flush();
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual([]);
    // Borrar un campo a mano sí se envía.
    sync.change(1, 'nombre', '');
    vi.advanceTimersByTime(ANSWER_DEBOUNCE_MS);
    expect(sent.map((m) => [m.category, m.text])).toEqual([['nombre', '']]);
  });
});
