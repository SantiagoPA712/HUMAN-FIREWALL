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

Las pruebas de gamificacion inyectan un adaptador de PGlite en lugar del pool
de `pg`, asi que ejercitan el codigo real de `eventBus.js` y `points.service.js`.
