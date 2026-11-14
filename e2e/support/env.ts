// Puertos del entorno de pruebas: los lee la configuración de Playwright y los escenarios.
// Propios de este paquete: no chocan con el desarrollo (3002, 5174) ni con Dibuja y Adivina.

const MAIN_PORT = Number(process.env.BACH_E2E_PORT ?? 3291);

/** Servidor con tiempos largos (escenarios normales). */
export const MAIN_ORIGIN = `http://127.0.0.1:${MAIN_PORT}`;

/** Servidor con escritura y revisión de pocos segundos (escenarios que esperan al reloj). */
export const FAST_PORT = MAIN_PORT + 1;
export const FAST_ORIGIN = `http://127.0.0.1:${FAST_PORT}`;

export { MAIN_PORT };
