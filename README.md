# Bachillerato

Juego web multijugador del clásico chileno de papel y lápiz: sale una letra y todos escriben a toda
velocidad una palabra por categoría que empiece con ella. Para jugar en familia o con amigos, sin
registro, sin publicidad y directo al navegador (computador o celular).

**Jugar ahora:** <https://bachillerato-production.up.railway.app>

Es hermano de [Dibuja y Adivina](https://github.com/fgbravom/dibujayadivina): misma arquitectura,
mismo stack y misma identidad visual de cuaderno.

## ¿Por qué existe?

El bachillerato es el juego de papel y lápiz de toda la vida en Chile: una hoja con categorías, una
letra, un "¡stop!" y la discusión de siempre sobre si _fuente_ es o no es un color. Se jugaba en el
recreo, en la mesa después del almuerzo y en los viajes largos en auto.

Hoy hay muchas versiones online, pero casi siempre traen algún detalle molesto: publicidad
invasiva, registros innecesarios o trabas para entrar rápido. La idea acá es simple: que cualquier
familia o grupo de amigos pueda jugarlo desde el computador o el celular, sin fricciones, sin lápiz
ni hoja, y echar unas buenas risas. Nada más.

## Características principales

- **Salas privadas al instante**: creas una sala, compartes el código de 4 letras o el enlace
  directo (`/sala/ABCD`) y a jugar (de 2 a 12 jugadores). Solo necesitas un apodo.
- **La hoja de siempre**: 7 categorías fijas, con la letra de la ronda en grande y la hoja de
  cuaderno cuadriculado.
- **Tensión en vivo**: ves cuánto lleva cada jugador (_"Cami 5/7"_), pero no lo que escribe, hasta
  que alguien grita **¡STOP!**.
- **Revisión entre todos**: las respuestas se revisan categoría por categoría, con votación
  _"No vale"_, chat para discutir y puntos que cambian en vivo.
- **En computador y celular**: diseño adaptado a escritorio y pantallas táctiles (vertical y
  apaisado), cuidando que el teclado del teléfono no tape el botón de STOP.
- **Dinámica ágil**: efectos de sonido sintetizados (con opción de silenciar) y reconexión
  automática si se cae la señal.

## Cómo se juega

1. **La letra.** Una ruleta de letras gira en la pantalla de todos y a un jugador por ronda le toca
   apretar **¡Stop!** para detenerla (si nadie lo hace, se detiene sola). Las letras no se repiten
   en la partida.
2. **A escribir.** Con la letra a la vista, cada jugador completa su hoja con una palabra que
   empiece con esa letra en cada categoría:
   - Nombre o apellido
   - Ciudad o país
   - Color o cosa
   - Fruta o verdura
   - Animal o ave
   - Serie, programa de TV o personaje
   - Cantante o grupo musical
3. **¡STOP!** Quien completa la hoja entera grita **¡STOP!** y se cierran las hojas de todos. Si se
   acaba el tiempo, pasa lo mismo.
4. **Revisión.** Se revisan las respuestas una categoría a la vez. Las que no empiezan con la letra
   se anulan solas y cualquiera puede marcar _"No vale"_ en una respuesta ajena: queda rechazada si
   la rechaza más de la mitad de los votantes.
5. **Puntaje.** Por categoría: **200** puntos si eres el único con una respuesta válida, **100** si
   nadie más escribió lo mismo que tú y **50** si otro jugador puso la misma palabra. Gana quien
   suma más al terminar las rondas.

## Desarrollo local

Requisitos: Node.js >= 22 y `pnpm`.

```sh
pnpm install
pnpm dev # levanta servidor (puerto 3002) y cliente web (puerto 5174) en paralelo
pnpm test # pruebas unitarias y de integración con Vitest
pnpm e2e # pruebas de extremo a extremo con Playwright
pnpm typecheck && pnpm lint
```

Documentación interna:

- [Motor de reglas](docs/motor-reglas.md)
- [Despliegue](docs/despliegue.md)

## Aportar un café

Si el juego les sacó unas risas, puedes apoyar el proyecto con un café. Se agradece.

[![Invitame un café en Buy Me a Coffee](https://img.buymeacoffee.com/button-api/?text=Invitame%20un%20caf%C3%A9&emoji=%E2%98%95&slug=fgbravom&button_colour=FF813F&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://www.buymeacoffee.com/fgbravom)
