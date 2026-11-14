import { describe, expect, it } from 'vitest';
import { phaseAnnouncement, type PhaseAnnouncementInput } from './announce';

const base: PhaseAnnouncementInput = {
  phase: 'LETTER',
  round: 2,
  totalRounds: 5,
  letter: null,
  isPicker: false,
  pickerName: 'Cami',
  playing: true,
  reviewLabel: null,
  reviewIndex: 0,
  reviewTotal: 7,
};

describe('phaseAnnouncement', () => {
  it('la ruleta girando avisa a quién le toca', () => {
    expect(phaseAnnouncement(base)).toContain('Le toca a Cami');
    expect(phaseAnnouncement({ ...base, isPicker: true })).toContain('Te toca detener');
  });

  it('la letra revelada la dice en voz alta', () => {
    expect(phaseAnnouncement({ ...base, letter: 'F' })).toContain('letra F');
  });

  it('la escritura distingue a quien juega de quien mira', () => {
    const writing = { ...base, phase: 'WRITING', letter: 'F' } as const;
    expect(phaseAnnouncement(writing)).toContain('empiece con F');
    expect(phaseAnnouncement({ ...writing, playing: false })).toContain('solo miras');
  });

  it('la revisión dice la categoría y su posición', () => {
    expect(
      phaseAnnouncement({
        ...base,
        phase: 'REVIEW',
        reviewLabel: 'Cantante',
        reviewIndex: 6,
      }),
    ).toBe('Revisión: Cantante, 7 de 7.');
  });

  it('el fin de ronda dice qué ronda terminó', () => {
    expect(phaseAnnouncement({ ...base, phase: 'ROUND_END' })).toBe('Fin de la ronda 2.');
  });

  it('el resto de las fases no anuncia nada', () => {
    expect(phaseAnnouncement({ ...base, phase: 'LOBBY' })).toBe('');
  });
});
