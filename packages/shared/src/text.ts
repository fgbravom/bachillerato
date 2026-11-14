// Normalización de respuestas y verificación de la letra (PLAN.md sección 2).

/**
 * Normaliza una respuesta para compararla: minúsculas, sin tildes ni diéresis, sin puntuación
 * y sin espacios dobles ni en los bordes. La `ñ` se conserva (`ano` no es `año`).
 * Guiones y barras cuentan como separador (`ping-pong` = `ping pong`).
 */
export function normalizeAnswer(input: string): string {
  const stripped = Array.from(input.toLowerCase().normalize('NFC'), (ch) =>
    ch === 'ñ' ? ch : ch.normalize('NFD').replace(/\p{M}/gu, ''),
  ).join('');
  return stripped
    .replace(/[\p{Pd}_/\\]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿La respuesta empieza con la letra de la ronda? Compara la primera letra ya normalizada, así
 * `Árbol` vale para la A y `ñandú` no vale para la N. Una respuesta o letra vacía no vale.
 */
export function startsWithLetter(text: string, letter: string): boolean {
  const first = Array.from(normalizeAnswer(text))[0];
  const target = Array.from(normalizeAnswer(letter))[0];
  return first !== undefined && target !== undefined && first === target;
}
