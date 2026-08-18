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
| `recomendaciones.test.mjs` | Umbral configurable en ambas direcciones, area de oportunidad medida por el mejor puntaje, sugerencias acotadas al curso de la evaluacion floja, tendencia contra el propio historial, aislamiento total entre usuarios y que el modulo no escriba en el historial |
| `niveles.test.mjs`        | Umbrales y bordes exactos del catalogo, porcentaje medido dentro del nivel, subida automatica con registro de los niveles intermedios, inmutabilidad del historial y que el nivel siga siendo derivado si cambian los umbrales |

Las pruebas de gamificacion inyectan un adaptador de PGlite en lugar del pool
de `pg`, asi que ejercitan el codigo real de `eventBus.js` y `points.service.js`.
