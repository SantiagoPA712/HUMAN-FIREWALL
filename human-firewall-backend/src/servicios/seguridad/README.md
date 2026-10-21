# Servicio de seguridad

Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y el
registro centralizado e inmutable de acciones criticas (`data.logs`).

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#seguridad).

## Como lo usan los demas servicios

Cualquier servicio registra una accion critica con
`registrarAccion({ req, accion, modulo, recurso, recursoId, antes, despues })`
desde su `infrastructure/client/seguridad.cliente.js`. Publica
`audit.log_recorded` y vuelve: el log se escribe fuera del request, enmascara
contrasenas y tokens, y nunca hace fallar la accion original.

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Un tipo de accion o modulo nuevo en data.logs | `application/dataLogs.service.js` -> `ACCIONES` / `MODULOS` |
| Un umbral de anomalia | la tabla `anomaly_rules` |
| Un tipo de ajuste manual | `application/audit.service.js` (el ajuste se aplica por el cliente de gamificacion) |
| Una consulta | `infrastructure/persistence/anomalias`, `auditoria` o `logs.repositorio.js` |
| Que datos se enmascaran en los logs | `domain/registro.js` |
| Retencion, tamano de pagina, intervalo del job (`LOGS_*`, `ANOMALY_*`) | `config/configuracion.js` |
| Una tabla nueva | migracion `1NN_...sql` con `CREATE TABLE seguridad.<tabla>` y declararla en `manifiesto.js` |

## Reglas que no hay que romper

- Seguridad audita los ajustes; ejecutarlos es solo de admin.
- `data.logs` no se crea, edita ni borra por la API (405). Solo la politica de
  retencion lo purga, y deja evidencia en `data.logs_purges`.
- Lee `points_ledger` para detectar anomalias, pero no lo escribe.
