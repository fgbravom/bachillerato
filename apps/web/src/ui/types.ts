// Tipos propios de la capa de pantallas.

/** Tono de un aviso de sistema en la lista de mensajes. */
export type SystemTone = 'info' | 'join' | 'leave';

/**
 * Ítem de la lista unificada de mensajes. Quien conecte el store arma estos ítems a partir de
 * los eventos (ver `lib/feed.ts`); `id` debe ser único y estable (es la `key` de React).
 */
export type FeedItem =
  | {
      id: string;
      kind: 'message';
      playerId: string;
      /** Apodo ya resuelto del jugador que escribió. */
      name: string;
      text: string;
      isSelf: boolean;
    }
  | {
      id: string;
      kind: 'system';
      tone: SystemTone;
      text: string;
    };

/**
 * Control de sonido que inyecta quien conecta las pantallas (la capa `ui` no conoce `src/sound`).
 * Si no se pasa, las pantallas no muestran el botón de silenciar.
 */
export type SoundControl = {
  muted: boolean;
  onToggle: () => void;
};
