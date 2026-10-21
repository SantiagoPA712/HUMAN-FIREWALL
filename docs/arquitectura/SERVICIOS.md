# Catalogo de microservicios

> Archivo generado por `npm run docs:arquitectura` (human-firewall-backend/scripts/generar-catalogo-de-servicios.js).
> No editar a mano: se arma con los manifiestos, el contrato OpenAPI y el codigo de cada servicio,
> y `tests/arquitectura.test.mjs` falla si queda desactualizado.

Version del contrato publico: **1.1.0**. Contrato navegable en `/api/docs`.

| Servicio | Responsabilidad | Prefijos HTTP | Depende de |
|----------|-----------------|---------------|------------|
| [identidad](#identidad) | Cuentas de usuario, autenticacion (correo/contrasena y Google), recuperacion de contrasena, roles, perfil propio, equipos e invitaciones. | `/api/auth`<br>`/api/users`<br>`/api/sso`<br>`/api/invitations` | seguridad, notificaciones |
| [cursos](#cursos) | Catalogo de cursos y lecciones, asignacion de cursos a usuarios, progreso por leccion, cierre del curso al completar la ultima leccion y aviso de fechas limite proximas. | `/api/courses` | - |
| [evaluaciones](#evaluaciones) | Simulaciones de phishing (pasos, opciones y decisiones), desafios del portal y el historial de intentos de evaluacion con su puntaje calculado en el servidor. | `/api/simulations`<br>`/api/gamification/challenge` | cursos, gamificacion |
| [gamificacion](#gamificacion) | Puntos (historial inmutable y reglas), recompensas e insignias, niveles, ranking y recomendaciones de refuerzo segun el desempeno. | `/api/gamification` | identidad, cursos, evaluaciones, seguridad |
| [notificaciones](#notificaciones) | Avisos in-app, notificacion de resultados (con alerta a RH en cursos criticos), preferencias por canal y cola de correo con plantillas versionadas e idioma. | `/api/notifications` | identidad, cursos, evaluaciones |
| [reportes](#reportes) | Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos programados con su historico y consolidado organizacional para gerencia. | `/api/gamification/reports` | gamificacion, notificaciones, seguridad |
| [seguridad](#seguridad) | Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y registro centralizado e inmutable de acciones criticas (data.logs). | `/api/gamification/security`<br>`/api/gamification/users`<br>`/api/logs` | identidad, gamificacion |

---

## identidad

Cuentas de usuario, autenticacion (correo/contrasena y Google), recuperacion de contrasena, roles, perfil propio, equipos e invitaciones.

- **Carpeta:** `human-firewall-backend/src/servicios/identidad/`
- **Tablas propias:** `users`, `password_reset_tokens`, `user_invitations`, `user_invitation_events`, `teams`
- **Publica:** `user.registered`, `user.password_changed`, `user.invited`
- **Consume:** -
- **Depende de (por contrato interno):** seguridad, notificaciones
- **Procesos de fondo:** -

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| POST | `/api/auth/login` | publica | Iniciar sesion |
| POST | `/api/auth/logout` | publica | Cerrar sesion |
| POST | `/api/auth/register` | publica | Registrarse como empleado |
| POST | `/api/auth/forgot-password` | publica | Pedir recuperacion de contrasena |
| POST | `/api/auth/reset-password` | publica | Restablecer contrasena con el token de recuperacion |
| GET | `/api/users/idiomas` | autenticado | Idiomas habilitados en la plataforma |
| GET | `/api/users/me` | autenticado | Perfil propio |
| PATCH | `/api/users/me` | autenticado | Actualizar el perfil propio |
| GET | `/api/users` | admin | Listar usuarios |
| POST | `/api/users` | admin | Crear un usuario |
| PUT | `/api/users/{id}` | admin | Cambiar rol o estado de un usuario |
| DELETE | `/api/users/{id}` | admin | Desactivar un usuario (baja logica) |
| GET | `/api/sso/google` | publica | Entrar con Google |
| GET | `/api/sso/google/callback` | publica | Regreso desde Google |
| POST | `/api/invitations/validar` | publica | Validar un enlace de invitacion |
| POST | `/api/invitations/aceptar` | publica | Completar el registro desde una invitacion |
| POST | `/api/invitations/solicitar-reenvio` | publica | Pedir una invitacion nueva (enlace vencido) |
| GET | `/api/invitations` | admin | Panel de invitaciones |
| POST | `/api/invitations` | admin | Invitar a una persona |
| POST | `/api/invitations/{id}/reenviar` | admin | Reenviar una invitacion |
| POST | `/api/invitations/{id}/cancelar` | admin | Cancelar una invitacion |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `usuarioExiste`, `correoDe`, `idPorCorreo`, `obtenerContacto`, `responsablesRhDe`, `activosConRol`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de identidad — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de identidad.

**api/** — Presentacion: rutas, controladores y DTO

- `api/auth.controller.js` — Controlador HTTP de autenticacion (/api/auth).
- `api/auth.routes.js` — Rutas de autenticacion, montadas en /api/auth.
- `api/esquemas.js` — DTO del servicio de identidad.
- `api/invitations.controller.js` — Invitaciones de usuarios (HU de onboarding por invitacion).
- `api/invitations.routes.js` — Rutas de invitaciones, montadas en /api/invitations: publicas para el invitado (con limite por IP) y de administrador.
- `api/sso.routes.js` — Rutas de inicio de sesion con Google, montadas en /api/sso.
- `api/user.controller.js` — Controlador HTTP de usuarios (/api/users).
- `api/user.routes.js` — Rutas de usuarios, montadas en /api/users.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/auth.service.js` — Casos de uso de autenticacion: login (con bloqueo por intentos) y registro publico como employee, que publica user.registered.
- `aplicacion/invitations.service.js` — Invitaciones de usuarios.
- `aplicacion/recovery.service.js` — Casos de uso de recuperacion de contrasena: generar el token y restablecer la contrasena, que publica user.password_changed.
- `aplicacion/user.service.js` — Casos de uso de cuentas: alta por un admin, listado y perfil propio.

**dominio/** — Dominio: reglas puras

- `dominio/usuario.js` — Reglas del dominio de identidad.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/notificaciones.cliente.js` — Cliente del servicio de notificaciones, visto desde identidad.
- `infraestructura/clientes/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde identidad.
- `infraestructura/passport.js` — Integracion con Google OAuth (passport).
- `infraestructura/seed_admin.js` — Script que crea una cuenta admin con credenciales tomadas del entorno.
- `infraestructura/usuarios.repositorio.js` — Repositorio de cuentas de usuario.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de identidad.

---

## cursos

Catalogo de cursos y lecciones, asignacion de cursos a usuarios, progreso por leccion, cierre del curso al completar la ultima leccion y aviso de fechas limite proximas.

- **Carpeta:** `human-firewall-backend/src/servicios/cursos/`
- **Tablas propias:** `courses`, `course_contents`, `course_assignments`, `lesson_progress`
- **Publica:** `course.assigned`, `lesson.completed`, `course.completed`, `course.deadline_approaching`
- **Consume:** -
- **Depende de (por contrato interno):** -
- **Procesos de fondo:** Reloj de fechas limite proximas (publica course.deadline_approaching)

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/courses` | autenticado | Cursos visibles para el usuario |
| POST | `/api/courses` | admin, instructor | Crear un curso |
| GET | `/api/courses/{courseId}` | autenticado | Detalle de un curso con sus lecciones |
| GET | `/api/courses/{courseId}/progress` | autenticado | Progreso del usuario autenticado en un curso |
| POST | `/api/courses/{courseId}/contents` | admin, instructor | Agregar una leccion a un curso |
| POST | `/api/courses/contents/{contentId}/complete` | autenticado | Marcar una leccion como completada |
| POST | `/api/courses/assign` | admin, instructor, rh | Asignar un curso a un usuario |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `obtenerTitulo`, `obtenerTitulos`, `idsDeCursosAsignados`, `obtenerLeccion`, `contarLeccionesCompletadas`, `contarCursosCompletados`, `listarConCriticidad`, `marcarCritico`, `buscarVencimientosProximos`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de cursos — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de cursos.

**api/** — Presentacion: rutas, controladores y DTO

- `api/course.controller.js` — Controlador HTTP de cursos.
- `api/course.routes.js` — Rutas del servicio de cursos, montadas en /api/courses.
- `api/esquemas.js` — DTO del servicio de cursos: la forma de lo que acepta cada endpoint.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/cursos.service.js` — Casos de uso del servicio de cursos.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/cursos.repositorio.js` — Repositorio de cursos: el unico archivo del servicio que escribe SQL.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de cursos.

---

## evaluaciones

Simulaciones de phishing (pasos, opciones y decisiones), desafios del portal y el historial de intentos de evaluacion con su puntaje calculado en el servidor.

- **Carpeta:** `human-firewall-backend/src/servicios/evaluaciones/`
- **Tablas propias:** `simulations`, `simulation_steps`, `simulation_options`, `simulation_results`, `challenges`, `user_challenge_results`, `quiz_attempts`
- **Publica:** `simulation.decision_made`, `simulation.completed`, `quiz.approved`, `quiz.failed`
- **Consume:** -
- **Depende de (por contrato interno):** cursos, gamificacion
- **Procesos de fondo:** -

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/simulations` | autenticado | Simulaciones disponibles |
| POST | `/api/simulations` | admin, instructor | Crear una simulacion |
| GET | `/api/simulations/{simulationId}` | autenticado | Detalle de una simulacion con pasos y opciones |
| POST | `/api/simulations/{simulationId}/steps` | admin, instructor | Agregar un paso a una simulacion |
| POST | `/api/simulations/steps/{stepId}/options` | admin, instructor | Agregar una opcion a un paso |
| POST | `/api/simulations/submit-decision` | autenticado | Registrar una decision dentro de una simulacion |
| POST | `/api/simulations/{simulationId}/complete` | autenticado | Cerrar una simulacion |
| POST | `/api/gamification/challenge` | autenticado | Registrar el resultado de un desafio del portal |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `nombreDeDesafio`, `tituloDeSimulacion`, `contarEvaluacionesAprobadas`, `ultimosResultados`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de evaluaciones — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de evaluaciones.

**api/** — Presentacion: rutas, controladores y DTO

- `api/desafios.controller.js` — Controlador HTTP de los desafios del portal.
- `api/desafios.routes.js` — Ruta de desafios del portal, montada en /api/gamification/challenge.
- `api/esquemas.js` — DTO del servicio de evaluaciones.
- `api/simulation.controller.js` — Controlador HTTP de simulaciones.
- `api/simulation.routes.js` — Rutas de simulaciones, montadas en /api/simulations.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/desafios.service.js` — Casos de uso de los desafios del portal (minijuegos).
- `aplicacion/simulaciones.service.js` — Casos de uso de las simulaciones.

**dominio/** — Dominio: reglas puras

- `dominio/puntaje.js` — Reglas de puntaje de las evaluaciones.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/cursos.cliente.js` — Cliente del servicio de cursos, visto desde evaluaciones.
- `infraestructura/clientes/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde evaluaciones.
- `infraestructura/evaluaciones.repositorio.js` — Repositorio de evaluaciones: simulaciones, desafios e intentos.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de evaluaciones.

---

## gamificacion

Puntos (historial inmutable y reglas), recompensas e insignias, niveles, ranking y recomendaciones de refuerzo segun el desempeno.

- **Carpeta:** `human-firewall-backend/src/servicios/gamificacion/`
- **Tablas propias:** `points_ledger`, `points_rules`, `v_user_points`, `rewards_catalog`, `user_rewards`, `badges`, `user_badges`, `levels_config`, `user_level_history`, `recommendation_rules`, `user_recommendations`
- **Publica:** `points_assigned`, `level_up`, `reward_granted`
- **Consume:** `lesson.completed`, `quiz.approved`, `course.completed`, `simulation.decision_made`, `simulation.completed`, `points_assigned`
- **Depende de (por contrato interno):** identidad, cursos, evaluaciones, seguridad
- **Procesos de fondo:** -

**Acceso declarado a datos de otros servicios** (verificado por las pruebas de arquitectura):

| Tipo | Tablas | Dueno | Motivo |
|------|--------|-------|--------|
| lee | `users` | identidad | El ranking ordena por las columnas de cache total_points y level, que vive en users y mantiene este mismo servicio (ver escriturasCompartidas). |
| lee | `quiz_attempts`, `challenges`, `simulations` | evaluaciones | El resumen de desempeno y las recomendaciones agregan el historial de intentos en una sola consulta. Es una proyeccion de lectura: nunca escribe en esas tablas. |
| lee | `courses`, `course_contents`, `course_assignments`, `lesson_progress` | cursos | Mismo caso: el avance por curso del resumen de desempeno se calcula con un JOIN. |
| escribe | `users` (total_points, level) | identidad | Cache desnormalizada del total y del nivel. La fuente de verdad es points_ledger; identidad no escribe nunca estas dos columnas. |

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/gamification/leaderboard` | autenticado | Ranking (top 10 por puntos) |
| GET | `/api/gamification/me` | autenticado | Puntos, nivel e insignias del usuario autenticado |
| GET | `/api/gamification/points/rules` | autenticado | Reglas de puntuacion vigentes |
| GET | `/api/gamification/points/{userId}` | propio usuario, admin, rh | Historial de puntos de un usuario |
| GET | `/api/gamification/rewards` | autenticado | Catalogo de recompensas activas |
| GET | `/api/gamification/rewards/{userId}` | propio usuario, admin, rh | Recompensas obtenidas y bloqueadas de un usuario (con progreso) |
| GET | `/api/gamification/levels` | autenticado | Escalera de niveles |
| GET | `/api/gamification/level/{userId}` | propio usuario, admin, rh | Nivel actual y avance hacia el siguiente |
| GET | `/api/gamification/performance/{userId}` | propio usuario, admin, rh | Resumen de desempeno y areas de oportunidad (calculo en vivo) |
| GET | `/api/gamification/recommendations/{userId}` | propio usuario, admin, rh | Recomendaciones de refuerzo (proyeccion precalculada por eventos) |
| POST | `/api/gamification/badges` | admin | Crear una recompensa en el catalogo |
| POST | `/api/gamification/badges/assign` | admin, instructor | Asignar una insignia a mano (auditado) |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `yaOtorgado`, `obtenerTotalesPorUsuarios`, `obtenerResumenPorUsuarios`, `obtenerEscalera`, `calcularProgreso`, `obtenerPuntos`, `obtenerNivelDeUsuario`, `contarRecompensasDe`, `buscarRecompensa`, `registrarMovimiento`, `otorgarRecompensa`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de gamificacion — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de gamificacion.

**api/** — Presentacion: rutas, controladores y DTO

- `api/esquemas.js` — DTO del servicio de gamificacion.
- `api/gamification.controller.js` — Controlador HTTP de gamificacion.
- `api/gamification.routes.js` — Rutas del servicio de gamificacion, montadas en /api/gamification.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/levels.service.js` — Servicio de niveles.
- `aplicacion/points.service.js` — Servicio de asignacion automatica de puntos.
- `aplicacion/recommendations.service.js` — Motor de recomendaciones y resumen de desempeno.
- `aplicacion/rewards.service.js` — Motor de evaluacion de recompensas.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/cursos.cliente.js` — Cliente del servicio de cursos, visto desde gamificacion.
- `infraestructura/clientes/evaluaciones.cliente.js` — Cliente del servicio de evaluaciones, visto desde gamificacion.
- `infraestructura/clientes/identidad.cliente.js` — Cliente del servicio de identidad, visto desde gamificacion.
- `infraestructura/clientes/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde gamificacion.
- `infraestructura/gamificacion.repositorio.js` — Repositorio de las consultas que antes escribia a mano gamification.controller.js.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de gamificacion.

---

## notificaciones

Avisos in-app, notificacion de resultados (con alerta a RH en cursos criticos), preferencias por canal y cola de correo con plantillas versionadas e idioma.

- **Carpeta:** `human-firewall-backend/src/servicios/notificaciones/`
- **Tablas propias:** `notifications`, `notification_deliveries`, `notification_preferences`, `email_jobs`, `email_job_attempts`, `email_notification_types`, `email_preferences`, `email_templates`
- **Publica:** -
- **Consume:** `user.registered`, `level_up`, `reward_granted`, `quiz.approved`, `quiz.failed`, `course.completed`, `simulation.completed`, `course.assigned`, `course.deadline_approaching`, `user.password_changed`, `user.invited`
- **Depende de (por contrato interno):** identidad, cursos, evaluaciones
- **Procesos de fondo:** Worker de la cola de correo (email_jobs)

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/notifications` | autenticado | Bandeja de avisos del usuario autenticado |
| PATCH | `/api/notifications/{id}/leida` | autenticado | Marcar un aviso como leido |
| PATCH | `/api/notifications/leidas` | autenticado | Marcar todos los resultados como leidos |
| GET | `/api/notifications/resultados` | autenticado | Centro de resultados de evaluaciones, simulaciones y cursos |
| GET | `/api/notifications/preferencias` | autenticado | Canales habilitados (in-app y correo) |
| PATCH | `/api/notifications/preferencias` | autenticado | Cambiar los canales habilitados |
| GET | `/api/notifications/cursos-criticos` | rh, admin | Cursos con su marca de critico |
| PATCH | `/api/notifications/cursos-criticos/{courseId}` | rh, admin | Marcar o desmarcar un curso como critico |
| GET | `/api/notifications/correo/preferencias` | autenticado | Tipos de correo que recibe el usuario e idioma |
| PATCH | `/api/notifications/correo/preferencias` | autenticado | Activar o desactivar tipos de correo |
| GET | `/api/notifications/correo/estado` | admin | Diagnostico de la cola de correo |
| GET | `/api/notifications/eventos/estado` | admin | Diagnostico del bus de eventos |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `avisarEnBandeja`, `notificar`, `reenviarCorreo`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de notificaciones — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de notificaciones.

**api/** — Presentacion: rutas, controladores y DTO

- `api/emailNotifications.controller.js` — Preferencias de correo y diagnostico de la cola (HU de notificaciones por correo).
- `api/esquemas.js` — DTO del servicio de notificaciones.
- `api/notification.controller.js` — Controlador HTTP de la bandeja de avisos y del diagnostico del bus.
- `api/notification.routes.js` — Rutas del servicio de notificaciones, montadas en /api/notifications.
- `api/resultNotifications.controller.js` — Centro de notificaciones de resultados y su configuracion.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/emailNotifications.service.js` — Notificaciones por correo electronico.
- `aplicacion/emailTemplates.service.js` — Plantillas de correo versionadas (criterio tecnico 2 de la HU de notificaciones por correo).
- `aplicacion/notifications.service.js` — Servicio de notificaciones.
- `aplicacion/resultNotifications.service.js` — Notificacion de resultados de evaluaciones y simulaciones.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/cursos.cliente.js` — Cliente del servicio de cursos, visto desde notificaciones.
- `infraestructura/clientes/evaluaciones.cliente.js` — Cliente del servicio de evaluaciones, visto desde notificaciones.
- `infraestructura/clientes/identidad.cliente.js` — Cliente del servicio de identidad, visto desde notificaciones.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de notificaciones.

---

## reportes

Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos programados con su historico y consolidado organizacional para gerencia.

- **Carpeta:** `human-firewall-backend/src/servicios/reportes/`
- **Tablas propias:** `report_exports`, `report_schedules`, `report_history`, `report_notifications`, `org_kpi_snapshots`, `org_report_access_log`
- **Publica:** `report.export_requested`, `report.scheduled_run`, `report.auto_generated`
- **Consume:** `report.export_requested`, `report.scheduled_run`, `report.auto_generated`
- **Depende de (por contrato interno):** gamificacion, notificaciones, seguridad
- **Procesos de fondo:** Scheduler de reportes programados; Job de KPIs organizacionales

**Acceso declarado a datos de otros servicios** (verificado por las pruebas de arquitectura):

| Tipo | Tablas | Dueno | Motivo |
|------|--------|-------|--------|
| lee | `users`, `teams` | identidad | Servicio de lectura analitica: los reportes agregan por persona y por equipo en SQL. Solo lee; no escribe nunca fuera de sus tablas. |
| lee | `points_ledger` | gamificacion | Los snapshots organizacionales se recalculan por un job sobre el historial de puntos. |
| lee | `quiz_attempts` | evaluaciones | Tasa de aprobacion por periodo y por equipo. |
| lee | `courses`, `course_assignments`, `lesson_progress` | cursos | Avance y cumplimiento de cursos por periodo y por equipo. |

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/gamification/reports/filters` | rh, admin | Equipos y cursos para el panel de filtros |
| GET | `/api/gamification/reports/performance` | rh, admin | Reporte de desempeno por persona |
| POST | `/api/gamification/reports/performance/export` | rh, admin | Exportar el reporte de desempeno (CSV o PDF) |
| GET | `/api/gamification/reports/exports/{exportId}` | rh, admin | Estado de una exportacion encolada |
| GET | `/api/gamification/reports/exports/{exportId}/download` | rh, admin | Descargar una exportacion ya generada |
| GET | `/api/gamification/reports/schedules` | admin | Programaciones de reportes automaticos |
| POST | `/api/gamification/reports/schedules` | admin | Crear una programacion |
| PATCH | `/api/gamification/reports/schedules/{id}` | admin | Cambiar una programacion |
| GET | `/api/gamification/reports/history` | rh, security, manager, admin | Historico de reportes generados |
| GET | `/api/gamification/reports/history/{id}/download` | rh, security, manager, admin | Descargar un reporte generado |
| GET | `/api/gamification/reports/organizational` | manager, admin | Resultados organizacionales consolidados (gerencia) |

### Contrato interno (index.js)

No expone funciones a otros servicios: su unico contrato es la API HTTP.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de reportes — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de reportes.

**api/** — Presentacion: rutas, controladores y DTO

- `api/esquemas.js` — Esquemas de entrada del servicio de reportes.
- `api/orgReports.controller.js` — Resultados organizacionales para gerencia.
- `api/report.controller.js` — Reportes de desempeno para RH.
- `api/reportes.routes.js` — Rutas del servicio de reportes, montadas en /api/gamification/reports.
- `api/scheduledReports.controller.js` — Reportes automaticos periodicos.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/orgReports.service.js` — Resultados organizacionales consolidados.
- `aplicacion/reportExports.service.js` — Exportacion de reportes a CSV y PDF.
- `aplicacion/reports.service.js` — Reportes de desempeno para RH.
- `aplicacion/scheduledReports.service.js` — Reportes automaticos periodicos.

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde reportes.
- `infraestructura/clientes/notificaciones.cliente.js` — Cliente del servicio de notificaciones, visto desde reportes.
- `infraestructura/clientes/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde reportes.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de reportes.

---

## seguridad

Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y registro centralizado e inmutable de acciones criticas (data.logs).

- **Carpeta:** `human-firewall-backend/src/servicios/seguridad/`
- **Tablas propias:** `anomaly_rules`, `anomaly_events`, `anomaly_status_history`, `audit_log`, `data.logs`, `data.logs_purges`, `activity_logs`
- **Publica:** `audit.log_recorded`
- **Consume:** `points_assigned`, `audit.log_recorded`
- **Depende de (por contrato interno):** identidad, gamificacion
- **Procesos de fondo:** Job de respaldo de deteccion de anomalias; Job de retencion de data.logs

**Acceso declarado a datos de otros servicios** (verificado por las pruebas de arquitectura):

| Tipo | Tablas | Dueno | Motivo |
|------|--------|-------|--------|
| lee | `points_ledger` | gamificacion | La deteccion de anomalias analiza ventanas de movimientos del historial de puntos. Solo lee: los ajustes manuales se aplican por el contrato de gamificacion. |
| lee | `users` | identidad | Los listados del panel muestran el correo del actor y del afectado con un JOIN. |

### Endpoints

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| GET | `/api/gamification/security/rules` | security, admin | Umbrales vigentes de deteccion de anomalias |
| GET | `/api/gamification/security/audit` | security, admin | Auditoria de ajustes manuales |
| GET | `/api/gamification/security/anomalies` | security, admin | Anomalias detectadas |
| GET | `/api/gamification/security/anomalies/{id}` | security, admin | Detalle de una anomalia con la linea de tiempo del usuario |
| PATCH | `/api/gamification/security/anomalies/{id}/status` | security, admin | Cambiar el estado de una anomalia |
| PATCH | `/api/gamification/users/{id}/adjust` | admin | Ajuste manual de puntos, nivel o insignia (auditado) |
| GET | `/api/logs` | admin | Registro de acciones criticas (data.logs) |
| GET | `/api/logs/filtros` | admin | Opciones para los filtros del registro |
| GET | `/api/logs/export` | admin | Exportar el registro filtrado a CSV |
| GET | `/api/logs/{id}` | admin | Detalle de un log: valores anterior y nuevo, IP y trace_id |

### Contrato interno (index.js)

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infraestructura/clientes/`: `registrarAccion`, `ACCIONES`, `MODULOS`, `auditarAjusteManual`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de seguridad — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de seguridad.

**api/** — Presentacion: rutas, controladores y DTO

- `api/ajustes.routes.js` — Ajuste manual de puntos, nivel o insignias, montado en /api/gamification/users.
- `api/esquemas.js` — DTO del servicio de seguridad.
- `api/logs.controller.js` — Consulta de los logs de auditoria (data.logs).
- `api/logs.routes.js` — Rutas del registro de acciones criticas (data.logs), montadas en /api/logs.
- `api/security.controller.js` — Panel de seguridad: anomalias y auditoria.
- `api/seguridad.routes.js` — Rutas del panel de seguridad, montadas en /api/gamification/security.

**aplicacion/** — Aplicacion: casos de uso

- `aplicacion/anomalies.service.js` — Deteccion de anomalias en la asignacion de puntos.
- `aplicacion/audit.service.js` — Auditoria de ajustes manuales.
- `aplicacion/dataLogs.service.js` — Registro centralizado de logs de auditoria (data.logs).

**infraestructura/** — Infraestructura: repositorios, clientes e integraciones

- `infraestructura/clientes/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde seguridad.
- `infraestructura/clientes/identidad.cliente.js` — Cliente del servicio de identidad, visto desde seguridad.

**contrato/** — Contrato publico OpenAPI

- `contrato/openapi.js` — Contrato publico (OpenAPI) del servicio de seguridad.
