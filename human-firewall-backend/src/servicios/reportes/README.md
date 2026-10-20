# Servicio de reportes

Reporte de desempeno para RH (con exportacion CSV/PDF), reportes automaticos
programados y consolidado organizacional para gerencia. Es un servicio de
**lectura analitica**: agrega datos de varios servicios en SQL (lecturas
declaradas en `manifiesto.js`), pero nunca escribe fuera de sus tablas y no
recalcula reglas ajenas: puntos, niveles e insignias se los pide a
gamificacion por su contrato.

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#reportes).

Sus rutas cuelgan de `/api/gamification/reports` por compatibilidad con el
frontend; antes estaban dentro de `gamification.routes.js`.

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Un filtro nuevo del reporte | `aplicacion/reports.service.js` -> `validarFiltros()` y su esquema en `api/esquemas.js` |
| Un tipo de reporte programado | `aplicacion/scheduledReports.service.js` (`TIPOS`) |
| Un KPI organizacional | `aplicacion/orgReports.service.js` (`KPIS`) |
| Avisar a alguien | `infraestructura/clientes/notificaciones.cliente.js` |

## Reglas que no hay que romper

- El rol se verifica en el middleware: un 403 no ejecuta ninguna consulta ni
  persiste nada.
- La auditoria de una exportacion (quien, que filtros) nunca sale por la API.
- El consolidado organizacional lee snapshots, nunca agrega en vivo sobre
  `points_ledger`.
