# Pruebas

Corren contra PostgreSQL de verdad, no contra mocks: usan PGlite, que es
PostgreSQL compilado a WebAssembly. No hace falta tener una base levantada ni
credenciales, y no tocan la base de Supabase.

```bash
npm install
npm test
```

| Archivo                   | Que verifica                                                        |
|---------------------------|---------------------------------------------------------------------|
| `migraciones.test.mjs`    | Que las migraciones apliquen y que las restricciones funcionen: trigger de inmutabilidad, idempotencia, CHECKs, recalculo de totales |
| `gamificacion.test.mjs`   | El flujo asincrono completo: evento encolado, puntos asignados por regla, sin duplicados, backoff ante fallos, paginacion |
| `recompensas.test.mjs`    | Migracion de `badges` sin perder datos, otorgamiento automatico por condicion, repetibles vs no repetibles, y que el snapshot sobreviva a editar o borrar el catalogo |
| `seguridad.test.mjs`      | Que la deteccion no ocurra dentro de la accion que otorga los puntos, la evidencia con el origen de cada movimiento, la inmutabilidad parcial de las alertas (solo status), el historial de estados sin sobrescribir, que un ajuste sin motivo NO se ejecute, y la idempotencia del job de respaldo |
| `reportes.test.mjs`       | Que el 403 salga del middleware sin consultar la base, validacion de filtros con detalle por campo, paginacion, agregados por equipo, exportacion CSV/PDF respetando filtros, camino asincrono por umbral, y que la auditoria nunca salga por la API |
| `simulaciones.test.mjs`   | Listado filtrado por curso asignado, calculo del puntaje sobre la mejor opcion de cada paso, que el score no se acepte del cliente, y que una simulacion terminada alimente el resumen de desempeno |
| `recomendaciones.test.mjs` | Umbral configurable en ambas direcciones, area de oportunidad medida por el mejor puntaje, sugerencias acotadas al curso de la evaluacion floja, tendencia contra el propio historial, aislamiento total entre usuarios y que el modulo no escriba en el historial |
| `eventos.test.mjs`        | La arquitectura de eventos en si: que el catalogo coincida con el cableado real, que las acciones respondan SIN haber ejecutado sus consecuencias, que las consecuencias ocurran al drenar la cola, y que reprocesar un evento no duplique puntos ni avisos |
| `niveles.test.mjs`        | Umbrales y bordes exactos del catalogo, porcentaje medido dentro del nivel, subida automatica con registro de los niveles intermedios, inmutabilidad del historial y que el nivel siga siendo derivado si cambian los umbrales |
| `reportes-automaticos.test.mjs` | Que el 403 de la configuracion no persista nada, que el periodo cubierto sea el ya cerrado (con la clave de semana en anio ISO), que `next_run_at` se adelante al encolar y no dispare dos veces, que reprocesar el evento no duplique el reporte ni reenvie el aviso, que el historico no se pueda editar ni borrar sin politica de retencion explicita, los tres reintentos con backoff, y que el stack trace de un fallo no salga hacia RH |
| `reportes-organizacionales.test.mjs` | Que el 403 no ejecute ninguna agregacion, que la lectura NO toque `points_ledger`, el estado explicito cuando falta el snapshot, la formula de variacion con periodo base 0, la segmentacion por area y el 404 antes de leer snapshots, que el recalculo no sobrescriba los snapshots anteriores, y que la bitacora de consultas sea inmutable y no salga por la API |

Las pruebas de gamificacion inyectan un adaptador de PGlite en lugar del pool
de `pg`, asi que ejercitan el codigo real de `eventBus.js` y `points.service.js`.
