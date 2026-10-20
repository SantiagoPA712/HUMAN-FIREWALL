# Servicio de evaluaciones

Simulaciones (pasos, opciones, decisiones), desafios del portal y el
historial de intentos (`quiz_attempts`). El puntaje se calcula SIEMPRE en el
servidor, con las reglas de `dominio/puntaje.js`.

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#evaluaciones).

`POST /api/gamification/challenge` es de este servicio aunque su URL empiece
con `/api/gamification`: se conservo por compatibilidad con el frontend, pero
lo que hace es registrar un intento.

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Cambiar como se calcula el puntaje o el minimo para aprobar | `dominio/puntaje.js` (funciones puras, con prueba unitaria en `tests/unitarias.test.mjs`) |
| Un caso de uso nuevo | `aplicacion/simulaciones.service.js` o `aplicacion/desafios.service.js` |
| Una consulta | `infraestructura/evaluaciones.repositorio.js` |
| Saber los cursos asignados de alguien | `infraestructura/clientes/cursos.cliente.js` (no leer `course_assignments`) |

## Eventos

Publica `simulation.decision_made`, `simulation.completed`, `quiz.approved` y
`quiz.failed`. Reprobar un desafio publica `quiz.failed` pero no otorga
puntos; cerrar una simulacion publica su propio evento y no `quiz.approved`,
porque los puntos ya se pagaron decision por decision.
