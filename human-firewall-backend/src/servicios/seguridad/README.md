# Servicio de seguridad

Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y el
registro centralizado e inmutable de acciones criticas (`data.logs`).

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#seguridad).

## Como lo usan los demas servicios

Cualquier servicio registra una accion critica con
`registrarAccion({ req, accion, modulo, recurso, recursoId, antes, despues })`
desde su `infraestructura/clientes/seguridad.cliente.js`. Publica
`audit.log_recorded` y vuelve: el log se escribe fuera del request, enmascara
contrasenas y tokens, y nunca hace fallar la accion original.

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Un tipo de accion o modulo nuevo en data.logs | `aplicacion/dataLogs.service.js` -> `ACCIONES` / `MODULOS` |
| Un umbral de anomalia | la tabla `anomaly_rules` |
| Un tipo de ajuste manual | `aplicacion/audit.service.js` (el ajuste se aplica por el cliente de gamificacion) |

## Reglas que no hay que romper

- Seguridad audita los ajustes; ejecutarlos es solo de admin.
- `data.logs` no se crea, edita ni borra por la API (405). Solo la politica de
  retencion lo purga, y deja evidencia en `data.logs_purges`.
- Lee `points_ledger` para detectar anomalias, pero no lo escribe.
