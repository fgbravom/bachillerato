// Punto de entrada del servidor: lee variables de entorno y levanta `createGameServer`.
//
// Variables de entorno
//   PORT           puerto de escucha (por defecto 3002; el 3001 es de Dibuja y Adivina)
//   HOST           interfaz de escucha (por defecto todas)
//   WEB_DIR        carpeta del cliente compilado (por defecto apps/web/dist, si existe)
//   BACH_MAX_ROOMS tope de salas simultáneas (por defecto 500)
//   CLIENT_IP_HEADER  cabecera con la IP real del cliente detrás de un proxy (p. ej. x-real-ip);
//                  sin ella no se confía en ninguna cabecera y se usa la IP de la conexión
//   ALLOWED_ORIGINS  orígenes permitidos además del propio host, separados por coma (solo con
//                  NODE_ENV=production, que rechaza los Origin que no coinciden con el Host)
//
// Modo de pruebas: solo se leen estas si BACH_TEST=1 (pruebas e2e deterministas)
//   BACH_LETTER_SPIN_MS    máximo que gira la ruleta antes de detenerse sola, en ms
//   BACH_LETTER_REVEAL_MS  letra en grande antes de empezar a escribir, en ms
//   BACH_WRITE_MS          duración de la escritura, en ms (reemplaza el ajuste de segundos de la sala)
//   BACH_STOP_GRACE_MS     gracia tras el STOP o el fin del tiempo, en ms
//   BACH_REVIEW_MS         plazo de cada categoría en revisión, en ms
//   BACH_ROUND_END_MS      pausa de fin de ronda, en ms
//   BACH_GRACE_MS          gracia de reconexión, en ms
//   BACH_LETTERS           letras fijas separadas por coma, p. ej. "A,B,C" (la ronda n usa la n-ésima,
//                          y vuelve a empezar al agotarlas); cada una debe ser una letra de LETTERS
//   BACH_MAX_CONNECTIONS_PER_IP    tope de conexiones simultáneas por IP (las pruebas usan 127.0.0.1)
//   BACH_MAX_ROOMS_PER_IP_PER_MINUTE  tope de salas creadas por IP cada minuto

import { LETTERS } from '@bach/shared';
import { createGameServer } from './net/index.js';
import type { GameServerOptions } from './net/index.js';
import type { EngineConfig } from './game/index.js';
import { installGlobalErrorHandlers } from './process-errors.js';

installGlobalErrorHandlers();

function intEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo, recibí "${raw}"`);
  }
  return value;
}

function lettersEnv(name: string): string[] | undefined {
  const letters = process.env[name]
    ?.split(',')
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l !== '');
  if (!letters || letters.length === 0) return undefined;
  for (const letter of letters) {
    if (letter.length !== 1 || !LETTERS.includes(letter)) {
      throw new Error(`${name}: "${letter}" no es una letra válida (${LETTERS})`);
    }
  }
  return letters;
}

function readEngineConfig(): Partial<EngineConfig> {
  const engine: Partial<EngineConfig> = {};
  const letterSpinMs = intEnv('BACH_LETTER_SPIN_MS');
  const letterRevealMs = intEnv('BACH_LETTER_REVEAL_MS');
  const writeMs = intEnv('BACH_WRITE_MS');
  const stopGraceMs = intEnv('BACH_STOP_GRACE_MS');
  const reviewMs = intEnv('BACH_REVIEW_MS');
  const roundEndMs = intEnv('BACH_ROUND_END_MS');
  const graceMs = intEnv('BACH_GRACE_MS');
  const letters = lettersEnv('BACH_LETTERS');
  if (letterSpinMs !== undefined) engine.letterSpinMs = letterSpinMs;
  if (letterRevealMs !== undefined) engine.letterRevealMs = letterRevealMs;
  if (writeMs !== undefined) engine.writeMsOverride = writeMs;
  if (stopGraceMs !== undefined) engine.stopGraceMs = stopGraceMs;
  if (reviewMs !== undefined) engine.reviewMs = reviewMs;
  if (roundEndMs !== undefined) engine.roundEndMs = roundEndMs;
  if (graceMs !== undefined) engine.graceMs = graceMs;
  if (letters !== undefined) engine.lettersOverride = letters;
  return engine;
}

function readOptions(): GameServerOptions {
  const options: GameServerOptions = { port: intEnv('PORT') ?? 3002 };
  if (process.env.HOST) options.host = process.env.HOST;
  if (process.env.WEB_DIR) options.webDir = process.env.WEB_DIR;
  const maxRooms = intEnv('BACH_MAX_ROOMS');
  if (maxRooms !== undefined) options.maxRooms = maxRooms;
  if (process.env.CLIENT_IP_HEADER) options.clientIpHeader = process.env.CLIENT_IP_HEADER;
  options.checkOrigin = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  if (allowedOrigins && allowedOrigins.length > 0) options.allowedOrigins = allowedOrigins;

  if (process.env.BACH_TEST === '1') {
    options.engine = readEngineConfig();
    const maxConnections = intEnv('BACH_MAX_CONNECTIONS_PER_IP');
    const maxRoomsPerMinute = intEnv('BACH_MAX_ROOMS_PER_IP_PER_MINUTE');
    if (maxConnections !== undefined) options.maxConnectionsPerIp = maxConnections;
    if (maxRoomsPerMinute !== undefined) options.maxRoomsPerIpPerMinute = maxRoomsPerMinute;
  }
  return options;
}

async function main(): Promise<void> {
  const server = await createGameServer(readOptions());
  console.log(`[server] escuchando en ${server.url}`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  console.error('[server] no se pudo iniciar', err);
  process.exit(1);
});
