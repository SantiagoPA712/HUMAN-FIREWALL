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

## Deuda tecnica conocida

Fallos detectados y pendientes de correccion:

1. `simulation.submitDecision` permite sumar puntos ilimitados reenviando la misma opcion.
2. `gamification.completeChallenge` no usa transaccion: si falla el UPDATE, el usuario
   pierde los puntos sin poder reintentar.
3. `config/db.js` desactiva la verificacion TLS de todo el proceso Node.
4. `JWT_SECRET` tiene un fallback a `'secret'` si falta la variable de entorno.
5. `user_badges.badge_id` usa `ON DELETE CASCADE`: borrar una insignia del catalogo
   borra el historial de todos los usuarios.
6. `init_db.js` esta desincronizado con `schema.sql` (le faltan `challenges` y
   `user_challenge_results`).
7. `auth.forgotPassword` devuelve el mensaje de error real, lo que permite enumerar
   usuarios registrados.
8. `middlewares/role.middleware.js` esta vacio.
9. `users.level` nunca se calcula; el dashboard lo muestra fijo en 1.
10. El frontend tiene `http://localhost:3000` escrito a mano en 6 archivos.
11. No hay framework de pruebas configurado.
