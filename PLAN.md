# Bachillerato — plan de construcción

Juego web multijugador del clásico chileno de papel y lápiz: sale una letra y todos escriben a toda
velocidad una palabra por categoría que empiece con ella. Quien completa la hoja grita **¡STOP!**,
se revisan las respuestas entre todos y se reparten 50, 100 o 200 puntos.

Este documento es la fuente de verdad para los agentes. Hermano de
[Dibuja y Adivina](https://github.com/fgbravom/dibujayadivina): **misma arquitectura, mismo stack y
misma identidad visual** (papel de cuaderno, tinta azul marino, bordes gruesos y sombras duras). El
código de referencia está en `c:\Users\Pipe\Proyectos\Personales\dibujayadivina` (solo lectura): lo
que ahí ya está resuelto (salas, sesiones, reconexión, límites, componentes, sonido, aviso de versión,
despliegue) se copia y adapta, no se reinventa.

## 1. Alcance

- Salas privadas por código de 4 letras o enlace (`/sala/ABCD`), sin registro: solo un apodo.
- De 2 a 12 jugadores. Computador y celular (táctil, vertical y apaisado).
- Partida completa: letra, escritura, STOP, revisión por votación, puntaje, rondas, podio.
- Fuera del MVP: salas públicas, cuentas, categorías personalizadas, diccionario automático (sección 8).

## 2. Reglas

### Categorías (fijas en el MVP, las de la hoja original)

| id | Etiqueta |
|---|---|
| `nombre` | Nombre o apellido |
| `lugar` | Ciudad o país |
| `cosa` | Color o cosa |
| `fruta` | Fruta o verdura |
| `animal` | Animal o ave |
| `tv` | Serie, programa de TV o personaje |
| `cantante` | Cantante |

### Parámetros

| Parámetro | Valor |
|---|---|
| Jugadores | 2 mínimo para iniciar, 12 máximo |
| Rondas | 5 por defecto (1–10); una letra por ronda, sin repetir en la partida |
| Letras | `ABCDEFGHIJLMNOPRSTUV` (sin K, Ñ, Q, W, X, Y, Z) |
| Ruleta de letra | hasta 8 s girando; si nadie la detiene, se detiene sola |
| Letra revelada | 3 s de "¡Con la F!" antes de escribir, para que todos partan a la vez |
| Tiempo de escritura | 90 s por defecto (30–180), o hasta que alguien grite STOP |
| Gracia de cierre | 1 s tras el STOP (o el fin del tiempo) para que lleguen las últimas teclas |
| Revisión | 20 s por categoría, o antes si todos marcan "Listo" |
| Fin de ronda | 10 s mostrando puntos de la ronda y acumulados |
| Respuesta | hasta 30 caracteres |

### Fases

```
LOBBY → LETTER → WRITING → REVIEW (una categoría a la vez) → ROUND_END → (otra ronda: LETTER)
                                                                        → (última: GAME_END → LOBBY)
```

**LETTER.** En papel uno recita el abecedario y otro dice "stop". Acá las letras giran rápido en la
pantalla de todos y a un jugador por ronda (rota en orden de llegada: `pickerId`) le toca apretar
**¡Stop!**. La letra la elige el servidor al azar entre las no usadas (la animación es cosmética y
aterriza en la letra del servidor). Luego 3 s con la letra en grande y empieza la escritura.

**WRITING.** Cada jugador ve su hoja con las 7 categorías. Las respuestas se envían al servidor
mientras se escribe (con retardo ≤ 300 ms) y **nunca viajan a los demás** durante esta fase: el
resto solo ve el avance ("Cami 5/7"), que es lo que da la tensión. Quien tiene las 7 completas, todas
empezando con la letra, puede apretar **¡STOP!**: se bloquean las hojas de todos, corre 1 s de gracia
y empieza la revisión. Si se acaba el tiempo ocurre lo mismo sin autor del STOP. No es obligación
llenar todo.

**REVIEW.** Categoría por categoría, todos ven lo que escribió cada uno. Las respuestas iguales
(tras normalizar: minúsculas, sin tildes, sin espacios dobles; la `ñ` se conserva) se agrupan.

- Una respuesta que no empieza con la letra queda anulada automáticamente (`wrong_letter`).
- El resto parte como válida. Cualquier jugador que no sea autor de esa respuesta puede marcarla
  "No vale" (y desmarcarla). Queda rechazada cuando la rechaza **más de la mitad** de los votantes
  posibles (participantes conectados que no son autores). Con 2 jugadores basta el voto del otro.
- Los puntos se ven en vivo y cambian con los votos.
- Se avanza a la siguiente categoría cuando todos los participantes conectados marcan "Listo" o a
  los 20 s. Hay chat para discutir ("¡Fuente no es un color!").

**Puntaje** por categoría, sobre las respuestas válidas:

- **200** si eres el único con una respuesta válida en esa categoría.
- **100** si nadie más escribió lo mismo que tú.
- **50** si otro jugador escribió lo mismo.
- 0 si está vacía, anulada o rechazada (una rechazada cuenta como "no puso nada" para el 200 ajeno).

**ROUND_END.** Tabla con los puntos de la ronda y los acumulados. **GAME_END.** Podio; el anfitrión
vuelve a la sala de espera para jugar de nuevo.

### Otras reglas

- **Participantes.** Juegan la ronda quienes estaban al empezar la fase LETTER (`playing`). Quien
  entra a mitad de ronda mira y juega desde la siguiente.
- **Anfitrión.** Crea la sala, la inicia y cambia rondas y tiempo. Si se va, pasa al más antiguo.
- **Reconexión.** `sessionId` en el navegador; 30 s de gracia conservando puesto, puntaje y hoja.
  Al volver recibe sus propias respuestas (`myAnswers`).
- **Quedar con menos de 2 jugadores** devuelve la sala a LOBBY.
- **Chat.** Un campo de texto en LOBBY, REVIEW, ROUND_END y GAME_END. En LETTER y WRITING no hay.
- Si el `pickerId` se desconecta, la ruleta se detiene sola al vencer el plazo.

## 3. Arquitectura

Igual que la referencia: **el servidor manda**. Estado, reloj, letra, respuestas y puntaje viven en
el servidor; el motor es una máquina de estados pura (acciones → estado + efectos) con reloj y azar
inyectados; la red valida todo con Zod y verifica rol y fase.

TypeScript en todo · monorepo pnpm · React + Vite + Tailwind 4 + Zustand · Node 22 + Socket.IO ·
Zod · estado en memoria · Vitest + Playwright · un contenedor Docker (Railway).

```
bachillerato/
  packages/shared/     contrato: tipos, eventos, esquemas Zod, constantes, normalizeAnswer
  apps/server/
    src/game/          motor de reglas puro
    src/net/           Socket.IO, salas, sesiones, límites de frecuencia, estáticos
  apps/web/
    src/ui/            pantallas y componentes (con vista previa de datos simulados)
    src/state/         store, cliente de sockets, ruta, identidad, versión
    src/sound/         efectos sintetizados
  e2e/                 pruebas Playwright
```

Paquetes: `@bach/shared`, `@bach/server`, `@bach/web`, `@bach/e2e`.

## 4. Contrato compartido (`packages/shared`)

Nadie lo modifica por su cuenta después de T0. Si una tarea necesita cambiarlo, se detiene y lo reporta.

```ts
type CategoryId = 'nombre' | 'lugar' | 'cosa' | 'fruta' | 'animal' | 'tv' | 'cantante';
type Category = { id: CategoryId; label: string };          // CATEGORIES, en el orden de la tabla
type Phase = 'LOBBY' | 'LETTER' | 'WRITING' | 'REVIEW' | 'ROUND_END' | 'GAME_END';
type Answers = Partial<Record<CategoryId, string>>;

type Player = {
  id: string; name: string; score: number; connected: boolean; isHost: boolean;
  playing: boolean;   // participa en la ronda en curso
  filled: number;     // categorías con texto en WRITING (0 fuera de ella)
  ready: boolean;     // marcó "Listo" en la categoría en revisión
};

type GameSettings = { rounds: number; writeSeconds: number };

type AnswerStatus = 'valid' | 'rejected' | 'wrong_letter';
type ReviewGroup = {
  key: string;            // respuesta normalizada; identifica al grupo dentro de la categoría
  text: string;           // como la escribió el primer autor
  playerIds: string[];    // autores
  rejectedBy: string[];   // quienes votaron "No vale"
  status: AnswerStatus;
  points: number;         // puntos que recibe cada autor (0 si no es válida)
};
type ReviewState = {
  category: CategoryId; index: number; total: number;   // index desde 0
  groups: ReviewGroup[];                                // sin respuestas vacías
};

type RoundEnd = {
  letter: string;
  gains: Record<string, number>;                 // puntos de la ronda por jugador
  scores: Record<string, number>;                // acumulado
  results: Record<CategoryId, ReviewGroup[]>;    // detalle final de cada categoría
  stoppedBy: string | null;
};

type RoomState = {
  code: string; phase: Phase; settings: GameSettings; categories: Category[];
  players: Player[]; hostId: string; selfId: string;
  round: number; totalRounds: number;            // round 0 en LOBBY
  pickerId: string | null;                       // a quién le toca detener la ruleta
  letter: string | null;                         // null mientras gira la ruleta
  endsAt: number | null; serverNow: number;      // fin de la fase o subfase en curso
  stopped: { by: string | null } | null;         // WRITING ya cerrada (gracia en curso)
  myAnswers: Answers | null;                     // solo las propias, en WRITING
  review: ReviewState | null; roundEnd: RoundEnd | null; ranking: RankingEntry[] | null;
};
```

**Cliente → servidor**

| Evento | Datos | Quién / cuándo |
|---|---|---|
| `room:create` / `room:join` | `{ name, sessionId }` / `{ code, name, sessionId }` (con ack) | cualquiera |
| `room:settings` | `{ rounds, writeSeconds }` | anfitrión, LOBBY |
| `game:start` | — | anfitrión, LOBBY (y GAME_END → vuelve a LOBBY, como la referencia) |
| `letter:stop` | — | `pickerId`, LETTER girando |
| `answers:update` | `{ category, text }` | participante, WRITING (incluida la gracia) |
| `round:stop` | — | participante con las 7 completas y válidas de letra, WRITING sin cerrar |
| `review:vote` | `{ key, reject }` | participante no autor, REVIEW, categoría en curso |
| `review:ready` | `{ ready }` | participante, REVIEW |
| `message:send` | `{ text }` | cualquiera, fases con chat |

**Servidor → cliente**

| Evento | Datos | A quién |
|---|---|---|
| `room:state` | foto completa | quien entra o se reconecta |
| `player:joined` / `player:left` / `player:updated` | jugador | sala |
| `round:letter` | `{ round, totalRounds, pickerId, endsAt }` | sala (empieza a girar) |
| `round:letter-chosen` | `{ letter, endsAt }` | sala (`endsAt` = inicio de la escritura) |
| `round:writing` | `{ letter, endsAt }` | sala |
| `round:progress` | `{ playerId, filled }` | sala |
| `round:stopped` | `{ by, endsAt }` | sala (bloquear hojas; `endsAt` = fin de la gracia) |
| `review:category` | `ReviewState & { endsAt }` | sala (empieza una categoría) |
| `review:update` | `{ category, groups, ready: string[] }` | sala (voto o "Listo") |
| `round:end` | `RoundEnd & { endsAt }` | sala |
| `game:end` | `{ ranking }` | sala |
| `message:new` | `{ playerId, text }` | sala |
| `system:error` / `system:online` | `{ code }` / `{ count }` | quien lo causó / todos |

Reloj con `endsAt` + `serverNow` como en la referencia. Variables de entorno de prueba para e2e:
tiempos cortos y secuencia fija de letras.

**Límites:** apodo 2–16, mensaje hasta 80, respuesta hasta 30, 3 mensajes de texto y 20
`answers:update` por segundo y jugador.

## 5. Experiencia (lo difícil: que sea ágil en el teléfono)

- **Identidad:** los mismos tokens de `index.css` de la referencia. La hoja de juego es una hoja de
  cuaderno cuadriculado con espiral, como la foto original; la letra de la ronda va en grande, tipo
  timbre. Logo y textos propios ("Bachillerato"), español de Chile.
- **Escritura en móvil:** categorías apiladas (etiqueta + campo), `enterkeyhint="next"` y Enter salta
  al siguiente campo vacío; sin autocorrector ni mayúsculas forzadas raras (`autocapitalize="words"`,
  `autocomplete="off"`, `autocorrect="off"`, `spellcheck=false`). Cabecera fija con letra, reloj y
  ronda; botón **¡STOP!** fijo abajo, gigante, habilitado solo con la hoja completa; el teclado no
  debe taparlo (`visualViewport`, como en la referencia). Campo marcado si no empieza con la letra.
- **Escritorio:** la hoja como tabla horizontal de cuaderno (una columna por categoría) cuando cabe.
- **Tensión:** fila de jugadores con avance en vivo (`5/7`), reloj que late al final, sonido y
  animación de pantalla completa al STOP ("¡STOP! lo gritó Cami").
- **Revisión:** tarjetas por respuesta con avatares de autores, sello de puntos (50/100/200) que
  cambia en vivo, botón "No vale" con contador de votos, botón "Listo" y chat.

## 6. Tareas

Los agentes no hacen commits: los hace la sesión principal tras verificar.

- **T0. Andamiaje y contrato** (en serie). Copiar configuración de la referencia, renombrar a
  `@bach/*`, escribir `packages/shared` completo con pruebas, y dejar servidor y web mínimos que
  arrancan. Listo: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` en verde.
- **T1. Motor de reglas** · `apps/server/src/game/**` + `docs/motor-reglas.md`.
- **T2. Pantallas** · `apps/web/src/ui/**`, `apps/web/src/index.css`, `ui-preview.html`. Con datos
  simulados y vista previa de todas las fases en 360 × 640 y 1280 × 800.
- **T3. Servidor de sockets** (tras T1) · `apps/server/src/net/**`, `apps/server/src/index.ts`.
- **T4. Cliente conectado** (tras T2) · `apps/web/src/state/**`, `apps/web/src/sound/**`, `App.tsx`.
- **T5. E2E y salida** (tras T3 y T4) · `e2e/**`, `Dockerfile`, CI, `README.md`, `docs/despliegue.md`.
- **T6. Revisión** de código y seguridad: fuga de respuestas ajenas durante WRITING, mensajes sin
  validar, acciones sin verificar rol o fase, memoria sin tope, contenido de usuario como HTML.

```
T0 ──┬─ T1 ── T3 ─┐
     └─ T2 ── T4 ─┴─ T5 ── T6
```

## 7. Reglas para todos los agentes

1. Leer este plan y `packages/shared` antes de escribir código.
2. Tocar solo los archivos de la tarea. Si hace falta cambiar el contrato o un archivo ajeno,
   detenerse y reportarlo.
3. Las reglas viven en el motor. Ni la red ni el cliente deciden puntajes o validez.
4. Nada que llegue del cliente se usa sin pasar por Zod y por la verificación de rol y fase.
5. Identificadores en inglés; textos de interfaz y comentarios en español de Chile.
6. Reutilizar de la referencia todo lo que aplique, eliminando lo propio del dibujo (lienzo, trazos,
   palabras, pistas).
7. Terminar con `pnpm typecheck && pnpm lint && pnpm test` en verde y reportar qué se hizo, qué no
   y qué se asumió.

## 8. Después del MVP

1. Categorías elegibles y propias por sala; letras difíciles opcionales.
2. Unir a mano respuestas "casi iguales" en la revisión (`Frank Sinatra` / `Sinatra`).
3. Hoja con el historial de rondas, exportable como imagen para compartir.
4. Modo sin límite de tiempo (solo STOP), como en papel.
5. Salas públicas, expulsión por votación, filtro de groserías.

## 9. Decisiones abiertas (con valor por defecto, no frenan el trabajo)

| Decisión | Valor asumido |
|---|---|
| Quién valida las respuestas | Los propios jugadores por votación; sin diccionario |
| Respuesta rechazada y el 200 | La rechazada cuenta como vacía: el otro puede sacar 200 |
| STOP | Exige las 7 completas y empezando con la letra; sin bono por gritarlo |
| Letras excluidas | K, Ñ, Q, W, X, Y, Z |
| Tiempo máximo de escritura | 90 s (en papel no hay límite) |
| Categoría sin ninguna respuesta | Se salta en la revisión |
| Alguien se va en plena revisión | Las categorías ya revisadas quedan congeladas; sale de las que faltan |
| Voto de un jugador caído | No cuenta mientras está desconectado |
