# Motor de reglas — especificación (T1)

Especificación de `apps/server/src/game/**`. La usa quien lo conecta a la red (T3). Las reglas del juego están en la sección 2 de `PLAN.md`; este documento fija lo que el plan dejaba abierto y la API exacta. Donde un tipo ya existe en `@bach/shared`, manda `@bach/shared`: el motor no lo redefine.

## 1. Principios

- Motor puro: `reduce(state, action, ctx)` devuelve estado nuevo y una lista ordenada de efectos. Sin `Date`, `Math.random`, `setTimeout` ni Socket.IO.
- Reloj (`ctx.now`), azar (`ctx.rng`) e ids (`ctx.newId`) se inyectan.
- `reduce` parte con `structuredClone(state)` y muta la copia. Los payloads de los efectos son copias: no comparten referencias con el estado.
- El `switch` de acciones es exhaustivo y termina en `never`.
- Las reglas (validez, puntaje, mayoría) viven solo aquí. La red valida forma y límites con Zod; el motor vuelve a verificar rol y fase.
- Las respuestas de un jugador no salen en ningún efecto ni snapshot dirigido a otro mientras dura WRITING.

## 2. Archivos

```
apps/server/src/game/
  index.ts      API pública: createGame, reduce, nextWakeAt, buildSnapshot, DEFAULT_ENGINE_CONFIG y tipos
  types.ts      GameState, RoundState, ReviewProgress, EnginePlayer, Action, Effect, Recipient, EngineContext, EngineConfig
  config.ts     DEFAULT_ENGINE_CONFIG, armado desde las constantes de @bach/shared
  env.ts        Env (estado, ctx, efectos), emit y destinatarios
  reducer.ts    reduce, advance (vencimientos), despacho, ajustes e inicio
  players.ts    join y reconexión, disconnect, removePlayer, transferHost, uniqueName
  rounds.ts     startRound, ruleta, escritura, STOP, endRound, endGame, toLobby
  review.ts     grupos, votos, "Listo", avance de categoría, recálculo por presencia
  messages.ts   chat
  scoring.ts    assignPoints, computeGains, ranking
  snapshot.ts   buildSnapshot, toPlayer
  testing.ts    arnés de pruebas (solo lo importan las pruebas)
  *.test.ts
```

## 3. API pública

```ts
// apps/server/src/game/index.ts
createGame(config?: Partial<EngineConfig>, settings?: Partial<GameSettings>): GameState
reduce(state: GameState, action: Action, ctx: EngineContext): ReduceResult
nextWakeAt(state: GameState): number | null
buildSnapshot(state: GameState, viewerId: PlayerId, now: number): EngineSnapshot
DEFAULT_ENGINE_CONFIG: EngineConfig

// tipos exportados
Action, Effect, EngineConfig, EngineContext, EngineEvent, EnginePlayer, EngineSnapshot,
GameState, PlayerId, ReduceResult, Recipient, ReviewProgress, RoundState
```

```ts
interface EngineConfig {
  minPlayers: number; // MIN_PLAYERS_TO_START
  maxPlayers: number; // MAX_PLAYERS
  letterSpinMs: number; // LETTER_SPIN_SECONDS * 1000
  letterRevealMs: number; // LETTER_REVEAL_SECONDS * 1000
  stopGraceMs: number; // STOP_GRACE_MS
  reviewMs: number; // REVIEW_SECONDS * 1000
  roundEndMs: number; // ROUND_END_SECONDS * 1000
  graceMs: number; // RECONNECT_GRACE_SECONDS * 1000
  writeMsOverride?: number; // solo e2e: reemplaza settings.writeSeconds * 1000
  lettersOverride?: readonly string[]; // solo e2e: la ronda n usa la letra [(n - 1) % largo]
}

interface EngineContext {
  now: number;
  rng: () => number; // [0, 1)
  newId: () => string;
}

type Action =
  | { type: 'join'; sessionId: string; name: string; connId: string } // también reconexión y otra pestaña
  | { type: 'disconnect'; playerId: PlayerId; connId: string }
  | { type: 'leave'; playerId: PlayerId } // borrado inmediato
  | { type: 'updateSettings'; playerId: PlayerId; rounds: number; writeSeconds: number }
  | { type: 'start'; playerId: PlayerId }
  | { type: 'stopLetter'; playerId: PlayerId }
  | { type: 'updateAnswer'; playerId: PlayerId; category: CategoryId; text: string }
  | { type: 'stop'; playerId: PlayerId }
  | { type: 'vote'; playerId: PlayerId; key: string; reject: boolean }
  | { type: 'ready'; playerId: PlayerId; ready: boolean }
  | { type: 'message'; playerId: PlayerId; text: string }
  | { type: 'tick' };

type Recipient =
  | { kind: 'room' }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'roomExcept'; playerId: PlayerId }
  | { kind: 'players'; playerIds: PlayerId[] };

type EngineEvent = // subconjunto de ServerToClientEvents; los system:* son de la red
  | 'player:joined' | 'player:left' | 'player:updated'
  | 'round:letter' | 'round:letter-chosen' | 'round:writing' | 'round:progress' | 'round:stopped'
  | 'review:category' | 'review:update' | 'round:end' | 'game:end' | 'message:new';

type EngineSnapshot = Omit<RoomState, 'code'>; // la red agrega code

type Effect =
  | { type: 'emit'; to: Recipient; event: EngineEvent; payload: /* el del contrato */ }
  | { type: 'snapshot'; playerId: PlayerId; snapshot: EngineSnapshot } // la red envía room:state
  | { type: 'disconnectConn'; connId: string }; // la red cierra el socket viejo

interface ReduceResult {
  state: GameState;
  effects: Effect[]; // en orden causal
  error?: ErrorCode; // con error, el estado solo refleja advance() y solo van los efectos de advance()
  playerId?: PlayerId; // en un join exitoso
}
```

Mapeo de la red al motor (todo lo demás lo decide el motor):

| Evento del cliente          | Acción                                                                 |
| --------------------------- | ---------------------------------------------------------------------- |
| `room:create` / `room:join` | `join` (el ack lleva `result.playerId` o `result.error`)               |
| `room:settings`             | `updateSettings`                                                       |
| `game:start`                | `start`                                                                |
| `letter:stop`               | `stopLetter`                                                           |
| `answers:update`            | `updateAnswer`                                                         |
| `round:stop`                | `stop`                                                                 |
| `review:vote`               | `vote`                                                                 |
| `review:ready`              | `ready`                                                                |
| `message:send`              | `message` (el texto ya viene saneado; vacío tras `trim` no emite nada) |
| cierre de socket / gracia   | `disconnect` / el motor borra solo al vencer `graceMs`                 |

Resolución de destinatarios por la red: `room` = todos los jugadores de la sala, `roomExcept` = todos menos uno, `player` / `players` = esos ids. Un efecto `snapshot` se emite como `room:state` con `{ ...snapshot, code }`.

## 4. Estado

```ts
interface GameState {
  phase: Phase;
  config: EngineConfig;
  settings: GameSettings;
  players: EnginePlayer[]; // orden del arreglo = orden de llegada
  hostId: PlayerId | null;
  round: number; // 0 en LOBBY
  usedLetters: string[]; // letras ya sorteadas en la partida
  pickers: PlayerId[]; // quienes ya detuvieron la ruleta en el ciclo de rotación
  current: RoundState | null; // solo de LETTER a ROUND_END
  deadline: number | null; // fin de la fase o subfase; null en LOBBY y GAME_END
  ranking: RankingEntry[] | null; // solo en GAME_END
}

interface RoundState {
  letter: string | null; // null mientras gira la ruleta
  pickerId: PlayerId;
  playing: PlayerId[]; // participantes, fijos al entrar en LETTER
  sheets: Record<PlayerId, Answers>; // hojas
  stopped: { by: PlayerId | null } | null; // WRITING cerrada (gracia en curso)
  groups: Record<CategoryId, ReviewGroup[]> | null; // se arman al entrar en REVIEW
  review: { order: CategoryId[]; index: number; ready: PlayerId[] } | null;
  end: RoundEnd | null;
}
```

## 5. Plazos

La red mantiene un único temporizador por sala: tras cada `reduce` reprograma un `setTimeout` hasta `nextWakeAt(state)` que despacha `{ type: 'tick' }`.

Vencimientos: `deadline` de la fase y `disconnectedAt + graceMs` de cada jugador caído. Toda acción ejecuta primero `advance`: mientras el vencimiento más temprano sea `<= now`, lo procesa (tope de 50 vueltas; superarlo lanza). En empate, la gracia va antes que el plazo. Los plazos nuevos se calculan desde `ctx.now`. Por eso una acción que llega justo después de un plazo se evalúa contra la fase nueva.

| Vencimiento          | Qué hace                                   |
| -------------------- | ------------------------------------------ |
| Gracia de un jugador | `removePlayer`                             |
| LETTER girando       | `revealLetter` (la ruleta se detiene sola) |
| LETTER revelada      | `beginWriting`                             |
| WRITING sin cerrar   | `closeWriting(null)`: se acabó el tiempo   |
| WRITING cerrada      | `beginReview` (terminó la gracia de 1 s)   |
| REVIEW               | `nextCategory`                             |
| ROUND_END            | `startRound`, o `endGame` si era la última |

## 6. Flujo y eventos

**`start`** (LOBBY, anfitrión, al menos `minPlayers` conectados): puntajes a 0 (`player:updated` de quien cambió), `usedLetters = []`, `pickers = []`, `startRound`.

**`startRound`**: participantes = jugadores conectados en ese instante, en orden de llegada (si no hay ninguno, `endGame`). `round++`. Picker = primer participante que no esté en `pickers`; si todos ya fueron, `pickers` se vacía y parte otra vuelta (rotación por orden de llegada entre los participantes de cada ronda). Fase LETTER, `letter = null`, `deadline = now + letterSpinMs`. Emite `player:updated` a la sala por cada jugador cuyo `playing` cambió (quien se suma a la ronda; quien deja de participar) y luego `round:letter { round, totalRounds, pickerId, endsAt }`.

**Letra** (`revealLetter`, por `stopLetter` del picker o por plazo): el motor elige con `ctx.rng` entre las letras de `LETTERS` aún no usadas (`floor(rng() * disponibles)`), o `lettersOverride[(round - 1) % largo]` si hay override. Emite `round:letter-chosen { letter, endsAt: now + letterRevealMs }` y `deadline` pasa a ese instante. Si el picker se desconecta o se va, la ruleta igual se detiene sola.

**WRITING** (`beginWriting`): `deadline = now + (writeMsOverride ?? writeSeconds * 1000)`, emite `round:writing { letter, endsAt }`. `updateAnswer` guarda la respuesta del participante (texto vacío, o sin letras ni números, la borra) y emite `round:progress { playerId, filled }` a la sala solo cuando `filled` cambia. `stop` exige participante, hoja sin cerrar, las 7 categorías con texto y todas con `startsWithLetter`; si no, `sheet_incomplete`. Al STOP o al vencer el tiempo: `stopped = { by }`, `deadline = now + stopGraceMs`, emite `round:stopped { by, endsAt }`. Durante la gracia se siguen aceptando `updateAnswer` (también las que llegan justo en el instante del vencimiento) pero no otro `stop` (`wrong_phase`). Al vencer la gracia: `beginReview`.

**REVIEW** (`beginReview`): arma los grupos de las 7 categorías. Respuestas iguales tras `normalizeAnswer` forman un grupo; `text` es el del primer autor en orden de llegada y los grupos quedan en orden de llegada de su primer autor. Las vacías no forman grupo. Una respuesta que no empieza con la letra queda `wrong_letter` (no votable).

- **Categorías sin respuestas: se saltan** (decisión del motor). `review.order` son solo las categorías con al menos un grupo, en el orden de `CATEGORIES`; `ReviewState.index` y `total` cuentan dentro de ese `order` (con 2 categorías respondidas: `index` 0 y 1, `total` 2). Si ninguna tiene respuestas se pasa directo a ROUND_END, sin fase REVIEW.
- Al entrar a una categoría: `ready = []`, `deadline = now + reviewMs`, emite `review:category { category, index, total, groups, endsAt }`.
- `vote { playerId, key, reject }`: errores `not_in_room`, `wrong_phase`, `not_playing` (no participante), `unknown_answer` (el grupo no existe en la categoría en curso, o es `wrong_letter`), `own_answer` (es autor). Votar lo mismo otra vez no cambia nada ni emite.
- Mayoría: votantes posibles de un grupo = participantes **conectados** que no son autores. Un grupo queda `rejected` cuando los votos de votantes posibles superan la mitad de ellos (`> posibles / 2`). Sin votantes posibles queda `valid`. Con 2 jugadores basta el voto del otro; con 3 hacen falta 2 de 2; con 4, 2 de 3.
- Se recalcula la categoría en curso al votar, al conectarse o desconectarse un participante y al borrarse uno. **El voto de quien está caído no cuenta mientras lo está** (sigue en `rejectedBy` y vuelve a contar si se reconecta).
- Puntos por autor, recalculados en vivo sobre los grupos válidos de la categoría (`assignPoints`): `SCORE_ALONE` (200) si es el único grupo válido y tiene un solo autor; `SCORE_REPEATED` (50) si el grupo tiene más de un autor; `SCORE_UNIQUE` (100) en otro caso. Rechazada o `wrong_letter`: 0, y no cuenta para el 200 de otro.
- Cada voto, y cada cambio de "Listo", emite `review:update { category, groups, ready }` a la sala. Si el último "Listo" completa a los conectados, tras ese `review:update` sigue `review:category` (o `round:end`).
- `ready { playerId, ready }`: errores `not_in_room`, `wrong_phase`, `not_playing`. Avanza a la siguiente categoría cuando todos los participantes conectados están listos (al menos uno) o al vencer `reviewMs`. Se revisa también cuando un participante se cae o se borra.
- Los grupos de una categoría ya revisada no se recalculan.

**ROUND_END** (`endRound`): `results` con las 7 categorías (las saltadas, `[]`), `gains` por cada jugador presente (los no participantes, 0), puntajes acumulados sumados. Emite `round:end { letter, gains, scores, results, stoppedBy, endsAt: now + roundEndMs }`. Luego otra ronda o `endGame`.

**GAME_END** (`endGame`): sin plazo, `ranking` ordenado por puntaje (empates comparten puesto: 1, 1, 3; en empate, orden de llegada). Emite `game:end { ranking }`. Como en la referencia, `start` del anfitrión en GAME_END lleva a LOBBY (`toLobby`: `round = 0`, sin plazo, puntajes conservados hasta el próximo inicio, `snapshot` a cada conectado). Un `start` desde LOBBY empieza una partida nueva con puntajes y letras reiniciados.

## 7. Jugadores

| Acción                   | Resultado                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `join`, sesión nueva     | `room_full` si hay `maxPlayers`. Crea el jugador (`newId`, `uniqueName`, 0 puntos); si no hay anfitrión, lo es. `player:joined` al resto y `snapshot` al nuevo. Si hay ronda en curso no es participante: mira hasta la ronda siguiente |
| `join`, sesión existente | Si estaba conectado con otro `connId`: `disconnectConn` del viejo. Queda conectado con el nuevo. Si estaba caído: `player:updated` al resto y recálculo de la categoría en revisión. Siempre `snapshot`. No cambia el nombre            |
| `disconnect`             | `connId` distinto o ya desconectado: no hace nada. Si no: marca caído, inicia la gracia, `player:updated`, recálculo de la revisión. No transfiere el anfitrión                                                                         |
| `leave`                  | `not_in_room` si no existe; si no, `removePlayer`                                                                                                                                                                                       |
| `updateSettings`         | LOBBY, anfitrión, `rounds` en 1–10 y `writeSeconds` en 30–180 (enteros); errores `not_in_room`, `not_host`, `wrong_phase`, `invalid_payload`. Manda `snapshot` a cada conectado                                                         |
| `message`                | `not_in_room`; vacío tras `trim`: nada; solo en LOBBY, REVIEW, ROUND_END y GAME_END (en LETTER y WRITING, `wrong_phase`). Emite `message:new { playerId, text }` a la sala                                                              |
| `tick`                   | Solo `advance`                                                                                                                                                                                                                          |

`removePlayer`: lo quita (y de `pickers`), emite `player:left`, traspasa el anfitrión al conectado más antiguo (si no hay, al más antiguo) y, si había ronda en curso y quedan menos de `minPlayers` jugadores (contando a los caídos en gracia), vuelve a LOBBY. Si no, `purgeFromRound`: sale de `playing`, se borran su hoja y sus votos, desaparece de los grupos de la categoría en curso y de las que faltan (los que quedan sin autores se eliminan; las ya revisadas quedan congeladas) y se recalcula la categoría en curso. El `sessionId` nunca sale en un efecto.

## 8. Snapshot

`buildSnapshot(state, viewerId, now)` entrega al jugador:

- `players[].playing`: participante de la ronda en curso (LETTER a ROUND_END). `filled`: categorías con texto, solo en WRITING. `ready`: marcó "Listo", solo en REVIEW.
- `pickerId`: solo en LETTER. `letter`: de la revelación hasta ROUND_END; `null` mientras gira la ruleta y fuera de ronda. `endsAt`: el `deadline` vigente. `stopped`: solo en WRITING.
- `myAnswers`: solo en WRITING y solo para participantes (`{}` si no ha escrito; `null` para quien mira). Nunca trae respuestas ajenas.
- `review`: solo en REVIEW (categoría en curso con sus grupos). `roundEnd`: solo en ROUND_END. `ranking`: solo en GAME_END.

`player:updated` solo se emite por cambios de conexión, anfitrión, puntaje al reiniciar y `playing`; `filled` y `ready` viajan en `round:progress` y `review:update`, no en eventos de jugador.

## 9. Decisiones donde el plan no definía

| Caso                                                             | Decisión                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Categoría sin ninguna respuesta                                  | Se salta; `index` y `total` cuentan solo las revisadas                                                                  |
| Voto sobre `wrong_letter`                                        | `unknown_answer` (no es votable)                                                                                        |
| Voto de un jugador caído                                         | No cuenta mientras está caído                                                                                           |
| Respuesta con solo signos (`!!!`)                                | Equivale a vacía: se borra de la hoja                                                                                   |
| Respuesta más larga que `ANSWER_MAX_LENGTH` o categoría inválida | `invalid_payload`                                                                                                       |
| Votar o marcar "Listo" sin cambio                                | No emite                                                                                                                |
| Picker                                                           | Rota por llegada entre los participantes de cada ronda; no se reinicia al entrar o salir gente, solo al empezar partida |
| Participante que se desconecta en WRITING                        | Su hoja se conserva; si vuelve en la gracia de 30 s la recupera; si no, se borra                                        |
| Desde GAME_END                                                   | `start` del anfitrión vuelve a LOBBY (como la referencia); `start` desde LOBBY empieza de cero                          |
| Nadie conectado al iniciar una ronda                             | `endGame`                                                                                                               |

## 10. Pruebas

Arnés (`testing.ts`): `now` controlable, `rng` de secuencia fija (o inyectable), `newId` incremental (`p1`, `p2`…), letras fijas `A`, `B`, `C`… por defecto, `dispatch`, `advanceTo`/`advanceBy` (despierta el motor en cada vencimiento, como la red), atajos (`startedGame`, `writingGame`, `fill`, `toReview`, `readyAll`, `vote`) y `assertNoAnswerLeak(effects, secretos)`.

Cobertura: partida integral de 3 jugadores y 3 rondas; 50/100/200; respuesta rechazada que da 200 al otro; `wrong_letter`; mayoría con 2, 3 y 4 jugadores y su recálculo al desconectarse o reconectarse alguien; STOP incompleto, por tiempo y respuestas en la gracia; letras sin repetir y `lettersOverride`; picker que rota y ruleta que se detiene sola; entrada tardía; reconexión con `myAnswers`; traspaso de anfitrión; quedar con 1 jugador; chat por fase; fuga de respuestas ajenas en efectos y snapshots de WRITING.
