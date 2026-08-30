# Human Firewall

Plataforma de concientizacion en ciberseguridad: cursos, simulaciones interactivas y
gamificacion (puntos, niveles, insignias y rankings).

**Arquitectura monolitica + basada en eventos:** un solo proceso Node/Express
sirve la interfaz y la API contra una sola base de datos, y por dentro los
modulos se comunican publicando eventos en vez de llamarse entre si.

- **Backend:** Node.js + Express 5 + PostgreSQL
- **Frontend:** React 19 + Vite + TailwindCSS 4, compilado y servido por el backend

---

## Arquitectura

El sistema es un **monolito**: un unico proceso atiende todas las peticiones,
sean de la interfaz o de la API, contra una sola base de datos.

```
                  Navegador
                      |
                      v
    +--------------------------------------------+
    |          Proceso Express  (:3000)           |
    |                                             |
    |  /api/*     -> routes -> controllers ->     |
    |                services -> PostgreSQL       |
    |                                             |
    |  resto      -> build de React (estaticos)   |
    +--------------------------------------------+
                      |
                      v
                  PostgreSQL
```

Antes la interfaz y la API eran dos aplicaciones separadas, con su propio
servidor y su propio despliegue cada una. Ahora `npm run build` compila React a
`human-firewall-frontend/dist/` y Express entrega esos archivos desde el mismo
proceso que responde la API.

**Que se gana:**

- Se despliega **un solo artefacto**, en vez de coordinar dos que tienen que
  conocerse entre si.
- La interfaz y la API comparten origen, asi que **no hace falta CORS** ni
  configurar la URL del backend en el frontend.
- Las llamadas entre capas son de funcion a funcion dentro del mismo proceso:
  no hay latencia de red ni fallos parciales que compensar.
- Una transaccion de base de datos cubre una operacion de negocio completa, sin
  coordinacion distribuida.

**Que se paga:**

- Se escala replicando el proceso entero, aunque el cuello de botella sea un
  solo modulo.
- Todo se despliega junto: un cambio en una pantalla obliga a reiniciar tambien
  la API.
- El stack queda fijo para todo el sistema.

Para el volumen de esta plataforma la balanza favorece claramente al monolito.

> **Monolitico describe el DESPLIEGUE, no la organizacion interna.** La
> separacion en capas se conserva intacta: `routes` -> `controllers` ->
> `services` -> base de datos. Que todo viaje junto no autoriza a que un
> controlador escriba SQL.

Como se comunican esos modulos entre si es una decision aparte, y esta en la
seccion siguiente: **no se llaman, publican eventos**.

---

## Arquitectura basada en eventos

**No reemplaza al monolito: responde otra pregunta.** "Monolitico" describe
COMO SE DESPLIEGA el sistema (un proceso, un artefacto, un puerto).
"Basada en eventos" describe COMO SE COMUNICAN LOS MODULOS por dentro. Human
Firewall es las dos cosas a la vez: un *event-driven monolith*. Se sigue
levantando con `npm run serve` en `:3000` y sigue habiendo una sola base de
datos; lo que cambio es que los modulos ya no se llaman entre si.

### El cambio, en concreto

Antes, cerrar un paso de una simulacion era una cadena de llamadas dentro del
mismo request:

```
POST /api/simulations/submit-decision
    controller -> pointsService.registrarMovimiento()   (espera)
               -> respuesta al navegador
```

Ahora el controlador publica el hecho y responde. Lo demas pasa despues:

```
POST /api/simulations/submit-decision
    controller -> eventBus.publish('simulation.decision_made')
               -> respuesta al navegador      <-- el request termina aca

    ... el worker, por fuera del request ...

    simulation.decision_made -> points.service    -> points_ledger
                             -> points_assigned   -> levels.service   -> nivel
                                                  -> rewards.service  -> recompensa
                                                  -> reward_granted   -> notifications
```

`simulation.controller.js` ya no sabe que existen los puntos, ni los niveles,
ni las recompensas, ni los correos. Publica lo que paso y se va.

### Diagrama

```
   PUBLICADORES                 BUS                     SUSCRIPTORES
  (que hizo el usuario)   (event_outbox + worker)   (que hay que hacer con eso)

  auth.service ---------+                        +---> points.service
  passport.js ----------+                        |     (asigna puntos)
  course.controller ----+                        |
  gamification.ctrl ----+--> [ publish() ] --+   +---> rewards.service
  simulation.ctrl ------+          |         |   |     (otorga logros)
                                   v         |   |
                          +-----------------+|   +---> levels.service
                          |  event_outbox   ||   |     (recalcula nivel)
                          |  status=pending |v   |
                          +-----------------+    +---> recommendations.service
                                   |             |     (proyecta refuerzos)
                                   v             |
                          +-----------------+    +---> notifications.service
                          | worker cada 5 s |----+     (bandeja + correo)
                          | + setImmediate  |
                          +-----------------+
```

Un publicador **no conoce a ningun suscriptor**. Lo unico que comparten es el
nombre del evento y la forma del payload, y eso vive escrito en un solo lugar:
`src/events/catalogo.js`.

### Catalogo de eventos

| Evento | Lo publica | Reaccionan | Payload |
|--------|-----------|------------|---------|
| `user.registered` | `auth.service`, `passport.js` | notifications | `{ userId, email, role, provider }` |
| `lesson.completed` | `course.controller` | points | `{ userId, contentId }` |
| `course.completed` | `course.controller` | points, rewards | `{ userId, courseId }` |
| `quiz.approved` | `gamification.controller` | points, rewards, recommendations | `{ userId, quizRef, quizType, score, passed, basePoints? }` |
| `simulation.decision_made` | `simulation.controller` | points | `{ userId, optionId, simulationId, stepId, isCorrect, points }` |
| `simulation.completed` | `simulation.controller` | rewards, recommendations | `{ userId, simulationId, courseId, score, aprobada, aciertos, pasos, attemptNo }` |
| `points_assigned` | `points.service` | rewards, levels, anomalies | `{ userId, sourceType, sourceId, points, ledgerId }` |
| `level_up` | `levels.service` | notifications | `{ userId, nivel, nombre, nivelesAlcanzados, puntos }` |
| `reward_granted` | `rewards.service` | notifications | `{ userId, rewardId, rewardName, userRewardId }` |

Los nombres mezclan dos estilos (`lesson.completed` con punto, `points_assigned`
con guion bajo). Es herencia de la HU de gamificacion y **no se unifico a
proposito**: esos nombres estan escritos en las filas de `event_outbox` que ya
existen en la base. Renombrarlos dejaria huerfano cualquier evento pendiente o
fallido. Un nombre de evento es contrato publico: se agrega, no se renombra.

`points.service` **no** escucha `simulation.completed`. Los puntos de una
simulacion ya se pagaron decision por decision; sumarlos otra vez al cerrarla
seria pagar dos veces el mismo trabajo.

### Por que outbox y no un EventEmitter

El bus no es el `EventEmitter` de Node. `publish()` **inserta una fila en la
tabla `event_outbox`** y retorna; un worker la procesa despues.

| | EventEmitter en memoria | Outbox en tabla |
|---|---|---|
| Si el proceso se cae a mitad | el evento se pierde, sin rastro | sigue en `pending`, se retoma al arrancar |
| Si un handler falla | la excepcion se pierde o tumba el proceso | queda `last_error` y se reintenta con backoff |
| Atomicidad con la accion | ninguna: el evento puede existir sin que la accion se haya confirmado | se encola en la MISMA transaccion (`publish(nombre, payload, client)`) |
| Ver que paso | nada que consultar | `SELECT * FROM event_outbox` |

Ese tercer punto es el que mas se nota. En `auth.service.register` el INSERT del
usuario y el `user.registered` van en la misma transaccion: el evento existe si
y solo si el usuario existe. Publicando despues del commit, una caida en el
medio dejaria un usuario sin correo de bienvenida y sin ninguna forma de
detectarlo.

Reintentos: hasta 5 intentos con backoff exponencial (2s, 4s, 8s, 16s). Agotados
los cinco, el evento queda en `failed` y se puede ver desde el endpoint de
diagnostico.

### Idempotencia: la regla no negociable

**El worker reintenta.** Por lo tanto, un handler que no sea idempotente no es
un bug latente: es un bug garantizado. Cada suscriptor tiene su propia defensa:

| Suscriptor | Como evita duplicar |
|-----------|---------------------|
| `points.service` | `points_ledger.idempotency_key` UNIQUE (`simulation:<user>:<option>`) |
| `rewards.service` | `dedupeKey` en `user_rewards` |
| `levels.service` | `ON CONFLICT (user_id, level)` en `user_level_history` |
| `notifications.service` | `notifications.dedupe_key` UNIQUE (`level:<user>:<nivel>`) |
| `recommendations.service` | UPSERT: recalcular de nuevo da el mismo resultado |

La clave identifica el **hecho**, no el intento. Por eso el aviso de nivel usa
`level:<user>:<nivel>` y no el id del evento: subir al nivel 2 es un solo hecho,
lo publiquen las veces que lo publiquen.

`tests/eventos.test.mjs` reprocesa a proposito los mismos eventos y verifica que
no se dupliquen ni los puntos, ni los avisos.

### Como agregar un suscriptor

Sin tocar a quien publica:

```js
// src/services/mi.service.js
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');

async function reaccionar({ userId, courseId }) {
    // ...
}

function registrarHandlers() {
    eventBus.subscribe(EVENTOS.COURSE_COMPLETED, reaccionar);
}

module.exports = { reaccionar, registrarHandlers };
```

Y agregarlo a la lista de `src/events/suscriptores.js`. Nada mas.

Si el evento es nuevo, primero va al catalogo (`src/events/catalogo.js`), junto
con su payload y sus suscriptores esperados. Publicar o suscribir un nombre que
no este en el catalogo funciona igual, pero imprime un warning en el arranque:
asi un typo se nota ahi y no tres pantallas mas adelante.

Tres reglas al escribir un handler:

1. **Idempotente.** Ver la tabla de arriba.
2. **No asumas orden.** Los handlers de un mismo evento corren todos, en ningun
   orden garantizado. Si tu handler necesita que otro haya corrido antes, en
   realidad son un solo paso y deben vivir juntos.
3. **Lanza la excepcion si fallaste de verdad.** El worker reintenta. Tragarse
   el error deja el evento en `done` y el trabajo sin hacer. La excepcion es un
   fallo externo que no se va a arreglar reintentando (por ejemplo el envio de
   correo): eso se registra y se sigue.

### Que se gana

- **Agregar comportamiento sin tocar codigo existente.** `notifications.service`
  se agrego entero despues, y no hubo que modificar una linea de `auth.service`,
  `levels.service` ni `rewards.service`.
- **La accion responde sin esperar sus consecuencias.** Registrarse devuelve el
  token de inmediato aunque el correo tarde; el navegador no espera al SMTP.
- **Nada se pierde.** Base caida un instante o proceso reiniciado: el evento
  sigue en la cola.
- **Un mismo hecho, un solo camino.** Registrarse por formulario y por Google
  son dos entradas distintas que publican `user.registered`; el correo de
  bienvenida se escribio una sola vez.

### Que se paga

- **Consistencia eventual.** Tras responder una decision, los puntos todavia no
  estan en el ledger. Por eso el endpoint devuelve `puntos_estimados` y no
  `points_earned`: en ese instante no hay nada otorgado que informar.
- **El error aparece lejos del origen.** Si no llegan los puntos, la causa esta
  en la cola, no en el endpoint que el usuario toco. Para eso existe
  `GET /api/notifications/eventos/estado`.
- **Todo handler tiene que ser idempotente.** Es trabajo extra en cada
  suscriptor nuevo, y no es opcional.
- **Se puede olvidar el cableado.** Si `conectarTodo()` no corriera, la
  aplicacion arrancaria y responderia todo igual; simplemente nadie asignaria
  puntos. Por eso el arranque loguea cuantos handlers quedaron registrados y la
  prueba de eventos compara ese cableado contra el catalogo.

### Diagnostico

```
GET /api/notifications/eventos/estado     (solo admin)
```

```json
{
  "por_estado": { "pending": 0, "processing": 0, "done": 142, "failed": 1 },
  "suscriptores": { "lesson.completed": 1, "points_assigned": 2, "...": 1 },
  "ultimos_fallidos": [
    { "id": 87, "event_name": "level_up", "attempts": 5, "last_error": "..." }
  ]
}
```

En una arquitectura de eventos esto no es un lujo: es la unica ventana a lo que
paso entre "el usuario hizo algo" y "no vi el resultado".

---

## Si venias trabajando con la version anterior

**El arranque cambio.** La interfaz y la API son ahora un solo proceso, asi que
los comandos viejos ya no levantan el sistema completo.

| Antes | Ahora |
|-------|-------|
| `cd human-firewall-backend && npm run dev` **y** `cd human-firewall-frontend && npm run dev` | `npm run serve` desde la raiz |
| Dos puertos: `:3000` y `:5173` | Uno solo: **`:3000`** |
| `VITE_API_URL` apuntando al backend | Vacio: interfaz y API comparten origen |

Una sola vez, despues de traer estos cambios:

```bash
npm run setup
npm run serve
```

`npm run setup` **no pisa** tu `.env` si ya existe, asi que no vas a perder tu
configuracion de base de datos.

Para programar con recarga en caliente siguen siendo dos terminales, pero con
los scripts de la raiz: `npm run dev:api` y `npm run dev:web`. Se trabaja sobre
`:5173` como antes.

---

## Puesta en marcha

Requisitos: **Node.js 18 o superior** y **Docker Desktop**. Nada mas: la base de
datos la levanta el propio repositorio.

### 1. Base de datos

Desde la raiz del repositorio:

```bash
docker compose up -d
```

Levanta un PostgreSQL 16 en el puerto **5433**. Los datos quedan en un volumen,
asi que sobreviven a apagar la maquina. Para empezar de cero: `docker compose down -v`.

> El puerto es el 5433 y no el 5432 a proposito. Si alguien ya tiene PostgreSQL
> instalado en su equipo, el 5432 esta ocupado, Node se conecta a **ese otro**
> Postgres y falla con `password authentication failed for user "postgres"`.
> Con el 5433 conviven los dos.

### 2. Instalacion

```bash
npm run setup
```

Instala las dependencias de las dos carpetas y genera el `.env` del backend con
un `JWT_SECRET` aleatorio. No hay que rellenar nada a mano.

### 3. Arrancar

```bash
npm run serve
```

Compila la interfaz, aplica las migraciones pendientes y levanta el monolito en
**http://localhost:3000**. Todo el sistema con un comando, en un solo puerto.

### 4. Entrar

Las migraciones dejan dos cuentas listas:

| Correo | Contrasena | Rol | Para que sirve |
|--------|-----------|-----|----------------|
| `admin@humanfirewall.com` | `Admin123` | admin | Todo: usuarios, cursos, simulaciones, reportes |
| `rh@humanfirewall.com` | `Rh123456` | rh | Reportes de desempeno (`/reports`) |
| `seguridad@humanfirewall.com` | `Seguridad123` | security | Panel de anomalias y auditoria (`/security`) |

Cualquier otra persona se registra sola en `/register` y entra como `employee`.

> **Estas credenciales son de desarrollo.** Estan escritas en
> `migrations/027_usuarios_iniciales.sql`, que esta publicado en GitHub:
> cualquiera que lea el repositorio las conoce. Antes de exponer el sistema en
> internet hay que cambiarlas o borrar esas dos cuentas.
>
> Antes de esta migracion `schema.sql` insertaba un admin cuyo hash no
> correspondia a ninguna contrasena conocida: la cuenta existia y nadie podia
> entrar. De ahi venia el "bypass de emergencia" que tenia `auth.controller`.

### Modo desarrollo

Para programar conviene conservar la recarga en caliente de Vite, que necesita
su propio servidor. Son dos terminales:

```bash
npm run dev:api     # API en :3000
npm run dev:web     # interfaz en :5173, con recarga en caliente
```

Se trabaja sobre **http://localhost:5173**. Vite reenvia `/api` al backend
(`server.proxy` en `vite.config.js`), asi que el frontend escribe siempre rutas
relativas y el codigo es identico en los dos modos.

### Despues de cada `git pull`

```bash
npm run setup
npm run serve
```

Si la rama traia migraciones nuevas, se aplican solas antes de arrancar.

### Si preferis usar Supabase en vez del contenedor

Reemplaza `DATABASE_URL` en `human-firewall-backend/.env` por la cadena del
panel (*Settings > Database > Connection string*, modo URI). El runner de
migraciones funciona igual.

### Pruebas

```bash
npm test
```

Corren contra PostgreSQL real (PGlite, compilado a WebAssembly): no necesitan
base levantada ni credenciales, y no tocan Supabase. Son 341 pruebas sobre
migraciones, asignacion de puntos, motor de recompensas, niveles,
recomendaciones, simulaciones, reportes y seguridad. Ver `tests/README.md`.

---

## Flujo de trabajo con Git

`main` es la rama estable. **Nadie hace push directo a `main`.**

### Empezar una historia

```bash
git checkout main
git pull
git checkout -b feat/nombre-de-la-historia
```

### Durante el desarrollo

```bash
git add .
git commit -m "feat(gamificacion): descripcion del cambio"
git push -u origin feat/nombre-de-la-historia
```

### Al terminar

Abrir un Pull Request hacia `main` en GitHub. El otro integrante revisa el diff y
aprueba. Recien ahi se mergea.

### Si tu rama quedo atrasada

```bash
git checkout main
git pull
git checkout feat/tu-rama
git merge main       # resolver conflictos aca, en tu rama, nunca en main
```

### Convencion de nombres de rama

| Prefijo | Uso                        |
|---------|----------------------------|
| `feat/` | Funcionalidad nueva        |
| `fix/`  | Correccion de un fallo     |
| `docs/` | Solo documentacion         |

---

## API de gamificacion

| Metodo | Ruta                                          | Acceso                        |
|--------|-----------------------------------------------|-------------------------------|
| GET    | `/api/gamification/points/:userId`             | Propio usuario, admin o rh    |
| GET    | `/api/gamification/points/rules`               | Autenticado                   |
| GET    | `/api/gamification/leaderboard`                | Autenticado                   |
| GET    | `/api/gamification/me`                         | Autenticado                   |
| POST   | `/api/gamification/challenge`                  | Autenticado                   |
| POST   | `/api/courses/contents/:contentId/complete`    | Autenticado                   |
| GET    | `/api/courses/:courseId/progress`              | Autenticado                   |
| GET    | `/api/gamification/rewards/:userId`            | Propio usuario, admin o rh    |
| GET    | `/api/gamification/rewards`                    | Autenticado                   |
| GET    | `/api/gamification/level/:userId`              | Propio usuario, admin o rh    |
| GET    | `/api/gamification/levels`                     | Autenticado                   |
| GET    | `/api/gamification/performance/:userId`        | Propio usuario, admin o rh    |
| GET    | `/api/gamification/recommendations/:userId`    | Propio usuario, admin o rh    |
| GET    | `/api/notifications`                           | Autenticado (solo lo propio)  |
| PATCH  | `/api/notifications/:id/leida`                 | Autenticado (solo lo propio)  |
| GET    | `/api/notifications/eventos/estado`            | Solo admin                    |
| GET    | `/api/simulations`                             | Autenticado (filtrado por rol) |
| POST   | `/api/simulations/:id/complete`                | Autenticado                   |
| GET    | `/api/gamification/reports/performance`        | Solo rh o admin               |
| GET    | `/api/gamification/reports/filters`            | Solo rh o admin               |
| POST   | `/api/gamification/reports/performance/export` | Solo rh o admin               |
| GET    | `/api/gamification/reports/exports/:id`        | Solo rh o admin               |
| GET    | `/api/gamification/security/anomalies`         | Solo security o admin         |
| GET    | `/api/gamification/security/anomalies/:id`     | Solo security o admin         |
| PATCH  | `/api/gamification/security/anomalies/:id/status` | Solo security o admin      |
| GET    | `/api/gamification/security/audit`             | Solo security o admin         |
| GET    | `/api/gamification/security/rules`             | Solo security o admin         |
| PATCH  | `/api/gamification/users/:id/adjust`           | Solo admin                    |

`GET /points/:userId` acepta `?page=1&limit=20` y devuelve el total acumulado
junto al detalle paginado del historial.

`/performance/:userId` y `/recommendations/:userId` devuelven la misma
informacion de refuerzo por dos caminos distintos, y conviene saber cual usar:

| | `/performance` | `/recommendations` |
|---|---|---|
| Como se arma | se calcula en el request (seis consultas) | se lee de `user_recommendations` (una consulta) |
| Cuando se calcula | cuando alguien mira | cuando ocurre `quiz.approved` o `simulation.completed` |
| Exactitud | siempre al dia | puede estar unos segundos atras |
| Para que | la pantalla "Mi desempeno" completa | el bloque de refuerzos del dashboard |

`/api/notifications` NO recibe `:userId`: el id sale del token. Una notificacion
es del dueno y de nadie mas, ni siquiera de un admin, asi que no hay ningun
parametro que manipular.

### Como se asignan los puntos

1. Una accion del usuario (completar leccion, superar desafio, decidir en una
   simulacion) inserta un evento en `event_outbox` y responde de inmediato.
2. Un worker toma el evento y ejecuta la regla correspondiente de
   `points_rules`.
3. La regla inserta un movimiento en `points_ledger`, que es inmutable.
4. `users.total_points` se recalcula desde el historial, nunca se incrementa
   a mano.

Cada movimiento lleva una `idempotency_key`, asi que reintentar un evento no
duplica puntos. Las reglas se editan en la tabla `points_rules` sin tocar codigo.

### Como se otorgan las recompensas

1. Tras cada `points_assigned`, `course.completed` o `quiz.approved`, el motor
   revisa **todas** las recompensas activas de `rewards_catalog`.
2. Cada recompensa define un `condition_type` y un umbral en `condition_params`:
   `points_total`, `lessons_completed`, `courses_completed`, `quizzes_approved`
   o `quiz_streak`.
3. Si la condicion se cumple, se inserta en `user_rewards` **con un snapshot**
   del nombre, la descripcion y el icono tal como estaban en ese momento.
4. Editar o eliminar la recompensa del catalogo no altera lo ya otorgado.

Las no repetibles se otorgan una sola vez; las repetibles, una vez por logro
que las dispara. Ambos casos se controlan con `dedupe_key`, el mismo patron que
usa `points_ledger`.

Para agregar un tipo de condicion nuevo: una entrada en `CALCULADORES`
(`rewards.service.js`) y un valor mas en el CHECK de la migracion `006`.

### Como se calcula el nivel

1. `levels_config` guarda, por nivel, el **limite inferior** de puntos
   (`min_points`). El limite superior es el del nivel siguiente menos uno, asi
   que no puede haber huecos ni solapamientos.
2. El nivel es el mayor cuyo `min_points` no supera el total del usuario, leido
   de `v_user_points`. **Es derivado**: cambiar un umbral cambia el nivel que
   ve el usuario, sin migrar datos.
3. `users.level` es solo cache, igual que `total_points`. Se recalcula ante
   cada `points_assigned` y nunca se lee como fuente de verdad.
4. Al cruzar un umbral se inserta en `user_level_history` (inmutable, con
   snapshot del nombre y el umbral vigentes) y se emite `level_up`.

Un movimiento grande puede saltar varios niveles: se registran todos los
intermedios, para que el historial pueda responder cuando se alcanzo cada uno.

Para cambiar la escalera no hace falta tocar codigo: es un UPDATE sobre
`levels_config`.

### Como se generan las recomendaciones

1. `recommendation_rules` define el umbral (`score_threshold`, por defecto 70),
   si las reprobadas cuentan siempre y cuantas sugerencias devolver.
2. Una evaluacion es **area de oportunidad** si nunca se aprobo, o si su
   **mejor** puntaje quedo por debajo del umbral. Se mira el mejor y no el
   ultimo: quien saco 45 y despues 90 ya domina el tema.
3. Por cada area se sugieren lecciones **del mismo curso** que el usuario
   todavia no completo. El enlace evaluacion-curso sale de
   `quiz_attempts.course_id`, que la migracion 003 agrego para esto.
4. La evolucion compara los intentos recientes contra los anteriores **del
   mismo usuario**. No se usa ningun dato de terceros, ni promedios globales
   ni rankings.

El modulo es de solo lectura: no escribe en `quiz_attempts` ni en
`lesson_progress`. Cambiar la exigencia de la organizacion es un UPDATE sobre
`recommendation_rules`, no un despliegue.

### Dos tipos de evaluacion, y por que conviene saberlo

El portal tiene dos cosas que parecen lo mismo y no lo son:

| | Minijuegos | Simulaciones guiadas |
|---|---|---|
| Donde vive el contenido | Escrito a mano en el componente React | En la base: `simulations` + `simulation_steps` + `simulation_options` |
| Agregar uno nuevo | Programar una pantalla | `POST /api/simulations` y sus pasos, sin tocar codigo |
| Cuales son | Phishing, Contrasenas, Wi-Fi, Ingenieria Social, Proteccion de Datos | Las que cargue un instructor (la 024 siembra una de ejemplo) |
| Como puntuan | `challenges.points_reward`, al ganar | `simulation_options.points_awarded`, opcion por opcion |
| Registro del intento | `POST /api/gamification/challenge` | `POST /api/simulations/:id/complete` |

Las dos terminan en `quiz_attempts`, que es lo que alimenta el resumen de
desempeno, las recomendaciones y la racha de evaluaciones aprobadas.

En las simulaciones el puntaje **se calcula en el servidor** a partir de las
opciones elegidas: el porcentaje sale de comparar lo obtenido contra la mejor
opcion de cada paso. Aceptarlo del cliente permitiria aprobar mandando
`{"score": 100}` sin jugar.

## Reparto del sprint

| Historia                                    | Responsable | Rama                          |
|---------------------------------------------|-------------|-------------------------------|
| Asignacion automatica de puntos              | Santi       | `feat/puntos-automaticos`     |
| Recompensas e insignias por logros           | Santi       | `feat/recompensas-insignias`  |
| Nivel actual y progreso al siguiente nivel   | Companero   | `feat/niveles`                |
| Recomendaciones personalizadas               | Companero   | `feat/recomendaciones`        |

### Orden obligatorio

Las cuatro historias dependen de la infraestructura que introduce **puntos
automaticos**: `points_ledger`, `quiz_attempts`, `lesson_progress`, el bus de
eventos y el middleware `selfOrRoles`. Esa historia se mergea primero; las otras
tres se pueden desarrollar en paralelo despues.

## Contrato compartido (leer antes de tocar gamificacion)

Todo el modulo se apoya en las mismas piezas. Respetar estos puntos evita
conflictos de merge y datos inconsistentes.

### 0. Reportes: se leen los servicios, no las tablas

El modulo de reportes (`reports.service.js`) no sabe cuantos puntos vale una
leccion, ni en que puntaje empieza el nivel 3, ni que desbloquea una insignia.
Pide todo eso a quien ya lo sabe:

| Dato | A quien se le pide |
|------|--------------------|
| Puntos | `points.service.obtenerTotalesPorUsuarios()` |
| Nivel | `levels.service.calcularProgreso()` |
| Insignias | `rewards.service.obtenerResumenPorUsuarios()` |

El detalle que hace que esto no sea lento: `calcularProgreso` es una funcion
**pura**. Se pide la escalera una sola vez y se aplica en memoria a los 50
usuarios de la pagina, en lugar de llamar a `obtenerNivelDeUsuario()` cincuenta
veces. Se reutiliza la regla sin pagar N+1 consultas.

Si manana cambian los umbrales de nivel o las reglas de puntuacion, el modulo
de reportes no se toca. Hay una prueba que lo verifica: mueve un umbral de
`levels_config` y comprueba que el nivel del reporte cambia solo.

Las exportaciones se auditan en `report_exports` (quien, que filtros, cuando) y
**esos campos nunca salen por la API**: el endpoint de estado devuelve solo id,
formato, estado y cantidad de filas.

### 0.5 Seguridad: deteccion de abuso y auditoria

**Deteccion por dos caminos, a proposito.** En tiempo real, `anomalies.service`
escucha `points_assigned` y evalua cada asignacion contra los umbrales de
`anomaly_rules`. Ademas, un job cada 15 minutos (`ANOMALY_JOB_INTERVAL_MINUTES`)
reevalua la ventana reciente. El segundo camino existe porque una deteccion de
abuso que depende de que ningun mensaje de la cola se pierda no es una
deteccion de abuso.

Los dos escriben por la misma funcion y comparten la clave de deduplicacion
(`rule_triggered` + el `points_ledger.id` que disparo), asi que ejecutar ambos
sobre el mismo movimiento produce **una sola alerta**.

Sobre "la ventana no procesada": no hay marca de agua del ultimo movimiento
revisado. Se reevalua la ventana reciente y se confia en la deduplicacion. Una
marca de agua se rompe de dos formas conocidas: si el job muere a mitad de
camino queda adelantada sobre trabajo que no se hizo, y si un movimiento entra
con fecha anterior a la marca (un reintento demorado) no se revisa nunca.

**Inmutabilidad parcial.** `anomaly_events` no admite DELETE ni UPDATE de
ninguna columna **salvo `status`**: un trigger compara fila contra fila. La
evidencia de una alerta no se reescribe; para cerrarla se cambia el estado, y
cada cambio deja una fila en `anomaly_status_history` con quien y cuando.

**Todo ajuste manual se audita, sin excepcion.** `PATCH /users/:id/adjust`
exige `reason` y escribe en `audit_log` (INSERT-only). El endpoint viejo
`POST /badges/assign` tambien lo exige ahora: era la puerta lateral por la que
se podia otorgar una insignia a mano sin dejar rastro.

**Separacion de funciones.** El rol `security` lee el panel pero NO puede
ejecutar ajustes (eso es solo de `admin`). Darle a quien investiga la capacidad
de modificar lo investigado anula el control.

**El nivel se ajusta otorgando puntos, no escribiendo `users.level`.** El nivel
es derivado; escribir la columna a mano dura hasta la siguiente asignacion de
puntos, que la recalcula y la pisa. Un ajuste que se deshace solo no es un
ajuste.

### 1. La fuente de verdad es `points_ledger`

`users.total_points` y `users.level` son **cache**, no fuente de verdad. Nadie
debe hacer `UPDATE users SET total_points = total_points + X`: asi se
desincronizaban antes. El total se lee de la vista `v_user_points`, que suma el
historial.

Lo mismo aplica al nivel: se calcula contra `levels_config`, no se lee de
`users.level`.

### 2. Para reaccionar a puntos nuevos, suscribirse al evento

El servicio de puntos emite `points_assigned` cada vez que otorga puntos. Para
recalcular el nivel o evaluar recompensas, **no hay que modificar
`points.service.js`**: alcanza con suscribirse desde el archivo propio.

```js
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');

eventBus.subscribe(EVENTOS.POINTS_ASSIGNED, async ({ userId, points, sourceType }) => {
    // recalcular nivel, evaluar recompensas, etc.
});
```

El nombre del evento se toma de `src/events/catalogo.js`, nunca se escribe a
mano. El servicio se agrega a la lista de `src/events/suscriptores.js`, que es
el unico lugar que decide quien participa del bus.

Si el handler lanza una excepcion, el evento se reintenta solo con backoff, asi
que **el handler tiene que ser idempotente**. Ver "Arquitectura basada en
eventos" mas arriba para el detalle completo.

### 3. Control de acceso por rol

Los endpoints de `/api/gamification/*` que reciben un `:userId` usan siempre el
mismo middleware, que ya resuelve la regla propio-usuario / admin / rh:

```js
const { selfOrRoles } = require('../middlewares/role.middleware');

router.get('/level/:userId',
    verifyToken(),
    selfOrRoles(['admin', 'rh'], 'userId'),
    controlador
);
```

Devuelve 403 cuando corresponde, sin que haya que repetir la logica.

### 4. Tablas disponibles

| Tabla            | Contenido                                                        |
|------------------|------------------------------------------------------------------|
| `points_ledger`  | Historial inmutable de puntos. Solo INSERT                        |
| `v_user_points`  | Vista con el total recalculado por usuario                        |
| `points_rules`   | Reglas de puntuacion configurables                                |
| `lesson_progress`| Lecciones completadas por usuario                                 |
| `quiz_attempts`  | Intentos de evaluacion con `score`, `passed` y `course_id`        |
| `event_outbox`   | Cola de eventos con reintentos                                    |
| `rewards_catalog`| Catalogo de recompensas con condiciones configurables             |
| `user_rewards`   | Historial inmutable de recompensas, con snapshot. Solo INSERT     |
| `levels_config`  | Escalera de niveles: limite inferior de puntos de cada tramo      |
| `user_level_history` | Historial inmutable de niveles alcanzados, con snapshot       |
| `recommendation_rules` | Umbral y limites del motor de recomendaciones               |
| `teams`          | Equipos/areas de la organizacion; `users.team_id` apunta aca      |
| `report_exports` | Auditoria de exportaciones y estado de los jobs asincronos        |
| `anomaly_rules`  | Umbrales de deteccion: puntos por ventana de tiempo               |
| `anomaly_events` | Alertas detectadas. Solo `status` es modificable                  |
| `anomaly_status_history` | Quien cambio el estado de una alerta y cuando             |
| `audit_log`      | Ajustes manuales de puntos/nivel/insignias. Solo INSERT           |
| `notifications`  | Bandeja de avisos, con `dedupe_key` UNIQUE contra reintentos      |
| `user_recommendations` | Proyeccion de refuerzos que mantienen los eventos. Descartable: se reconstruye sola |

`quiz_attempts.course_id` guarda a que curso pertenecia la evaluacion en el
momento del intento. `simulations` y `challenges` tambien tienen `course_id`
nullable, agregado para que las recomendaciones puedan relacionar una
evaluacion con lecciones de refuerzo del mismo curso.

### 5. Rangos de migraciones

Santi usa `001`-`019`, el companero `020`-`039`. Una migracion ya mergeada a
`main` no se edita: se corrige con una nueva.

---

## Estructura

```
.
|-- package.json                Punto de entrada unico: setup, build, serve, test
|-- docker-compose.yml          PostgreSQL de desarrollo
|-- migrations/                 Migraciones SQL numeradas (leer su README)
|-- schema.sql                  Esquema historico (NO editar, ver migrations/)
|-- human-firewall-backend/
|   `-- src/
|       |-- app.js              Monta la API y sirve el build de la interfaz
|       |-- server.js           Arranque: conecta el bus y escucha el puerto
|       |-- config/             Conexion a BD, Passport, seeds
|       |-- controllers/        Manejadores de ruta
|       |-- events/
|       |   |-- catalogo.js     Nombres y payloads de todos los eventos
|       |   `-- suscriptores.js Que servicios se conectan al bus
|       |-- middlewares/        Autenticacion, roles, rate limiting
|       |-- routes/             Definicion de endpoints
|       |-- services/
|       |   |-- eventBus.js     Publicacion, cola outbox, worker y reintentos
|       |   `-- ...             Resto de la logica de negocio
|       `-- utils/              Hashing y tokens
`-- human-firewall-frontend/
    |-- dist/                   Build compilado; lo sirve el backend (no se versiona)
    `-- src/
        |-- lib/api.js          Cliente HTTP unico, mismo origen
        |-- components/ui/      Componentes reutilizables
        `-- pages/              Vistas y simulaciones
```

---

## Deuda tecnica

### Corregido

| # | Fallo | Como se corrigio |
|---|-------|------------------|
| 1 | `simulation.submitDecision` permitia sumar puntos ilimitados reenviando la misma opcion | Cada opcion paga una sola vez por usuario, via `idempotency_key` |
| 2 | `completeChallenge` no usaba transaccion y podia dejar al usuario sin sus puntos sin reintento posible | Reescrito sobre el ledger, con `ON CONFLICT DO NOTHING` y evento reintentable |
| 8 | `middlewares/role.middleware.js` estaba vacio | Implementado con `selfOrRoles` y `requireRoles` |
| 10 | `http://localhost:3000` escrito a mano en el frontend | Cliente unico en `src/lib/api.js`. Al pasar a monolito se migraron tambien las 4 paginas de autenticacion, que seguian usando `axios` crudo, y el cliente pasó a mismo origen |
| - | La interfaz y la API eran dos despliegues separados que tenian que conocerse entre si | Monolito: Express sirve el build de React. Un artefacto, un puerto, sin CORS |
| - | `axios`, `react-router-dom` y `lucide-react` estaban en `devDependencies` siendo dependencias de ejecucion | Movidas a `dependencies`: con `npm ci --omit=dev` el build fallaba |
| 11 | No habia framework de pruebas | 224 pruebas contra PostgreSQL real (`npm test`), en 7 suites |
| - | Los modulos se llamaban entre si dentro del request: `simulation.controller` conocia a `points.service`, y agregar cualquier reaccion nueva obligaba a editar el controlador que provoco el hecho | Arquitectura basada en eventos: publican hechos, reaccionan los suscriptores. Ver la seccion correspondiente |
| - | La guarda "esta evaluacion ya cobro" de `asignarPuntosPorQuiz` usaba `rowCount`, que PGlite no expone: funcionaba en produccion pero **ninguna prueba la ejercitaba** (era `undefined > 0`) | Cambiada a `rows.length`, equivalente en node-postgres y verificable en las pruebas |
| - | Los juegos usaban `.catch(e => e)` y mostraban "ganaste" aunque los puntos fallaran | Ahora se registra el error en consola y no se muestra un exito falso |
| - | `mysql2` como dependencia en un proyecto 100% PostgreSQL | Eliminada |
| 5 | `user_badges.badge_id` con `ON DELETE CASCADE`: borrar una insignia borraba el historial de todos los usuarios | Se elimino la clave foranea y se guarda un snapshot; el historial ya no depende del catalogo |
| - | Las insignias nunca se otorgaban solas, solo manualmente por un admin | Motor de evaluacion automatico sobre eventos |
| - | Un curso nunca se marcaba como finalizado | `completeLesson` cierra la asignacion y emite `course.completed` |
| - | Un desafio perdido no se registraba en ningun lado y el motor de recomendaciones se quedaba sin datos | El resultado real viaja al backend; el intento se guarda con su `passed` y `score` verdaderos |
| - | El juego de ingenieria social otorgaba los puntos completos tambien al caer en la estafa | El endpoint ya no da el resultado por aprobado: lo recibe del cliente |
| 9 | `users.level` nunca se calculaba y el dashboard mostraba "Nivel 1 / Cinturon Blanco" fijo para todos | Nivel derivado de `points_ledger` + `levels_config`, con la cache sincronizada en cada `points_assigned` |
| 3 | `config/db.js` desactivaba la verificacion TLS de todo el proceso Node | Ya estaba corregido en `9f48d97`: el SSL se decide por URL y queda acotado al pool |

### Pendiente

| # | Fallo | Nota |
|---|-------|------|
| 4 | `JWT_SECRET` cae a `'secret'` si falta la variable | Mitigado con un aviso al arrancar; falta quitar el fallback |
| 6 | `init_db.js` desincronizado con `schema.sql` | Reemplazar por el runner de `migrations/` |
| 7 | `auth.forgotPassword` devuelve el error real y permite enumerar usuarios registrados | |
