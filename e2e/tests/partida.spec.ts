// Escenario principal: una partida completa de tres jugadores (uno en teléfono), de la sala de
// espera al podio y de vuelta a la sala de espera. Dos rondas, con letra F y M (servidor de pruebas).
//
// Ronda 1 (F), puntaje esperado por categoría (Ana / Beto / Cami):
//   nombre    Felipe, Felipe, Fernanda               50 / 50 / 100
//   lugar     Francia, Finlandia, Francia            50 / 100 / 50
//   cosa      Fuente, Fresa, Fucsia                  100 / 100 / 100 y luego "No vale" a Fuente: 0 / 100 / 100
//   fruta     -, Frutilla, -                         0 / 200 / 0
//   animal    Foca, Flamenco, Gato (otra letra)      100 / 100 / 0
//   tv        Friends, Futurama, Friends             50 / 100 / 50
//   cantante  Fito Páez, fito paez, Freddie Mercury  50 / 50 / 100
//   Total ronda: Ana 300, Beto 700, Cami 400. Grita STOP Beto, el único con la hoja completa.
//
// Ronda 2 (M): Ana completa la hoja y grita STOP; Beto y Cami solo llenan lo primero.
//   nombre Marcela x3 = 50 c/u; lugar Madrid (Ana, Beto) = 50 c/u; 5 categorías solo de Ana = 200.
//   Total ronda: Ana 1100, Beto 100, Cami 50.  Acumulado: Ana 1400, Beto 800, Cami 450.

import {
  expect,
  expectRoundEnd,
  expectSheets,
  openLobby,
  passReview,
  runLetter,
  setRounds,
  startGame,
  test,
  type Answers,
  type Player,
} from '../support/game';

const ROUND_1: Record<'Ana' | 'Beto' | 'Cami', Answers> = {
  Ana: {
    nombre: 'Felipe',
    lugar: 'Francia',
    cosa: 'Fuente',
    animal: 'Foca',
    tv: 'Friends',
    cantante: 'Fito Páez',
  },
  Beto: {
    nombre: 'Felipe',
    lugar: 'Finlandia',
    cosa: 'Fresa',
    fruta: 'Frutilla',
    animal: 'Flamenco',
    tv: 'Futurama',
    cantante: 'fito paez',
  },
  Cami: {
    nombre: 'Fernanda',
    lugar: 'Francia',
    cosa: 'Fucsia',
    animal: 'Gato',
    tv: 'Friends',
    cantante: 'Freddie Mercury',
  },
};

type CardExpectation = {
  text: string | RegExp;
  points: number;
  status?: 'valid' | 'rejected' | 'wrong_letter';
  authors: number;
};

/** Las tarjetas de la categoría en curso, en todos los `viewers`, con sus puntos y estado. */
async function expectCards(viewers: Player[], cards: CardExpectation[]): Promise<void> {
  for (const p of viewers) {
    await expect(p.page.getByTestId('review-card')).toHaveCount(cards.length);
    for (const card of cards) {
      const locator =
        typeof card.text === 'string'
          ? p.reviewCard(card.text)
          : p.page.getByTestId('review-card').filter({
              has: p.page.getByTestId('review-text').filter({ hasText: card.text }),
            });
      await expect(locator).toHaveAttribute('data-points', String(card.points));
      await expect(locator).toHaveAttribute('data-status', card.status ?? 'valid');
      await expect(
        locator.getByRole('list', { name: 'Autores' }).getByRole('listitem'),
      ).toHaveCount(card.authors);
    }
  }
}

test('partida completa de tres jugadores con podio y jugar de nuevo', async ({ newPlayer }) => {
  const ana = await newPlayer('Ana');
  const beto = await newPlayer('Beto', { phone: true });
  const cami = await newPlayer('Cami');
  const all = [ana, beto, cami];

  // --- Sala de espera: B y C entran por el enlace y el anfitrión ajusta dos rondas ---
  const code = await openLobby(all);
  await setRounds(ana, all, 2);
  await expect(beto.page.getByTestId('waiting-for-host')).toContainText('Ana');
  await expect(beto.page.getByRole('button', { name: 'Menos: Rondas' })).toHaveCount(0);

  // --- Ronda 1: le toca a Ana detener la ruleta; sale la F ---
  await startGame(ana);
  await runLetter(all, ana, 'F', 1, 2);
  await expectSheets(all, 'F');
  // La ronda parte con la hoja vacía y STOP deshabilitado.
  for (const p of all) {
    for (const id of ['nombre', 'cantante'] as const) await expect(p.field(id)).toHaveValue('');
    await expect(p.stopButton).toBeDisabled();
    await expect(p.stopHint).toHaveText('Faltan 7 categorías');
  }

  // Todos escriben; las categorías vacías y la respuesta de otra letra quedan tal cual.
  for (const p of all) await p.fillSheet(ROUND_1[p.name as keyof typeof ROUND_1]);

  // Cada uno ve el avance de los demás (solo cuántas, no qué).
  await ana.expectProgress('Beto', 7);
  await ana.expectProgress('Cami', 6);
  await beto.expectProgress('Ana', 6);
  await beto.expectProgress('Cami', 6);
  await cami.expectProgress('Ana', 6);
  await cami.expectProgress('Beto', 7);

  // STOP está deshabilitado con una categoría vacía (Ana) y con una de otra letra (Cami).
  await expect(ana.stopButton).toBeDisabled();
  await expect(ana.stopHint).toHaveText('Falta 1 categoría');
  await expect(cami.stopButton).toBeDisabled();
  await expect(cami.stopHint).toHaveText('Falta 1 categoría · 1 no empieza con F');
  await expect(beto.stopButton).toBeEnabled();
  await expect(beto.stopHint).toContainText('Hoja completa');

  // Beto grita STOP (en el teléfono, con un toque): todos ven el aviso y las hojas se bloquean.
  await beto.press(beto.stopButton);
  await Promise.all(
    all.map(async (p) => {
      const overlay = p.page.getByTestId('stop-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(p === beto ? '¡Lo gritaste tú!' : 'Lo gritó Beto');
      await expect(p.stopButton).toBeDisabled();
      await expect(p.field('nombre')).toBeDisabled();
      await expect(p.field('cantante')).toBeDisabled();
    }),
  );

  // --- Revisión categoría por categoría ---
  for (const p of all) await p.expectPhase('REVIEW');

  // 1. Nombre: Felipe repetido (50 c/u) y Fernanda sola (100). Los autores no pueden votar.
  for (const p of all) await p.expectReviewCategory(0);
  await expectCards(all, [
    { text: 'Felipe', points: 50, authors: 2 },
    { text: 'Fernanda', points: 100, authors: 1 },
  ]);
  await expect(ana.reviewCard('Felipe').getByTestId('vote-blocked')).toHaveText('Es tu respuesta');
  await expect(ana.reviewCard('Felipe').getByTestId('vote-button')).toHaveCount(0);
  await expect(ana.reviewCard('Fernanda').getByTestId('vote-button')).toBeVisible();
  for (const p of all) await p.markReady();

  // 2. Ciudad o país: Francia repetida (Ana y Cami).
  for (const p of all) await p.expectReviewCategory(1);
  await expectCards(all, [
    { text: 'Francia', points: 50, authors: 2 },
    { text: 'Finlandia', points: 100, authors: 1 },
  ]);
  for (const p of all) await p.markReady();

  // 3. Color o cosa: tres respuestas distintas (100 c/u). "No vale" a Fuente necesita la mayoría
  // de los dos votantes posibles: con el voto de Beto aún vale; con el de Cami se rechaza.
  for (const p of all) await p.expectReviewCategory(2);
  await expectCards(all, [
    { text: 'Fuente', points: 100, authors: 1 },
    { text: 'Fresa', points: 100, authors: 1 },
    { text: 'Fucsia', points: 100, authors: 1 },
  ]);
  const vote = (p: Player) => p.reviewCard('Fuente').getByTestId('vote-button');
  await expect(vote(beto)).toHaveAccessibleName('No vale: 0 de 2 votos necesarios');
  await beto.press(vote(beto));
  await expect(vote(beto)).toHaveAttribute('aria-pressed', 'true');
  await expect(vote(cami)).toHaveAccessibleName('No vale: 1 de 2 votos necesarios');
  await expectCards(all, [
    { text: 'Fuente', points: 100, authors: 1 },
    { text: 'Fresa', points: 100, authors: 1 },
    { text: 'Fucsia', points: 100, authors: 1 },
  ]);
  await cami.press(vote(cami));
  // Los puntos cambian en vivo en las tres pantallas: Fuente queda rechazada y sin puntos.
  await expectCards(all, [
    { text: 'Fuente', points: 0, status: 'rejected', authors: 1 },
    { text: 'Fresa', points: 100, authors: 1 },
    { text: 'Fucsia', points: 100, authors: 1 },
  ]);
  for (const p of all)
    await expect(p.reviewCard('Fuente').getByTestId('review-note')).toHaveText('No vale');
  // Desmarcar es posible mientras la categoría sigue en curso, y se vuelve a marcar.
  await cami.press(vote(cami));
  await expectCards(
    [ana],
    [
      { text: 'Fuente', points: 100, authors: 1 },
      { text: 'Fresa', points: 100, authors: 1 },
      { text: 'Fucsia', points: 100, authors: 1 },
    ],
  );
  await cami.press(vote(cami));
  await expectCards(all, [
    { text: 'Fuente', points: 0, status: 'rejected', authors: 1 },
    { text: 'Fresa', points: 100, authors: 1 },
    { text: 'Fucsia', points: 100, authors: 1 },
  ]);
  // El chat sirve para discutir.
  await ana.say('¡Fuente sí es una cosa!');
  for (const p of [beto, cami]) await expect(p.feed).toContainText('¡Fuente sí es una cosa!');
  for (const p of all) await p.markReady();

  // 4. Fruta o verdura: Beto es el único con respuesta, así que saca 200.
  for (const p of all) await p.expectReviewCategory(3);
  await expectCards(all, [{ text: 'Frutilla', points: 200, authors: 1 }]);
  await expect(ana.page.getByTestId('review-missing')).toHaveText('Sin respuesta: Ana, Cami');
  for (const p of all) await p.markReady();

  // 5. Animal o ave: Gato no empieza con F, queda anulado sin votos.
  for (const p of all) await p.expectReviewCategory(4);
  await expectCards(all, [
    { text: 'Foca', points: 100, authors: 1 },
    { text: 'Flamenco', points: 100, authors: 1 },
    { text: 'Gato', points: 0, status: 'wrong_letter', authors: 1 },
  ]);
  await expect(beto.reviewCard('Gato').getByTestId('review-note')).toHaveText('No empieza con F');
  await expect(beto.reviewCard('Gato').getByTestId('vote-button')).toHaveCount(0);
  for (const p of all) await p.markReady();

  // 6. Serie, programa de TV o personaje: Friends repetida.
  for (const p of all) await p.expectReviewCategory(5);
  await expectCards(all, [
    { text: 'Friends', points: 50, authors: 2 },
    { text: 'Futurama', points: 100, authors: 1 },
  ]);
  for (const p of all) await p.markReady();

  // 7. Cantante: "Fito Páez" y "fito paez" son la misma respuesta (sin tildes ni mayúsculas).
  for (const p of all) await p.expectReviewCategory(6);
  await expectCards(all, [
    { text: /^fito p[aá]ez$/i, points: 50, authors: 2 },
    { text: 'Freddie Mercury', points: 100, authors: 1 },
  ]);
  for (const p of all) await p.markReady();

  // --- Fin de ronda 1: los puntos exactos ---
  await expectRoundEnd(all, 'F', 'Beto', {
    Ana: { gain: 300, total: 300 },
    Beto: { gain: 700, total: 700 },
    Cami: { gain: 400, total: 400 },
  });

  // --- Ronda 2: otro jugador detiene la ruleta y sale otra letra ---
  await runLetter(all, beto, 'M', 2, 2);
  await expectSheets(all, 'M');
  for (const p of all) await expect(p.field('nombre')).toHaveValue('');
  await ana.fillSheet({
    nombre: 'Marcela',
    lugar: 'Madrid',
    cosa: 'Mesa',
    fruta: 'Mango',
    animal: 'Mono',
    tv: 'Merlina',
    cantante: 'Madonna',
  });
  await beto.fillSheet({ nombre: 'Marcela', lugar: 'Madrid' });
  await cami.fillSheet({ nombre: 'marcela' });
  await beto.expectProgress('Ana', 7);
  await ana.expectProgress('Beto', 2);
  await ana.expectProgress('Cami', 1);
  await expect(ana.stopButton).toBeEnabled();
  await expect(beto.stopButton).toBeDisabled();
  await ana.press(ana.stopButton);
  for (const p of all) {
    await expect(p.page.getByTestId('stop-overlay')).toContainText(
      p === ana ? '¡Lo gritaste tú!' : 'Lo gritó Ana',
    );
  }

  for (const p of all) await p.expectReviewCategory(0);
  await expectCards(all, [{ text: 'Marcela', points: 50, authors: 3 }]);
  // El puntaje acumulado de la ronda anterior se ve en la lista de jugadores.
  for (const p of all) {
    await p.expectScore('Ana', 300);
    await p.expectScore('Beto', 700);
    await p.expectScore('Cami', 400);
  }
  for (const p of all) await p.markReady();
  for (const p of all) await p.expectReviewCategory(1);
  await expectCards(all, [{ text: 'Madrid', points: 50, authors: 2 }]);
  for (const p of all) await p.markReady();
  for (const p of all) await p.expectReviewCategory(2);
  await expectCards(all, [{ text: 'Mesa', points: 200, authors: 1 }]);
  for (const p of all) await p.markReady();
  await passReview(all, 3);

  await expectRoundEnd(all, 'M', 'Ana', {
    Ana: { gain: 1100, total: 1400 },
    Beto: { gain: 100, total: 800 },
    Cami: { gain: 50, total: 450 },
  });

  // --- Fin de partida: podio con los puntajes sumados ---
  for (const p of all) {
    await expect(p.page.getByRole('heading', { name: '¡Terminó la partida!' })).toBeVisible();
    await expect(p.page.getByTestId('winner-line')).toHaveText('¡Ganó Ana!');
    await expect(p.page.getByTestId('podium-1')).toContainText('Ana');
    await expect(p.page.getByTestId('podium-1')).toContainText('1400 pts');
    await expect(p.page.getByTestId('podium-2')).toContainText('Beto');
    await expect(p.page.getByTestId('podium-2')).toContainText('800 pts');
    await expect(p.page.getByTestId('podium-3')).toContainText('Cami');
    await expect(p.page.getByTestId('podium-3')).toContainText('450 pts');
  }
  await expect(ana.page.getByText('Quedaste en el lugar 1 con 1400 puntos.')).toBeVisible();
  await expect(beto.page.getByText('Quedaste en el lugar 2 con 800 puntos.')).toBeVisible();
  await expect(cami.page.getByText('Quedaste en el lugar 3 con 450 puntos.')).toBeVisible();
  for (const p of [beto, cami]) {
    await expect(p.page.getByTestId('waiting-for-host')).toContainText('Ana');
    await expect(p.page.getByTestId('play-again')).toHaveCount(0);
  }

  // --- Jugar de nuevo: todos vuelven a la sala de espera de la misma sala ---
  await ana.page.getByTestId('play-again').click();
  for (const p of all) {
    await expect(p.page.getByTestId('room-code')).toHaveText(code);
    for (const other of all) {
      await expect(p.page.getByTestId('lobby-players')).toContainText(other.name);
    }
  }
  await expect(ana.page.getByTestId('start-button')).toBeEnabled();
  await expect(beto.page.getByTestId('waiting-for-host')).toBeVisible();
});
