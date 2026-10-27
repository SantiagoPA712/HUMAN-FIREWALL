# Servicio de identidad

Cuentas, autenticacion, roles, perfil propio, equipos e invitaciones. Es el
dueno de `users`: cualquier otro servicio que necesite saber algo de una
cuenta (si existe, su correo, su idioma, los RH de su equipo) lo pide por
`index.js`.

La ficha completa (endpoints, tablas, eventos, estructura) esta en
[`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#identidad)
y el contrato navegable en `/api/docs`.

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Un endpoint nuevo de cuentas | `controller/user.routes.js` + `controller/user.controller.js`, su DTO en `controller/dto.js` y su operacion en `contract/openapi.js` |
| Cambiar la politica de contrasenas o los roles validos | `domain/usuario.js` (lo usan registro, reset e invitaciones) |
| Una consulta nueva sobre `users` | `infrastructure/persistence/usuarios.repositorio.js` |
| Que otro servicio pueda preguntar algo de una cuenta | exponerlo en `index.js`; el otro servicio lo usa desde su `infrastructure/client/identidad.cliente.js` |
| Registrar una accion critica en data.logs | `infrastructure/client/seguridad.cliente.js` -> `registrarAccion()` |
| Una consulta de invitaciones o de recuperacion de contrasena | `infrastructure/persistence/invitaciones.repositorio.js` / `recuperacion.repositorio.js` |
| Una regla de invitaciones (vigencia, estados, reenvio) | `domain/invitacion.js` |
| Una variable de entorno (vigencias, Google) | `config/configuracion.js` |
| Una tabla o columna nueva | `migrations/servicios/identidad/002_....sql` (y siguientes) con `CREATE TABLE identidad.<tabla>`, y declararla en `manifiesto.js` |
| La base de datos del servicio | `config/configuracion.js` -> `baseDeDatos` (variable `IDENTIDAD_DATABASE_URL`) |

## Reglas que no hay que romper

- La contrasena nunca viaja al log, ni enmascarada en el login fallido.
- `forgot-password` responde siempre lo mismo: no revela que correos tienen cuenta.
- Las columnas `total_points` y `level` de `users` son cache de gamificacion:
  este servicio no las escribe.
- El token de una invitacion viaja en el cuerpo, nunca en la URL, y en la base
  solo queda su SHA-256.
