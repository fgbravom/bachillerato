// Levanta el entorno de las pruebas e2e en un solo proceso: compila el cliente (sin Vite en
// ejecución) y arranca dos servidores de producción que lo sirven junto con Socket.IO en un solo
// origen cada uno. Lo invoca `webServer` de playwright.config.ts; Playwright lo detiene al terminar.
//
// - Servidor "normal" (BACH_E2E_PORT): tiempos largos, para escenarios que actúan con calma.
// - Servidor "rápido" (BACH_E2E_PORT + 1): escritura y revisión de pocos segundos, para probar
//   lo que ocurre cuando se acaba el tiempo sin esperar el de verdad.
//
// En ambos las letras son fijas (la ronda n usa la n-ésima, ver `LETTERS`). Variables:
// BACH_E2E_PORT, BACH_E2E_SKIP_BUILD=1 (reutiliza la compilación anterior).

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = path.join(root, 'e2e', 'build', 'web');
const mainPort = Number(process.env.BACH_E2E_PORT ?? 3291);
const fastPort = mainPort + 1;

if (process.env.BACH_E2E_SKIP_BUILD !== '1') {
  // Compila fuera de apps/web/dist para no pisar la salida de otros trabajos en paralelo.
  const viteBin = path.join(root, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawnSync(
    process.execPath,
    [viteBin, 'build', '--outDir', webDir, '--emptyOutDir'],
    { cwd: path.join(root, 'apps', 'web'), stdio: 'inherit' },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

/** Letras de las rondas 1, 2, 3...: F y M primero (las que usan los escenarios). */
const LETTERS = 'F,M,S,C,B';

const common = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  WEB_DIR: webDir,
  BACH_TEST: '1',
  BACH_LETTERS: LETTERS,
  BACH_LETTER_SPIN_MS: '15000',
  // Todas las pruebas conectan desde 127.0.0.1 y crean muchas salas.
  BACH_MAX_CONNECTIONS_PER_IP: '1000',
  BACH_MAX_ROOMS_PER_IP_PER_MINUTE: '10000',
};

const profiles = {
  normal: {
    PORT: String(mainPort),
    // Escritura de sobra: lo normal es cerrarla con STOP.
    BACH_WRITE_MS: '120000',
    BACH_LETTER_REVEAL_MS: '4000',
    // Gracia visible el tiempo suficiente para mirar el aviso de STOP desde tres navegadores.
    BACH_STOP_GRACE_MS: '3000',
    // Revisión: las pruebas avanzan marcando "Listo".
    BACH_REVIEW_MS: '40000',
    BACH_ROUND_END_MS: '12000',
    BACH_GRACE_MS: '30000',
  },
  rapido: {
    PORT: String(fastPort),
    BACH_WRITE_MS: '6000',
    BACH_LETTER_REVEAL_MS: '3000',
    BACH_STOP_GRACE_MS: '2500',
    BACH_REVIEW_MS: '4000',
    BACH_ROUND_END_MS: '5000',
    BACH_GRACE_MS: '30000',
  },
};

const children = [];

function start(profile) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'apps', 'server'),
    stdio: 'inherit',
    env: { ...process.env, ...common, ...profile },
  });
  children.push(child);
  // Si uno cae, cae todo: Playwright lo notará.
  child.on('exit', (code) => {
    shutdown(code ?? 0);
  });
  return child;
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exit(code);
}

/** `true` si el servidor del puerto responde 200 en /health. */
function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health' }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitHealthy(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await healthy(port)) return;
    await sleep(200);
  }
  throw new Error(`el servidor del puerto ${port} no respondió /health`);
}

start(profiles.normal);
await waitHealthy(mainPort);
// Playwright espera a este: cuando responde, los dos ya están arriba.
start(profiles.rapido);

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => shutdown(0));
}
