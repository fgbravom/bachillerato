import { NotebookIcon } from './icons';

/** Marca del juego: una hoja de cuaderno pegada como sticker y el nombre "Bachillerato". */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${className}`}>
      <span
        aria-hidden="true"
        className="relative inline-flex size-14 -rotate-6 items-center justify-center rounded-2xl border-2 border-ink bg-sol shadow-pop"
      >
        <NotebookIcon width="1.8rem" height="1.8rem" />
        <span className="absolute -right-2.5 -bottom-2.5 inline-flex size-7 rotate-12 items-center justify-center rounded-lg border-2 border-ink bg-copihue text-sm font-black text-white shadow-pop-sm">
          B
        </span>
      </span>
      <h1 className="text-4xl font-black leading-none tracking-tight sm:text-5xl">
        Bachi<span className="text-copihue">llerato</span>
      </h1>
      <p className="text-base font-bold text-ink-soft">Una palabra por categoría. ¡Y STOP!</p>
    </div>
  );
}
