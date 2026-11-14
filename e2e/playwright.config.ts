import { defineConfig, devices } from '@playwright/test';
import { FAST_ORIGIN, MAIN_ORIGIN, MAIN_PORT } from './support/env';

// Dos servidores de producción (ver scripts/serve.mjs), cada uno con el cliente compilado y los
// sockets en un solo origen: uno de tiempos largos y otro con escritura y revisión cortas.
export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: MAIN_ORIGIN,
    locale: 'es-CL',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    // El script levanta primero el normal y después el rápido: cuando este responde, están los dos.
    url: `${FAST_ORIGIN}/health`,
    // Incluye la compilación del cliente.
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { BACH_E2E_PORT: String(MAIN_PORT) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
