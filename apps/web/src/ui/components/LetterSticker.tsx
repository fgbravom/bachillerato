type LetterStickerProps = {
  letter: string | null;
  /** `md` para la cabecera de la partida; `sm` para espacios muy justos. */
  size?: 'sm' | 'md';
  className?: string;
};

/** La letra de la ronda, pegada como sticker (cabecera de la partida). */
export function LetterSticker({ letter, size = 'md', className = '' }: LetterStickerProps) {
  const dims = size === 'sm' ? 'size-9 text-xl' : 'size-12 text-3xl';
  return (
    <span
      data-testid="letter-sticker"
      role="img"
      aria-label={letter ? `Letra ${letter}` : 'Letra por salir'}
      className={`inline-flex shrink-0 -rotate-3 items-center justify-center rounded-xl border-2 border-ink bg-sol font-black leading-none text-ink shadow-pop-sm ${dims} ${className}`}
    >
      <span aria-hidden="true">{letter ?? '?'}</span>
    </span>
  );
}
