type StopOverlayProps = {
  /** Apodo de quien gritó STOP; `null` si se acabó el tiempo. */
  byName: string | null;
  isSelf: boolean;
};

/**
 * Aviso de pantalla completa al cerrarse la hoja (la gracia de 1 s antes de la revisión).
 * Tapa todo y se anuncia a lectores de pantalla.
 */
export function StopOverlay({ byName, isSelf }: StopOverlayProps) {
  const timeUp = byName === null;
  return (
    <div
      role="alert"
      data-testid="stop-overlay"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 overflow-hidden bg-copihue px-4 text-center text-white"
    >
      <p
        data-testid="stop-title"
        className="animate-slam font-black leading-none tracking-tight"
        style={{ fontSize: 'min(24vw, 22vh, 9rem)', textShadow: '5px 5px 0 var(--color-ink)' }}
      >
        ¡STOP!
      </p>
      <p className="animate-rise text-2xl font-extrabold sm:text-3xl">
        {timeUp ? '¡Se acabó el tiempo!' : isSelf ? '¡Lo gritaste tú!' : `Lo gritó ${byName}`}
      </p>
      <p className="animate-rise text-base font-bold text-white/90">Se cierran las hojas…</p>
    </div>
  );
}
