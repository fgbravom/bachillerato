import { useId } from 'react';
import { stopHint, type SheetProgress } from '../lib/sheet';

type StopBarProps = {
  progress: SheetProgress;
  letter: string;
  totalCategories: number;
  /** Hoja cerrada o sin conexión: el botón no se puede apretar. */
  disabled: boolean;
  /** Teclado abierto: ya no hace falta dejar sitio para la barra de inicio de iOS. */
  keyboardOpen: boolean;
  /** Poco alto (apaisado o teclado): el botón y el aviso se achican. */
  compact: boolean;
  onStop: () => void;
};

/**
 * Barra fija al pie de la hoja con el botón ¡STOP! gigante. Solo se habilita con las categorías
 * completas y todas con la letra. Vive dentro del contenedor del tamaño del `visualViewport`,
 * así el teclado no la tapa.
 */
export function StopBar({
  progress,
  letter,
  totalCategories,
  disabled,
  keyboardOpen,
  compact,
  onStop,
}: StopBarProps) {
  const hintId = useId();
  const ready = progress.complete && !disabled;
  return (
    <div
      data-testid="stop-bar"
      className={`shrink-0 border-t-2 border-ink bg-paper-deep px-3 pt-2 ${
        keyboardOpen ? 'pb-2' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 text-sm font-extrabold">
          <span
            id={hintId}
            aria-live="polite"
            data-testid="stop-hint"
            className={progress.wrong > 0 ? 'text-copihue-dark' : 'text-ink'}
          >
            {stopHint(progress, letter)}
          </span>
          <span className="shrink-0 tabular-nums" aria-hidden="true">
            {progress.filled}/{totalCategories}
          </span>
        </div>
        <button
          type="button"
          onClick={onStop}
          disabled={!ready}
          aria-describedby={hintId}
          data-testid="stop-button"
          className={`inline-flex w-full select-none items-center justify-center rounded-2xl border-2 font-black tracking-wide transition-[transform,box-shadow,background-color] disabled:border-ink-soft disabled:bg-paper disabled:text-ink-soft disabled:shadow-none ${
            compact ? 'min-h-12 text-2xl' : 'min-h-16 text-4xl'
          } ${
            ready
              ? 'animate-beat border-ink bg-copihue text-white shadow-pop hover:bg-copihue-dark active:translate-x-[3px] active:translate-y-[3px] active:shadow-none'
              : ''
          }`}
        >
          ¡STOP!
        </button>
      </div>
    </div>
  );
}
