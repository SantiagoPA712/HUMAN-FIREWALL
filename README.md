# Human Firewall

Plataforma de concientizacion en ciberseguridad: cursos, simulaciones interactivas y
gamificacion (puntos, niveles, insignias y rankings).

- **Backend:** Node.js + Express 5 + PostgreSQL (Supabase)
- **Frontend:** React 19 + Vite + TailwindCSS 4

---

## Puesta en marcha

Requisitos: Node.js 18 o superior y una base PostgreSQL accesible.

### 1. Backend

```bash
cd human-firewall-backend
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Rellenar `.env` con la cadena de conexion real y un `JWT_SECRET`. Para generarlo:

```bash
openssl rand -hex 32
```

Aplicar las migraciones de `migrations/` en orden numerico desde el editor SQL de
Supabase, y luego levantar el servidor:

```bash
npm run dev        # http://localhost:3000
```

### 2. Frontend

```bash
cd human-firewall-frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

### 3. Pruebas

```bash
cd human-firewall-backend
npm test
```

Corren contra PostgreSQL real (PGlite, compilado a WebAssembly): no necesitan
base levantada ni credenciales, y no tocan Supabase. Ver `tests/README.md`.

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

## Reparto del sprint

| Historia                                              | Responsable | Rama                          |
|-------------------------------------------------------|-------------|-------------------------------|
| Asignacion automatica de puntos                        | Santi       | `feat/puntos-automaticos`     |
| Asignacion de recompensas e insignias                  | Santi       | `feat/recompensas-insignias`  |
| (por definir)                                          | Companero   | -                             |
| (por definir)                                          | Companero   | -                             |

### Dependencias entre historias

El motor de recompensas consume el evento `points_assigned` que emite el motor de
puntos. Por eso **puntos va primero** y recompensas despues.

Si alguna de las historias del companero lee la tabla `points_ledger` o
`user_rewards`, hay que acordar el esquema **antes** de empezar a codear, no en el
merge.

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

### Pendiente

| # | Fallo | Nota |
|---|-------|------|
| 3 | `config/db.js` desactiva la verificacion TLS de **todo** el proceso Node | Prioridad alta, fuera del alcance de estas historias |
| 4 | `JWT_SECRET` cae a `'secret'` si falta la variable | Mitigado con un aviso al arrancar; falta quitar el fallback |
| 5 | `user_badges.badge_id` usa `ON DELETE CASCADE`: borrar una insignia borra el historial de todos | Se corrige en la HU de recompensas |
| 6 | `init_db.js` desincronizado con `schema.sql` | Reemplazar por el runner de `migrations/` |
| 7 | `auth.forgotPassword` devuelve el error real y permite enumerar usuarios registrados | |
| 9 | `users.level` nunca se calcula; el dashboard lo muestra fijo en 1 | Depende de la HU de niveles |
