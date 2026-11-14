import { useLetterRoulette } from '../hooks/useLetterRoulette';

type LetterStageProps = {
  /** Letra del servidor; `null` mientras gira la ruleta. */
  letter: string | null;
  /** Quien mira es a quien le toca detener la ruleta. */
  isPicker: boolean;
  pickerName: string;
  /** Segundos que faltan para empezar a escribir (solo con la letra revelada). */
  secondsToStart: number | null;
  /** Poco alto disponible (teléfono apaisado o teclado abierto). */
  compact?: boolean;
  onStop: () => void;
};

/**
 * Fase LETTER. Las letras del abecedario pasan rápido en grande, como un timbre; a quien le toca
 * aprieta "¡Stop!". Cuando llega la letra del servidor, la ruleta frena y queda en ella con un
 * golpe, y se cuenta 3-2-1 para que todos partan a la vez.
 */
export function LetterStage({
  letter,
  isPicker,
  pickerName,
  secondsToStart,
  compact = false,
  onStop,
}: LetterStageProps) {
  const { shown, landed } = useLetterRoulette(letter);
  const revealed = letter !== null && landed;
  const countdown = secondsToStart !== null && secondsToStart > 0 ? secondsToStart : null;

  return (
    <div
      data-testid="letter-stage"
      data-state={revealed ? 'revealed' : letter !== null ? 'landing' : 'spinning'}
      className={`relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-4 land:flex-row land:gap-8 ${
        compact ? 'py-2' : ''
      }`}
    >
      <div
        aria-hidden="true"
        className={`flex aspect-square w-[min(62vw,40vh,15rem)] shrink-0 select-none items-center justify-center overflow-hidden rounded-3xl border-4 border-ink shadow-[6px_6px_0_0_var(--color-ink)] land:w-[min(40vh,12rem)] desk:w-[min(40vh,18rem)] ${
          revealed ? 'bg-sol' : 'sheet-grid'
        }`}
      >
        <span
          key={`${shown}-${revealed}`}
          data-testid="roulette-letter"
          className={`font-black leading-none text-ink ${revealed ? 'animate-thump' : 'animate-tick'}`}
          style={{ fontSize: 'min(34vw, 30vh, 9.5rem)' }}
        >
          {shown}
        </span>
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        {revealed ? (
          <>
            <p data-testid="letter-call" className="text-3xl font-black sm:text-4xl">
              ¡Con la <span className="text-copihue">{letter}</span>!
            </p>
            {countdown !== null && (
              <p
                key={countdown}
                data-testid="letter-countdown"
                aria-hidden="true"
                className="inline-flex size-16 animate-pop-in items-center justify-center rounded-full border-2 border-ink bg-card text-4xl font-black tabular-nums shadow-pop"
              >
                {countdown}
              </p>
            )}
            <p className="text-sm font-bold text-ink-soft">
              Una palabra por categoría. ¡A escribir!
            </p>
          </>
        ) : letter !== null ? (
          <p className="text-3xl font-black">¡Stop!</p>
        ) : isPicker ? (
          <>
            <button
              type="button"
              onClick={onStop}
              data-testid="letter-stop"
              className="inline-flex min-h-20 w-full animate-beat select-none items-center justify-center rounded-2xl border-2 border-ink bg-copihue text-5xl font-black tracking-wide text-white shadow-pop transition-[transform,box-shadow,background-color] hover:bg-copihue-dark active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
            >
              ¡Stop!
            </button>
            <p className="text-sm font-bold text-ink-soft">
              Te toca: toca el botón para detener la letra.
            </p>
          </>
        ) : (
          <p
            data-testid="letter-waiting"
            className="w-full rounded-xl border-2 border-ink bg-sol-soft p-3 text-lg font-extrabold shadow-pop-sm"
          >
            Le toca a {pickerName} detenerla
          </p>
        )}
      </div>
    </div>
  );
}
