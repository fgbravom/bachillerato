import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, DEFAULT_WRITE_SECONDS } from '@bach/shared';
import { createGame } from './index.js';
import { DEFAULT_ENGINE_CONFIG } from './config.js';
import { createHarness, emitsOf, snapshotsOf, startedGame } from './testing.js';

describe('estado inicial', () => {
  it('LOBBY con ajustes y config por defecto', () => {
    const state = createGame();
    expect(state).toMatchObject({
      phase: 'LOBBY',
      round: 0,
      players: [],
      hostId: null,
      current: null,
      deadline: null,
      settings: { rounds: DEFAULT_ROUNDS, writeSeconds: DEFAULT_WRITE_SECONDS },
    });
    expect(state.config).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it('los tiempos por defecto salen de las constantes del contrato', () => {
    expect(DEFAULT_ENGINE_CONFIG).toMatchObject({
      letterSpinMs: 8_000,
      letterRevealMs: 3_000,
      stopGraceMs: 1_000,
      reviewMs: 20_000,
      roundEndMs: 10_000,
      graceMs: 30_000,
      minPlayers: 2,
      maxPlayers: 12,
    });
  });

  it('createGame acepta overrides de config y de ajustes', () => {
    const state = createGame({ reviewMs: 500, lettersOverride: ['M'] }, { rounds: 2 });
    expect(state.config.reviewMs).toBe(500);
    expect(state.config.lettersOverride).toEqual(['M']);
    expect(state.settings).toEqual({ rounds: 2, writeSeconds: DEFAULT_WRITE_SECONDS });
  });
});

describe('ajustes', () => {
  it('solo el anfitrión, solo en LOBBY y dentro de rango; manda snapshot a cada conectado', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto');
    const set = (playerId: string, rounds: number, writeSeconds: number) =>
      h.dispatch({ type: 'updateSettings', playerId, rounds, writeSeconds });
    expect(set('p2', 3, 60).error).toBe('not_host');
    expect(set('nadie', 3, 60).error).toBe('not_in_room');
    expect(set('p1', 0, 60).error).toBe('invalid_payload');
    expect(set('p1', 11, 60).error).toBe('invalid_payload');
    expect(set('p1', 3, 29).error).toBe('invalid_payload');
    expect(set('p1', 3, 181).error).toBe('invalid_payload');
    expect(set('p1', 2.5, 60).error).toBe('invalid_payload');
    const res = set('p1', 3, 60);
    expect(res.error).toBeUndefined();
    expect(h.state.settings).toEqual({ rounds: 3, writeSeconds: 60 });
    expect(snapshotsOf(res.effects).map((s) => s.playerId)).toEqual(['p1', 'p2']);

    h.dispatch({ type: 'start', playerId: 'p1' });
    expect(set('p1', 4, 60).error).toBe('wrong_phase');
  });
});

describe('inicio', () => {
  it('solo el anfitrión, con al menos 2 conectados', () => {
    const h = createHarness();
    h.join('Ana');
    expect(h.dispatch({ type: 'start', playerId: 'p1' }).error).toBe('not_enough_players');
    h.join('Beto');
    expect(h.dispatch({ type: 'start', playerId: 'p2' }).error).toBe('not_host');
    expect(h.dispatch({ type: 'start', playerId: 'nadie' }).error).toBe('not_in_room');
    h.disconnect('p2');
    expect(h.dispatch({ type: 'start', playerId: 'p1' }).error).toBe('not_enough_players');
    h.reconnect('Beto');
    expect(h.dispatch({ type: 'start', playerId: 'p1' }).error).toBeUndefined();
    expect(h.dispatch({ type: 'start', playerId: 'p1' }).error).toBe('wrong_phase');
  });

  it('entra en LETTER con la ronda 1, los conectados como participantes y player:updated', () => {
    const h = createHarness();
    h.joinAll('Ana', 'Beto', 'Caro');
    h.disconnect('p3');
    const mark = h.effects.length;
    h.dispatch({ type: 'start', playerId: 'p1' });
    expect(h.state).toMatchObject({ phase: 'LETTER', round: 1 });
    expect(h.state.current?.playing).toEqual(['p1', 'p2']); // Caro estaba caída
    const updated = emitsOf(h.since(mark), 'player:updated').map((e) => e.payload.id);
    expect(updated).toEqual(['p1', 'p2']);
  });

  it('reinicia los puntajes con player:updated de quien cambió', () => {
    const h = createHarness({ settings: { rounds: 1 } });
    h.joinAll('Ana', 'Beto');
    const ana = h.state.players[0];
    if (ana) ana.score = 120;
    const mark = h.effects.length;
    h.dispatch({ type: 'start', playerId: 'p1' });
    expect(h.state.players[0]?.score).toBe(0);
    const resets = emitsOf(h.since(mark), 'player:updated').filter((e) => e.payload.score === 0);
    expect(resets.some((e) => e.payload.id === 'p1')).toBe(true);
  });
});

describe('GAME_END', () => {
  it('no vence solo; el anfitrión con start vuelve a LOBBY conservando puntajes', () => {
    const h = startedGame(['Ana', 'Beto'], { settings: { rounds: 1 } });
    while (h.state.phase !== 'GAME_END') h.advanceTo(h.state.deadline!);
    h.state.players[0]!.score = 500;
    h.advanceBy(3_600_000);
    expect(h.state.phase).toBe('GAME_END');
    expect(h.dispatch({ type: 'start', playerId: 'p2' }).error).toBe('not_host');
    const res = h.dispatch({ type: 'start', playerId: 'p1' });
    expect(res.error).toBeUndefined();
    expect(h.state).toMatchObject({ phase: 'LOBBY', round: 0, current: null, ranking: null });
    expect(h.state.players[0]?.score).toBe(500);
    expect(snapshotsOf(res.effects).map((s) => s.playerId)).toEqual(['p1', 'p2']);
  });
});
