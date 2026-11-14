import { EyeIcon } from './icons';

type WaitingPanelProps = {
  letter: string;
  /** Participantes que ya completaron la hoja y cuántos juegan (para dar contexto). */
  doneCount: number;
  playingCount: number;
};

/** Estado de espera de quien entró a mitad de ronda: no escribe, pero ve el avance de los demás. */
export function WaitingPanel({ letter, doneCount, playingCount }: WaitingPanelProps) {
  return (
    <div
      data-testid="waiting-panel"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-16 rotate-3 items-center justify-center rounded-2xl border-2 border-ink bg-mar-soft shadow-pop"
      >
        <EyeIcon width="2rem" height="2rem" />
      </span>
      <h2 className="text-3xl font-black">Entras en la próxima ronda</h2>
      <p className="max-w-sm text-base font-bold text-ink-soft">
        Esta ronda ya partió con la letra <span className="font-black text-copihue">{letter}</span>.
        Mira cómo van los demás, que enseguida juegas tú.
      </p>
      <p
        data-testid="waiting-progress"
        aria-live="polite"
        className="rounded-xl border-2 border-ink bg-sol-soft px-3 py-1.5 text-sm font-extrabold shadow-pop-sm"
      >
        {doneCount} de {playingCount} {playingCount === 1 ? 'hoja completa' : 'hojas completas'}
      </p>
    </div>
  );
}
