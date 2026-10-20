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
| Un endpoint nuevo de cuentas | `api/user.routes.js` + `api/user.controller.js`, su DTO en `api/esquemas.js` y su operacion en `contrato/openapi.js` |
| Cambiar la politica de contrasenas o los roles validos | `dominio/usuario.js` (lo usan registro, reset e invitaciones) |
| Una consulta nueva sobre `users` | `infraestructura/usuarios.repositorio.js` |
| Que otro servicio pueda preguntar algo de una cuenta | exponerlo en `index.js`; el otro servicio lo usa desde su `infraestructura/clientes/identidad.cliente.js` |
| Registrar una accion critica en data.logs | `infraestructura/clientes/seguridad.cliente.js` -> `registrarAccion()` |

## Reglas que no hay que romper

- La contrasena nunca viaja al log, ni enmascarada en el login fallido.
- `forgot-password` responde siempre lo mismo: no revela que correos tienen cuenta.
- Las columnas `total_points` y `level` de `users` son cache de gamificacion:
  este servicio no las escribe.
- El token de una invitacion viaja en el cuerpo, nunca en la URL, y en la base
  solo queda su SHA-256.
