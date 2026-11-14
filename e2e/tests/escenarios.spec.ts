// Escenarios sueltos, cada uno con su propia sala. Letras fijas del servidor de pruebas: la ronda 1
// es F y la 2 es M. A quien llegó primero (anfitrión) le toca detener la ruleta de la ronda 1, y al
// segundo la de la ronda 2.

import {
  expect,
  expectRoundEnd,
  expectSheets,
  openInvite,
  openLobby,
  passReview,
  runLetter,
  setRounds,
  startGame,
  test,
  type Answers,
  type Player,
} from '../support/game';
import { FAST_ORIGIN } from '../support/env';

/** Hoja completa de la ronda 1 (F), toda distinta de lo que escriba otro jugador. */
const FULL_F: Answers = {
  nombre: 'Felipe',
  lugar: 'Francia',
  cosa: 'Fuente',
  fruta: 'Frutilla',
  animal: 'Foca',
  tv: 'Friends',
  cantante: 'Fito Páez',
};

/** Hoja completa de la ronda 2 (M). */
const FULL_M: Answers = {
  nombre: 'Marcela',
  lugar: 'Madrid',
  cosa: 'Mesa',
  fruta: 'Mango',
  animal: 'Mono',
  tv: 'Merlina',
  cantante: 'Madonna',
};

test.describe('el reloj manda (servidor de tiempos cortos)', () => {
  test.use({ baseURL: FAST_ORIGIN });

  test('la escritura termina por tiempo y la revisión avanza sola, sin STOP ni "Listo"', async ({
    newPlayer,
  }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto', { phone: true });
    const all = [ana, beto];
    await openLobby(all);
    await startGame(ana);
    await runLetter(all, ana, 'F', 1, 5);
    await expectSheets(all, 'F');

    // Lo que alcanzan a escribir antes de que se acabe el tiempo se conserva.
    await ana.fillSheet({ nombre: 'Felipe' });
    await beto.fillSheet({ nombre: 'felipe', lugar: 'Finlandia' });

    // Nadie grita STOP: se acaba el tiempo y las hojas se bloquean.
    // (El aviso dura pocos segundos: se mira en los dos a la vez.)
    await Promise.all(
      all.map(async (p) => {
        const overlay = p.page.getByTestId('stop-overlay');
        await expect(overlay).toContainText('¡Se acabó el tiempo!');
        await expect(p.field('nombre')).toBeDisabled();
      }),
    );

    // Solo dos categorías tienen respuestas: el motor se salta las vacías y revisa 2.
    // Revisión categoría 1: lo escrito llegó completo.
    for (const p of all) await p.expectReviewCategory(0, 2);
    for (const p of all) {
      await expect(p.reviewCard('Felipe')).toHaveAttribute('data-points', '50');
    }

    // Nadie marca "Listo": pasa sola a la categoría 2, y "Listo" arranca sin marcar.
    for (const p of all) await p.expectReviewCategory(1, 2);
    for (const p of all) {
      await expect(p.page.getByTestId('ready-button')).toHaveAttribute('aria-pressed', 'false');
      await expect(p.reviewCard('Finlandia')).toHaveAttribute('data-points', '200');
    }

    // Y tras la última categoría sigue el fin de ronda, también solo, sin autor de STOP.
    await expectRoundEnd(all, 'F', null, {
      Ana: { gain: 50, total: 50 },
      Beto: { gain: 250, total: 250 },
    });
  });
});

test.describe('reconexión', () => {
  test('recargar a mitad de escritura recupera la hoja y el puntaje', async ({ newPlayer }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto');
    const all = [ana, beto];
    await openLobby(all);
    await setRounds(ana, all, 2);

    // Ronda 1: Ana completa la hoja y Beto solo el nombre (igual al de Ana). Ana 1250, Beto 50.
    await startGame(ana);
    await runLetter(all, ana, 'F', 1, 2);
    await expectSheets(all, 'F');
    await ana.fillSheet(FULL_F);
    await beto.fillSheet({ nombre: 'Felipe' });
    await beto.expectProgress('Ana', 7);
    await ana.press(ana.stopButton);
    await passReview(all);
    await expectRoundEnd(all, 'F', 'Ana', {
      Ana: { gain: 1250, total: 1250 },
      Beto: { gain: 50, total: 50 },
    });

    // Ronda 2: Ana completa su hoja; Beto escribe tres categorías (distintas de las de Ana) y recarga.
    await runLetter(all, beto, 'M', 2, 2);
    await expectSheets(all, 'M');
    await ana.fillSheet(FULL_M);
    await beto.fillSheet({ nombre: 'Mariano', lugar: 'Mexico', cosa: 'Marron' });
    await ana.expectProgress('Beto', 3);
    await beto.page.reload();

    // Vuelve a la misma sala, en la misma ronda, con la hoja tal como la dejó.
    await beto.expectPhase('WRITING');
    await expect(beto.field('nombre')).toHaveValue('Mariano');
    await expect(beto.field('lugar')).toHaveValue('Mexico');
    await expect(beto.field('cosa')).toHaveValue('Marron');
    await expect(beto.field('fruta')).toHaveValue('');
    await expect(beto.header.getByTestId('letter-sticker')).toContainText('M');
    await expect(beto.header).toContainText('3 de 7 categorías');
    await expect(beto.page.getByTestId('round-chip')).toContainText('2/2');
    await expect(beto.field('nombre')).toBeEnabled();
    await expect(ana.playerRow('Beto', 'WRITING')).not.toContainText('sin conexión');
    // Al volver recibe solo lo suyo: nada de la hoja de Ana.
    for (const word of Object.values(FULL_M))
      expect(beto.receivedText()).not.toContain(word.toLowerCase());

    // La ronda sigue: Ana grita STOP y el puntaje de la ronda 1 sobrevivió a la recarga.
    await ana.press(ana.stopButton);
    for (const p of all) await p.expectPhase('REVIEW');
    for (const p of all) {
      await p.expectScore('Ana', 1250);
      await p.expectScore('Beto', 50);
    }
    // El nombre de Beto (Mariano) sobrevivió a la recarga: Marcela ya no es la única, vale 100.
    await expect(beto.reviewCard('Marcela')).toHaveAttribute('data-points', '100');
  });

  // Regresión: tras recargar, el cliente reenviaba "" por cada categoría y borraba la hoja del servidor.
  test('recargar a mitad de escritura no pierde lo ya enviado al servidor', async ({
    newPlayer,
  }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto');
    const all = [ana, beto];
    await openLobby(all);
    await startGame(ana);
    await runLetter(all, ana, 'F', 1, 5);
    await expectSheets(all, 'F');
    await ana.fillSheet(FULL_F);
    await beto.fillSheet({ nombre: 'Fabricio', lugar: 'Filipinas', cosa: 'Fogatero' });
    await ana.expectProgress('Beto', 3);
    await beto.page.reload();
    await expect(beto.field('cosa')).toHaveValue('Fogatero');

    await ana.press(ana.stopButton);
    for (const p of all) await p.expectPhase('REVIEW');
    // Lo escrito antes de recargar llega a la revisión.
    await expect(ana.reviewCard('Fabricio')).toBeVisible();
    await expect(ana.page.getByTestId('review-missing')).toHaveCount(0);
  });
});

test.describe('entrar a mitad de ronda', () => {
  test('un cuarto jugador mira la ronda en curso y juega la siguiente', async ({ newPlayer }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto');
    const cami = await newPlayer('Cami');
    const dani = await newPlayer('Dani', { phone: true });
    const players = [ana, beto, cami];
    const code = await openLobby(players);
    await setRounds(ana, players, 2);
    await startGame(ana);
    await runLetter(players, ana, 'F', 1, 2);
    await expectSheets(players, 'F');

    // Dani entra por el enlace con la ronda ya en marcha: mira, no escribe.
    await openInvite(dani, code);
    await dani.expectPhase('WRITING');
    await expect(dani.page.getByTestId('waiting-panel')).toContainText(
      'Entras en la próxima ronda',
    );
    await expect(dani.page.getByTestId('waiting-progress')).toHaveText('0 de 3 hojas completas');
    await expect(dani.page.getByTestId('writing-sheet')).toHaveCount(0);
    await expect(dani.stopButton).toHaveCount(0);
    // Los demás lo ven en la lista, mirando.
    await expect(ana.playerRow('Dani', 'WRITING')).toContainText('mira');

    // Él ve el avance de los demás.
    await ana.fillSheet(FULL_F);
    await expect(dani.page.getByTestId('waiting-progress')).toHaveText('1 de 3 hojas completas');
    await ana.press(ana.stopButton);

    // En la revisión mira: ni "Listo" ni votos, y su "Listo" no cuenta para avanzar.
    await dani.expectPhase('REVIEW');
    await dani.expectReviewCategory(0);
    await expect(dani.page.getByTestId('ready-hint')).toContainText('Esta ronda solo miras');
    await expect(dani.page.getByTestId('ready-button')).toHaveCount(0);
    await expect(dani.reviewCard('Felipe').getByTestId('vote-blocked')).toHaveText(
      'Solo miras esta ronda',
    );
    await passReview(players);

    // Fin de ronda: no jugó, así que suma 0 y se marca que miraba.
    await expectRoundEnd([...players, dani], 'F', 'Ana', {
      Ana: { gain: 1400, total: 1400 },
      Beto: { gain: 0, total: 0 },
      Cami: { gain: 0, total: 0 },
      Dani: { gain: 0, total: 0 },
    });
    await expect(ana.page.getByTestId('round-row').filter({ hasText: 'Dani' })).toContainText(
      '(miraba)',
    );

    // Ronda 2: Dani ya es participante, con su propia hoja.
    const all = [...players, dani];
    await runLetter(all, beto, 'M', 2, 2);
    await expectSheets(all, 'M');
    await expect(dani.page.getByTestId('waiting-panel')).toHaveCount(0);
    await dani.fillSheet(FULL_M);
    await ana.expectProgress('Dani', 7);
    await expect(dani.stopButton).toBeEnabled();
    await dani.press(dani.stopButton);

    for (const p of all) await p.expectReviewCategory(0);
    await expect(dani.reviewCard('Marcela')).toHaveAttribute('data-points', '200');
    await expect(ana.reviewCard('Marcela')).toHaveAttribute('data-points', '200');
    await expect(dani.page.getByTestId('ready-button')).toBeVisible();
    await expect(dani.page.getByTestId('review-missing')).toHaveText(
      'Sin respuesta: Ana, Beto, Cami',
    );
  });
});

test.describe('privacidad', () => {
  test('las respuestas ajenas no llegan al DOM ni a los sockets durante la escritura', async ({
    newPlayer,
  }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto');
    const cami = await newPlayer('Cami', { phone: true });
    const all = [ana, beto, cami];
    await openLobby(all);
    await startGame(ana);
    await runLetter(all, ana, 'F', 1, 5);
    await expectSheets(all, 'F');

    // Palabras que no están en ninguna otra parte de la interfaz ni del tráfico.
    const anaWords: Answers = {
      nombre: 'Fulgencio',
      lugar: 'Fresnillo',
      cosa: 'Fanfarria',
      fruta: 'Frambuesilla',
      animal: 'Faisancito',
      tv: 'Fringelandia',
      cantante: 'Falcosinatra',
    };
    const betoWords: Answers = {
      nombre: 'Fabricio',
      lugar: 'Filipinas',
      cosa: 'Fogatero',
    };
    await ana.fillSheet(anaWords);
    await beto.fillSheet(betoWords);

    // Cami (y los otros) ven el avance, que es lo único que viaja: así sabemos que el servidor ya
    // difundió las respuestas y que los frames se están capturando.
    await cami.expectProgress('Ana', 7);
    await cami.expectProgress('Beto', 3);
    await ana.expectProgress('Beto', 3);
    await beto.expectProgress('Ana', 7);
    for (const p of all) expect(p.receivedText()).toContain('round:progress');

    const secrets = (words: Answers) => Object.values(words).map((w) => w.toLowerCase());
    const leaks = async (viewer: Player, words: Answers) => {
      const dom = (await viewer.page.content()).toLowerCase();
      const text = ((await viewer.page.locator('body').textContent()) ?? '').toLowerCase();
      return secrets(words).filter(
        (w) => dom.includes(w) || text.includes(w) || viewer.receivedText().includes(w),
      );
    };
    expect(await leaks(cami, anaWords)).toEqual([]);
    expect(await leaks(cami, betoWords)).toEqual([]);
    expect(await leaks(beto, anaWords)).toEqual([]);
    expect(await leaks(ana, betoWords)).toEqual([]);
    // Cada uno sí tiene lo suyo (control: la hoja guarda lo escrito).
    await expect(ana.field('nombre')).toHaveValue('Fulgencio');
    await expect(beto.field('nombre')).toHaveValue('Fabricio');
    // Control positivo: al pasar a la revisión las respuestas sí se muestran y viajan a todos.
    await ana.press(ana.stopButton);
    for (const p of all) await p.expectPhase('REVIEW');
    await expect(cami.reviewCard('Fulgencio')).toBeVisible();
    await expect(cami.reviewCard('Fabricio')).toBeVisible();
    expect(cami.receivedText()).toContain('fulgencio');
    expect(cami.receivedText()).toContain('fabricio');
  });
});

test.describe('botón STOP', () => {
  test('sigue deshabilitado con la hoja incompleta o con una respuesta de otra letra', async ({
    newPlayer,
  }) => {
    const ana = await newPlayer('Ana');
    const beto = await newPlayer('Beto', { phone: true });
    const all = [ana, beto];
    await openLobby(all);
    await startGame(ana);
    await runLetter(all, ana, 'F', 1, 5);
    await expectSheets(all, 'F');

    for (const p of all) {
      await expect(p.stopButton).toBeDisabled();

      // Seis de siete: falta una.
      await p.fillSheet({
        nombre: 'Felipe',
        lugar: 'Francia',
        cosa: 'Fuente',
        fruta: 'Frutilla',
        animal: 'Foca',
        tv: 'Friends',
      });
      await expect(p.stopButton).toBeDisabled();
      await expect(p.stopHint).toHaveText('Falta 1 categoría');

      // Completa, pero la última empieza con otra letra: se marca el campo y sigue bloqueado.
      await p.fillSheet({ cantante: 'Madonna' });
      await expect(p.field('cantante')).toHaveAttribute('data-state', 'wrong');
      await expect(p.field('cantante')).toHaveAttribute('aria-invalid', 'true');
      await expect(p.stopButton).toBeDisabled();
      await expect(p.stopHint).toHaveText('1 no empieza con F');

      // Una de otra letra en medio de una hoja casi vacía también cuenta.
      await p.fillSheet({ nombre: 'Gonzalo' });
      await expect(p.stopHint).toHaveText('2 no empiezan con F');
      await expect(p.stopButton).toBeDisabled();

      // Corregidas las dos, se habilita.
      await p.fillSheet({ nombre: 'Felipe', cantante: 'Fito Páez' });
      await expect(p.field('cantante')).toHaveAttribute('data-state', 'ok');
      await expect(p.stopButton).toBeEnabled();
      await expect(p.stopHint).toContainText('Hoja completa');

      // Y si vacía una, vuelve a bloquearse.
      await p.fillSheet({ lugar: '' });
      await expect(p.stopButton).toBeDisabled();
      await expect(p.stopHint).toHaveText('Falta 1 categoría');

      // Ni con la hoja a medias ni bloqueado el botón la ronda se cierra por error.
      await p.expectPhase('WRITING');
    }
  });
});
