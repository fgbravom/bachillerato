import { SpeakerIcon, SpeakerOffIcon } from './icons';

type SoundToggleProps = {
  muted: boolean;
  onToggle: () => void;
  className?: string;
};

/**
 * Botón de silenciar: solo ícono, 44 px de objetivo táctil. La etiqueta es fija y el estado va en
 * `aria-pressed` (pulsado = sonido silenciado). El estado vive fuera de `ui` (carpeta `sound`).
 */
export function SoundToggle({ muted, onToggle, className = '' }: SoundToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Silenciar sonido"
      aria-pressed={muted}
      className={`inline-flex size-11 shrink-0 select-none items-center justify-center rounded-xl border-2 border-ink ${
        muted ? 'bg-paper-deep text-ink-soft' : 'bg-card text-ink'
      } ${className}`}
    >
      {muted ? <SpeakerOffIcon /> : <SpeakerIcon />}
    </button>
  );
}
