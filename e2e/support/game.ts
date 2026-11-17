// Ayudas para las pruebas: jugadores (un contexto de navegador cada uno) y los pasos comunes de la
// interfaz. Sin esperas fijas: todo se espera con condiciones.

import {
  devices,
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export type CategoryId = 'nombre' | 'lugar' | 'cosa' | 'fruta' | 'animal' | 'tv' | 'cantante';
export type Answers = Partial<Record<CategoryId, string>>;
export type Phase = 'LETTER' | 'WRITING' | 'REVIEW' | 'ROUND_END';

/** Categorías de la hoja, en orden (etiqueta tal como se ve). */
export const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string }> = [
  { id: 'nombre', label: 'Nombre o apellido' },
  { id: 'lugar', label: 'Ciudad o país' },
  { id: 'cosa', label: 'Color o cosa' },
  { id: 'fruta', label: 'Fruta o verdura' },
  { id: 'animal', label: 'Animal o ave' },
  { id: 'tv', label: 'Serie, programa de TV o personaje' },
  { id: 'cantante', label: 'Cantante o grupo musical' },
];
export const TOTAL = CATEGORIES.length;

export class Player {
  /** Todo lo que el servidor le envió a este navegador (sockets y sondeo), para buscar fugas. */
  readonly received: string[] = [];
  /** Excepciones sin atrapar de la página: cualquiera hace fallar la prueba. */
  readonly pageErrors: string[] = [];

  constructor(
    readonly name: string,
    readonly page: Page,
    readonly context: BrowserContext,
    readonly isPhone: boolean,
  ) {
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => this.received.push(String(frame.payload)));
    });
    page.on('response', (response) => {
      if (!response.url().includes('/socket.io/')) return;
      response
        .text()
        .then((body) => this.received.push(body))
        .catch(() => undefined);
    });
    page.on('pageerror', (error) => this.pageErrors.push(error.message));
  }

  // --- Lectura de la pantalla -------------------------------------------------

  get gameScreen(): Locator {
    return this.page.getByTestId('game-screen');
  }

  get header(): Locator {
    return this.page.getByTestId('game-header');
  }

  get composerInput(): Locator {
    return this.page.getByTestId('composer').getByRole('textbox');
  }

  get feed(): Locator {
    return this.page.getByTestId('message-feed');
  }

  get stopButton(): Locator {
    return this.page.getByTestId('stop-button');
  }

  get stopHint(): Locator {
    return this.page.getByTestId('stop-hint');
  }

  /** Campo de una categoría de la hoja (tabla en escritorio, apilado en teléfono). */
  field(id: CategoryId): Locator {
    const label = CATEGORIES.find((c) => c.id === id)!.label;
    return this.page.getByRole('textbox', { name: label, exact: true });
  }

  /** Lista de jugadores visible en la fase: fichas en escritura (todos) y en revisión (teléfono). */
  private playerList(phase: Phase): Locator {
    const column = !this.isPhone && (phase === 'REVIEW' || phase === 'ROUND_END');
    return this.page.getByTestId(column ? 'player-column' : 'player-chips');
  }

  playerRow(name: string, phase: Phase): Locator {
    return this.playerList(phase).getByRole('listitem').filter({ hasText: name });
  }

  async expectPhase(phase: Phase): Promise<void> {
    await expect(this.gameScreen).toHaveAttribute('data-phase', phase);
  }

  /** `viewer` ve a `name` con `n` categorías llenas en la hoja (avance en vivo, en escritura). */
  async expectProgress(name: string, n: number): Promise<void> {
    await expect(this.playerRow(name, 'WRITING')).toContainText(
      new RegExp(`(?<!\\d)${n}/${TOTAL}`),
    );
  }

  async expectScore(name: string, score: number, phase: Phase = 'REVIEW'): Promise<void> {
    await expect(this.playerRow(name, phase)).toContainText(new RegExp(`(?<!\\d)${score}\\s*pts`));
  }

  /** Texto completo de lo que recibió del servidor, en minúsculas. */
  receivedText(): string {
    return this.received.join('\n').toLowerCase();
  }

  // --- Acciones ----------------------------------------------------------------

  /** Toque en el teléfono (táctil), clic en escritorio. */
  async press(target: Locator): Promise<void> {
    if (this.isPhone) await target.tap();
    else await target.click();
  }

  async fillSheet(answers: Answers): Promise<void> {
    for (const [id, text] of Object.entries(answers) as Array<[CategoryId, string]>) {
      await this.field(id).fill(text);
    }
  }

  /** Escribe en el campo único de texto del chat y envía con Enter. */
  async say(text: string): Promise<void> {
    await this.composerInput.fill(text);
    await this.composerInput.press('Enter');
    await expect(this.composerInput).toHaveValue('');
  }

  // --- Revisión ----------------------------------------------------------------

  reviewCard(text: string): Locator {
    return this.page.getByTestId('review-card').filter({
      has: this.page.getByTestId('review-text').getByText(text, { exact: true }),
    });
  }

  /**
   * La categoría `index` (desde 0) está en revisión. El motor se salta las categorías sin
   * respuestas: con todas respondidas son `total` = 7 y la `index` es la de la hoja.
   */
  async expectReviewCategory(index: number, total = TOTAL): Promise<void> {
    await expect(this.header).toContainText(`Categoría ${index + 1} de ${total}`);
    await expect(this.header).toContainText(CATEGORIES[index]!.label);
  }

  /**
   * Marca "Listo". No espera a ver el botón apretado: con el último "Listo" la categoría avanza
   * al tiro y el botón ya es el de la siguiente (quien llama espera el avance).
   */
  async markReady(): Promise<void> {
    await this.press(this.page.getByTestId('ready-button'));
  }
}

export type NewPlayer = (name: string, options?: { phone?: boolean }) => Promise<Player>;

export const test = base.extend<{ newPlayer: NewPlayer }>({
  newPlayer: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const created: Player[] = [];
    const create: NewPlayer = async (name, options = {}) => {
      let context: BrowserContext;
      if (options.phone) {
        // Teléfono: Pixel 7 (tamaño, táctil y agente de usuario).
        const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
        context = await browser.newContext(phone);
      } else {
        context = await browser.newContext();
      }
      contexts.push(context);
      const page = await context.newPage();
      const player = new Player(name, page, context, options.phone ?? false);
      created.push(player);
      return player;
    };
    await use(create);
    await Promise.all(contexts.map((context) => context.close()));
    // Ninguna excepción sin atrapar en la página, en ningún jugador (se revisa al final para no
    // tapar el fallo original de la prueba, que ya se informó).
    for (const player of created)
      expect(player.pageErrors, `errores de ${player.name}`).toEqual([]);
  },
});

export { expect };

// --- Pasos comunes -------------------------------------------------------------

/** Crea una sala desde el inicio y devuelve su código. */
export async function createRoom(host: Player): Promise<string> {
  await host.page.goto('/');
  await host.page.getByLabel('¿Cómo te llamamos?').fill(host.name);
  await host.page.getByRole('button', { name: 'Crear sala nueva' }).click();
  const code = host.page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  const text = (await code.textContent()) ?? '';
  await expect(host.page).toHaveURL(new RegExp(`/sala/${text}$`));
  return text;
}

/** Abre el enlace de la sala y entra con el apodo del jugador (sin esperar a una pantalla en particular). */
export async function openInvite(player: Player, code: string): Promise<void> {
  await player.page.goto(`/sala/${code}`);
  await expect(player.page.getByTestId('invite-banner')).toContainText(code);
  await player.page.getByLabel('¿Cómo te llamamos?').fill(player.name);
  await player.page.getByRole('button', { name: 'Entrar a la sala' }).click();
}

/** Entra a una sala que aún está en la sala de espera. */
export async function joinByLink(player: Player, code: string): Promise<void> {
  await openInvite(player, code);
  await expect(player.page.getByTestId('room-code')).toHaveText(code);
}

/** Crea la sala con el primero y mete al resto por enlace; todos quedan en la sala de espera. */
export async function openLobby(players: Player[]): Promise<string> {
  const [host, ...guests] = players;
  const code = await createRoom(host!);
  for (const guest of guests) await joinByLink(guest, code);
  for (const p of players) {
    for (const other of players) {
      await expect(p.page.getByTestId('lobby-players')).toContainText(other.name);
    }
  }
  return code;
}

/** El anfitrión baja las rondas desde las 5 por defecto hasta `rounds`. */
export async function setRounds(host: Player, all: Player[], rounds: number): Promise<void> {
  const minus = host.page.getByRole('button', { name: 'Menos: Rondas' });
  const label = (n: number) => (n === 1 ? '1 ronda' : `${n} rondas`);
  // Un clic por vez: el valor sale del último estado que mandó el servidor, así que dos clics
  // seguidos antes de ese eco piden lo mismo.
  for (let n = 5; n > rounds; n -= 1) {
    await minus.click();
    await expect(host.page.getByRole('group', { name: 'Rondas' })).toContainText(label(n - 1));
  }
  for (const p of all) {
    await expect(p.page.getByRole('group', { name: 'Rondas' })).toContainText(label(rounds));
  }
}

export async function startGame(host: Player): Promise<void> {
  const start = host.page.getByTestId('start-button');
  await expect(start).toBeEnabled();
  await host.press(start);
}

/**
 * De la ruleta a la hoja: `picker` detiene la ruleta, todos ven la letra y los participantes
 * (`players`) llegan a la hoja de escritura.
 */
export async function runLetter(
  players: Player[],
  picker: Player,
  letter: string,
  round: number,
  totalRounds: number,
): Promise<void> {
  for (const p of players) {
    await p.expectPhase('LETTER');
    await expect(p.page.getByTestId('round-chip')).toContainText(`${round}/${totalRounds}`);
  }
  await expect(picker.page.getByTestId('letter-stop')).toBeVisible();
  for (const p of players.filter((x) => x !== picker)) {
    await expect(p.page.getByTestId('letter-waiting')).toContainText(`Le toca a ${picker.name}`);
    await expect(p.page.getByTestId('letter-stop')).toHaveCount(0);
  }
  await picker.press(picker.page.getByTestId('letter-stop'));
  // La letra revelada dura pocos segundos: se mira en todos a la vez.
  await Promise.all(
    players.map((p) =>
      expect(p.page.getByTestId('letter-call')).toContainText(`¡Con la ${letter}!`),
    ),
  );
}

/** La hoja de escritura de todos los `players` aparece con la letra y la maquetación esperadas. */
export async function expectSheets(players: Player[], letter: string): Promise<void> {
  for (const p of players) {
    await p.expectPhase('WRITING');
    const sheet = p.page.getByTestId('writing-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-layout', p.isPhone ? 'stack' : 'table');
    await expect(p.header.getByTestId('letter-sticker')).toContainText(letter);
  }
}

/** Todos los `players` marcan "Listo" en las categorías desde `from` hasta la última. */
export async function passReview(players: Player[], from = 0): Promise<void> {
  for (let i = from; i < TOTAL; i += 1) {
    for (const p of players) await p.expectReviewCategory(i);
    for (const p of players) await p.markReady();
  }
}

/** Panel de fin de ronda: quién gritó STOP, y los puntos de la ronda y el acumulado de cada uno. */
export async function expectRoundEnd(
  viewers: Player[],
  letter: string,
  stopper: string | null,
  rows: Record<string, { gain: number; total: number }>,
): Promise<void> {
  await Promise.all(
    viewers.map(async (p) => {
      await p.expectPhase('ROUND_END');
      const panel = p.page.getByTestId('round-end');
      if (stopper === null) {
        await expect(p.page.getByTestId('round-end-stopper')).toHaveText(
          `Se acabó el tiempo con la ${letter}`,
        );
      } else {
        const who = stopper === p.name ? 'Gritaste' : `${stopper} gritó`;
        await expect(p.page.getByTestId('round-end-stopper')).toHaveText(
          `${who} ¡STOP! con la ${letter}`,
        );
      }
      for (const [name, { gain, total }] of Object.entries(rows)) {
        const row = panel.getByTestId('round-row').filter({ hasText: name });
        await expect(row.getByTestId('round-gain')).toHaveText(`+${gain}`);
        await expect(row.locator('span').last()).toHaveText(String(total));
      }
    }),
  );
}
