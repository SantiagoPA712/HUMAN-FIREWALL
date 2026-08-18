# Human Firewall

Plataforma de concientizacion en ciberseguridad: cursos, simulaciones interactivas y
gamificacion (puntos, niveles, insignias y rankings).

- **Backend:** Node.js + Express 5 + PostgreSQL (Supabase)
- **Frontend:** React 19 + Vite + TailwindCSS 4

---

## Puesta en marcha

Requisitos: **Node.js 18 o superior** y **Docker Desktop**. Nada mas: la base de
datos la levanta el propio repositorio, no hace falta instalar PostgreSQL ni
crear cuenta en ningun servicio.

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

### 2. Backend

```bash
cd human-firewall-backend
npm install
npm run setup      # crea el .env con un JWT_SECRET generado al azar
npm run dev        # aplica las migraciones pendientes y arranca en :3000
```

No hay que rellenar nada a mano ni ejecutar SQL: `npm run setup` deja el `.env`
listo apuntando al contenedor, y `npm run dev` aplica solo las migraciones que
falten antes de levantar el servidor.

### 3. Frontend

En otra terminal:

```bash
cd human-firewall-frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

### Despues de cada `git pull`

```bash
cd human-firewall-backend && npm install && npm run dev
```

Si la rama traia migraciones nuevas, `npm run dev` las detecta y las aplica
antes de arrancar. No hay que acordarse de nada.

### Si preferis usar Supabase en vez del contenedor

Reemplaza `DATABASE_URL` en tu `.env` por la cadena del panel
(*Settings > Database > Connection string*, modo URI). El runner de migraciones
funciona igual: si la base ya tenia las tablas creadas a mano, las detecta y no
las vuelve a aplicar.

### 3. Pruebas

```bash
cd human-firewall-backend
npm test
```

Corren contra PostgreSQL real (PGlite, compilado a WebAssembly): no necesitan
base levantada ni credenciales, y no tocan Supabase. Son 56 pruebas sobre
migraciones, asignacion de puntos y motor de recompensas. Ver `tests/README.md`.

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

`GET /points/:userId` acepta `?page=1&limit=20` y devuelve el total acumulado
junto al detalle paginado del historial.

### Como se asignan los puntos

1. Una accion del usuario (completar leccion, superar desafio) inserta un
   evento en `event_outbox` y responde de inmediato.
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

eventBus.subscribe('points_assigned', async ({ userId, points, sourceType }) => {
    // recalcular nivel, evaluar recompensas, etc.
});
```

Registrar el handler en `server.js`, junto a `pointsService.registrarHandlers()`.
Si el handler lanza una excepcion, el evento se reintenta solo con backoff.

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
|-- migrations/                 Migraciones SQL numeradas (leer su README)
|-- schema.sql                  Esquema historico (NO editar, ver migrations/)
|-- human-firewall-backend/
|   `-- src/
|       |-- config/             Conexion a BD, Passport, seeds
|       |-- controllers/        Manejadores de ruta
|       |-- middlewares/        Autenticacion, roles, rate limiting
|       |-- routes/             Definicion de endpoints
|       |-- services/           Logica de negocio
|       `-- utils/              Hashing y tokens
`-- human-firewall-frontend/
    `-- src/
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
| 10 | `http://localhost:3000` escrito a mano en 6 archivos del frontend | Cliente unico en `src/lib/api.js` con `VITE_API_URL` |
| 11 | No habia framework de pruebas | 33 pruebas contra PostgreSQL real (`npm test`) |
| - | Los juegos usaban `.catch(e => e)` y mostraban "ganaste" aunque los puntos fallaran | Ahora se registra el error en consola y no se muestra un exito falso |
| - | `mysql2` como dependencia en un proyecto 100% PostgreSQL | Eliminada |
| 5 | `user_badges.badge_id` con `ON DELETE CASCADE`: borrar una insignia borraba el historial de todos los usuarios | Se elimino la clave foranea y se guarda un snapshot; el historial ya no depende del catalogo |
| - | Las insignias nunca se otorgaban solas, solo manualmente por un admin | Motor de evaluacion automatico sobre eventos |
| - | Un curso nunca se marcaba como finalizado | `completeLesson` cierra la asignacion y emite `course.completed` |

### Pendiente

| # | Fallo | Nota |
|---|-------|------|
| 3 | `config/db.js` desactiva la verificacion TLS de **todo** el proceso Node | Prioridad alta, fuera del alcance de estas historias |
| 4 | `JWT_SECRET` cae a `'secret'` si falta la variable | Mitigado con un aviso al arrancar; falta quitar el fallback |
| 6 | `init_db.js` desincronizado con `schema.sql` | Reemplazar por el runner de `migrations/` |
| 7 | `auth.forgotPassword` devuelve el error real y permite enumerar usuarios registrados | |
| 9 | `users.level` nunca se calcula; el dashboard lo muestra fijo en 1 | Depende de la HU de niveles |
