// Campo de texto del chat (LOBBY, REVIEW, ROUND_END y GAME_END).

export const COMPOSER_TEXT = { placeholder: 'Escribe un mensaje', label: 'Mensaje de chat' };

/** Texto a enviar, o `null` si no hay nada que mandar. */
export function prepareMessage(raw: string, maxLength: number): string | null {
  const text = raw.trim().slice(0, maxLength);
  return text === '' ? null : text;
}
