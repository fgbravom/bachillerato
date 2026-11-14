# Despliegue

Un solo contenedor Node sirve el cliente compilado, Socket.IO y `GET /health`. El servidor corre con `tsx` dentro de la imagen y no se empaqueta con esbuild: `esbuild` no es dependencia directa del proyecto y tsx ya está en el lockfile, así que no hay paso de compilación ni dependencia nueva que mantener (el costo es algo de peso extra en la imagen y un arranque un poco más lento).

## Requisitos

- Docker (para construir la imagen; la plataforma también puede construirla por ti).
- Una cuenta en la plataforma elegida.
- La plataforma debe permitir WebSockets persistentes, HTTPS y **una sola instancia**: el estado de las partidas vive en la memoria del proceso.

## Construir y correr en local

```sh
docker build -t bachillerato .
docker run --rm -p 8080:8080 --name bach bachillerato
```

Abre <http://localhost:8080>. Comprobaciones rápidas: `curl localhost:8080/health` devuelve `{"ok":true}` y `localhost:8080/sala/ABCD` devuelve el HTML del cliente. Para detenerlo, `Ctrl+C` (o `docker stop bach` si lo corriste con `-d`).

## Railway

El juego está publicado en Railway: <https://bachillerato-production.up.railway.app>. Estos son los pasos con que se armó.

### Primer despliegue (una vez, a mano)

1. En Railway: _New Project → Deploy from GitHub repo_ y elige este repositorio. `railway.json` le indica que construya con el `Dockerfile` y con qué comando arrancar.
   - Railway detecta el monorepo y ofrece crear un servicio por paquete (`@bach/server` y `@bach/web`). **Debe quedar uno solo**: el contenedor ya sirve el cliente y los sockets. Borra el de `@bach/web`.
   - Si un servicio falla con _The executable `pnpm` could not be found_, es que Railway le puso un comando de arranque propio del monorepo (`pnpm --filter ...`), y la imagen final no trae pnpm. `railway.json` lo reemplaza; si persiste, vacía _Settings → Deploy → Custom Start Command_ y deja _Root Directory_ en `/`.
2. En los ajustes del **servicio** (no del proyecto), _Networking → Generate Domain_ con el puerto `8080`.
3. En _Deploy_: una sola réplica, _Healthcheck Path_ `/health` y _Serverless_ activado.

Serverless duerme el servicio cuando no hay tráfico y solo cobra el tiempo despierto; así el uso cabe en el crédito del plan gratis. A cambio se pierden las salas vacías y el primer visitante espera unos segundos el arranque. Siempre encendido, el proceso gasta más o menos el crédito mensual completo solo en memoria.

Los WebSockets funcionan sin configuración extra: Socket.IO se conecta por el mismo dominio y puerto que el cliente, y el servidor acepta el _upgrade_ en el mismo proceso.

### Despliegue continuo

Railway redespliega solo con cada push a `main`. `.github/workflows/ci.yml` corre formato, lint, typecheck y pruebas, pero no frena el despliegue: para que Railway espere a que pasen, activa _Wait for CI_ en los ajustes del servicio.

Ojo: como cada push a `main` despliega, también corta las partidas en curso (ver la advertencia al final).

## Render u otra plataforma

Sirven igual: crea un servicio web desde este repositorio con el `Dockerfile`, una única instancia, y deja que la plataforma inyecte `PORT` (la imagen ya escucha en `0.0.0.0`); apunta el chequeo de salud a `/health`.

Fly.io se descartó para el juego hermano (Dibuja y Adivina): sin tarjeta registrada, la cuenta de prueba apaga la máquina cada 5 minutos y con ella las salas.

## Variables de entorno

| Variable           | Por defecto en la imagen | Uso                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`             | `8080`                   | Puerto de escucha. Debe coincidir con el puerto del dominio en Railway. Fuera de la imagen, el servidor usa `3002`.                                                                                                                                                                           |
| `HOST`             | `0.0.0.0`                | Interfaz de escucha.                                                                                                                                                                                                                                                                          |
| `WEB_DIR`          | `/app/web`               | Carpeta del cliente compilado.                                                                                                                                                                                                                                                                |
| `NODE_ENV`         | `production`             | Con `production` el servidor rechaza las conexiones Socket.IO cuyo `Origin` no coincide con el `Host` (ver `ALLOWED_ORIGINS`). Fuera de producción no filtra.                                                                                                                                 |
| `BACH_MAX_ROOMS`   | `500` (del servidor)     | Tope de salas simultáneas; opcional.                                                                                                                                                                                                                                                          |
| `CLIENT_IP_HEADER` | (sin definir)            | Cabecera con la IP real del cliente cuando hay un proxy delante (en Railway, `x-real-ip`). Con ella el servidor cuenta conexiones y salas por IP; sin ella no confía en ninguna cabecera y usa la IP de la conexión, así que todos los jugadores detrás del proxy comparten los topes por IP. |
| `ALLOWED_ORIGINS`  | (sin definir)            | Orígenes completos permitidos además del propio host, separados por comas (p. ej. `https://juego.example.com,https://www.juego.example.com`). Solo aplica con `NODE_ENV=production`. Las conexiones sin `Origin` siempre se aceptan.                                                          |

Si el servidor está detrás de un proxy y no se define `CLIENT_IP_HEADER`, todos los visitantes parecen venir de la misma IP y comparten los topes por IP (conexiones simultáneas y salas creadas por minuto).

Las variables `BACH_*` de modo de pruebas (`BACH_WRITE_MS`, `BACH_LETTERS`, etc.) solo se leen con `BACH_TEST=1` y no deben fijarse en producción. Están descritas en la cabecera de `apps/server/src/index.ts`.

## Advertencia: los redespliegues cortan las partidas

Todo el estado está en memoria. Cada despliegue, reinicio o cambio de configuración reinicia el proceso y se pierden las salas en curso: los jugadores verán que la sala ya no existe. Despliega cuando no haya partidas activas.
