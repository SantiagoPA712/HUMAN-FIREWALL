# Cambios en los contratos de API

Formato: la version del contrato publico (`info.version` en `/api/docs/openapi.json`)
y que cambio para quien consume la API. Ver [POLITICA.md](POLITICA.md).

## 1.2.0 — 2026-10-27

Base de datos por servicio. Compatible: solo se agrega un campo.

### Nuevo

- `GET /api/notifications/eventos/estado` suma `colas`: cuantas colas de
  eventos lee el worker (una por base de datos). `por_estado` y
  `ultimos_fallidos` ahora suman las colas de todas las bases.

## 1.1.0 — 2026-10-20

HU de perfil editable. Compatible con el frontend actual.

**Consumidores revisados:** `NotificationsPage.jsx` (manda `{ language }` y no
lee la respuesta) y la pantalla nueva `ProfilePage.jsx`.

### Nuevo

- `GET /api/users/me` y la respuesta de `PATCH /api/users/me` traen `full_name`,
  `phone`, `team_name`, `created_at` y `updated_at`.
- `PATCH /api/users/me` acepta `full_name` y `phone` ademas de `language`, y
  ninguno es obligatorio por separado (antes `language` lo era). Tiene que
  venir al menos uno.
- La respuesta del `PATCH` suma `msg`, `sin_cambios` y `cambios` al lado del
  perfil, que sigue plano como antes.

### Cambios de comportamiento

| Endpoint | Antes | Ahora | Por que |
|----------|-------|-------|---------|
| `PATCH /api/users/me` con un campo que no es `full_name`, `phone` ni `language` (por ejemplo `role`) | se ignoraba y respondia 200 | 403 `PROHIBIDO` con `campos` y `editables`, y no se guarda nada | Criterio tecnico 6: que una solicitud manipulada no pase por un guardado exitoso. Ningun consumidor manda otros campos |
| `PATCH /api/users/me` con los mismos valores ya guardados | escribia y movia `updated_at` | 200 con `sin_cambios: true`, sin escribir | Criterio de aceptacion 5 |

## 1.0.0 — 2026-10-20

Primera version publicada del contrato (HU de microservicios por capas y
contratos de API). Hasta ahora la API no tenia contrato escrito: la unica
referencia era el codigo y una coleccion de Postman con 5 de los 80 endpoints.

**Ninguna URL cambio.** Varias rutas pasaron a ser atendidas por otro servicio
(ver `docs/arquitectura/README.md`, seccion 5), sin cambiar su direccion.

### Nuevo

- `GET /api/docs` (Swagger UI) y `GET /api/docs/openapi.json` (contrato OpenAPI 3.1).
- Todos los errores traen `codigo` (`VALIDACION`, `NO_AUTENTICADO`, `PROHIBIDO`,
  `NO_ENCONTRADO`, `CONFLICTO`, `JSON_INVALIDO`, `ERROR_INTERNO`). `msg` se
  conserva igual.
- Los 500 traen `traceId`, el mismo del encabezado `X-Trace-Id`.

### Cambios de comportamiento (compatibles para el frontend actual)

| Endpoint | Antes | Ahora | Por que |
|----------|-------|-------|---------|
| Cualquier 500 | `{ msg: <error.message> }`, con el texto crudo de PostgreSQL | `{ msg: "Error interno del servidor", codigo, traceId }` | No exponer informacion interna |
| `POST /api/auth/forgot-password` con un correo sin cuenta | 400 "El correo no esta registrado" | 200 con el mismo mensaje que si existiera | Evitar la enumeracion de cuentas (deuda tecnica #7) |
| `POST /api/auth/login` con la base caida | 401 con el error de conexion como mensaje | 500 generico | Un error del servidor no es un error de credenciales |
| Rutas con DTO (ver `x-validacion: middleware`) | un dato invalido podia llegar a la base y volver como 500 | 400 con `errores` por campo, antes de tocar la base | Validar la entrada antes de las reglas de negocio |
| Parametros de ruta numericos (`/api/courses/abc`) | 500 (`invalid input syntax for type integer`) | 400 | Idem |
| JSON mal formado | 400 en HTML (pagina de error de Express) | 400 JSON `JSON_INVALIDO` | Formato comun |
| `POST /api/users` con un correo ya registrado | 500 con el nombre del indice | 409 `CONFLICTO` | Idem |
| `POST /api/simulations/{id}/complete` en una simulacion sin puntos | `pasos` contaba solo los pasos con alguna opcion que da puntos, y el score por aciertos daba 0 | `pasos` cuenta todos los pasos | Correccion de una regla de dominio (la encontro la prueba unitaria) |

### Decidido NO cambiar (candidatos a 2.0.0)

- `POST /api/auth/register` con un correo en uso responde **400** con
  `codigo: CONFLICTO`. Lo correcto seria 409, pero el frontend ya interpreta
  ese 400; cambiarlo es incompatible.
- Los nombres de evento mezclan `punto.caso` y `guion_bajo`
  (`lesson.completed`, `points_assigned`). Renombrarlos dejaria huerfanos los
  eventos ya escritos en `event_outbox`.
- Los campos de entrada viejos `points_required` (usar `threshold`) y
  `badge_id` (usar `reward_id`) quedan marcados `deprecated`.
