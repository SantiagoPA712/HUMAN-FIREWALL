# Servicio de gamificacion

Puntos, recompensas, niveles, ranking y recomendaciones. La fuente de verdad
de los puntos es el historial inmutable `points_ledger`; `users.total_points`
y `users.level` son una cache que mantiene este servicio (la unica escritura
en una tabla ajena, declarada en `manifiesto.js`).

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#gamificacion).

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Una regla de puntos | la tabla `points_rules` (es configurable), o `application/points.service.js` si cambia la logica |
| Un tipo de condicion de recompensa | `application/rewards.service.js` -> `CALCULADORES` (si mide datos de otro servicio, por su cliente) |
| Umbrales de nivel | la tabla `levels_config` |
| Reaccionar a un evento nuevo | `registrarHandlers()` del servicio de aplicacion que corresponda, y agregarlo a `consume` del manifiesto |
| Una consulta de un endpoint | `infrastructure/persistence/gamificacion.repositorio.js` |
| Una consulta de puntos, niveles, recompensas o recomendaciones | `infrastructure/persistence/puntos`, `niveles`, `recompensas` o `recomendaciones.repositorio.js` |
| Una regla pura (calculo de nivel, de puntos, areas de oportunidad) | `domain/nivel.js`, `domain/puntos.js`, `domain/recomendacion.js`, `domain/recompensa.js` |
| Una tabla o columna nueva | `migrations/servicios/gamificacion/002_....sql` (y siguientes) con `CREATE TABLE gamificacion.<tabla>`, y declararla en `manifiesto.js` |
| La base de datos del servicio | `config/configuracion.js` -> `baseDeDatos` (variable `GAMIFICACION_DATABASE_URL`) |

## Reglas que no hay que romper

- Todo handler es idempotente: el worker reintenta.
- `points.service` no se suscribe a `simulation.completed` (pagaria dos veces).
- Los ajustes manuales los ordena seguridad por el contrato de este servicio
  (`registrarMovimiento`, `otorgarRecompensa`); seguridad no toca estas tablas.
- Las recomendaciones y el resumen de desempeno leen intentos y avance de
  cursos con un JOIN (lectura declarada). Si alguna vez se separa el
  despliegue, hay que reemplazarlo por una proyeccion propia alimentada por
  eventos.
