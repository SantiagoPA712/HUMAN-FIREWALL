# Servicio de cursos

Catalogo de cursos y lecciones, asignaciones, progreso y cierre del curso. Es
el dueno de `courses`, `course_contents`, `course_assignments` y
`lesson_progress`, y el unico que las escribe (incluida la marca
`is_critical`, aunque la pantalla que la cambia este en notificaciones).

Ficha completa: [`docs/arquitectura/SERVICIOS.md`](../../../../docs/arquitectura/SERVICIOS.md#cursos).

## Donde hacer un cambio

| Quiero... | Toco |
|-----------|------|
| Un endpoint nuevo | `api/course.routes.js` + `api/course.controller.js` (sin SQL), DTO en `api/esquemas.js`, operacion en `contrato/openapi.js` |
| Una regla del caso de uso (que pasa al completar, que se publica) | `aplicacion/cursos.service.js` |
| Una consulta | `infraestructura/cursos.repositorio.js` |
| Que otro servicio consulte cursos | exponerlo en `index.js` |

## Eventos

Publica `course.assigned` (en la misma transaccion que la asignacion),
`lesson.completed`, `course.completed` y `course.deadline_approaching` (lo
publica el reloj de fechas limite, una vez por asignacion). No consume
ninguno: no le interesa lo que pasa en otros servicios.

Los puntos de una leccion NO se otorgan aca: la respuesta trae
`puntos_estimados` y gamificacion los asigna al consumir el evento.
