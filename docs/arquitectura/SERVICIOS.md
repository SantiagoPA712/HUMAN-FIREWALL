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
| [reportes](#reportes) | Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos programados con su historico y consolidado organizacional para gerencia. | `/api/gamification/reports` | identidad, cursos, evaluaciones, gamificacion, notificaciones, seguridad |
| [seguridad](#seguridad) | Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y registro centralizado e inmutable de acciones criticas (data.logs). | `/api/gamification/security`<br>`/api/gamification/users`<br>`/api/logs` | identidad, gamificacion |

---

## identidad

Cuentas de usuario, autenticacion (correo/contrasena y Google), recuperacion de contrasena, roles, perfil propio, equipos e invitaciones.

- **Carpeta:** `human-firewall-backend/src/servicios/identidad/`
- **Tablas propias:** `identidad.users`, `identidad.password_reset_tokens`, `identidad.user_invitations`, `identidad.user_invitation_events`, `identidad.teams`
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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `usuarioExiste`, `correoDe`, `idPorCorreo`, `obtenerContacto`, `responsablesRhDe`, `activosConRol`, `activosConRoles`, `usuariosActivos`, `resumenesDe`, `buscarEquipo`, `equiposActivos`, `rankingPorPuntos`, `cacheDeGamificacion`, `guardarCacheDePuntos`, `guardarCacheDeNivel`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de identidad — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de identidad.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de identidad.

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/auth.controller.js` — Controlador HTTP de autenticacion (/api/auth).
- `controller/auth.routes.js` — Rutas de autenticacion, montadas en /api/auth.
- `controller/dto.js` — DTO del servicio de identidad.
- `controller/invitations.controller.js` — Invitaciones de usuarios (HU de onboarding por invitacion).
- `controller/invitations.routes.js` — Rutas de invitaciones, montadas en /api/invitations: publicas para el invitado (con limite por IP) y de administrador.
- `controller/sso.routes.js` — Rutas de inicio de sesion con Google, montadas en /api/sso.
- `controller/user.controller.js` — Controlador HTTP de usuarios (/api/users).
- `controller/user.routes.js` — Rutas de usuarios, montadas en /api/users.

**application/** — Application / Service: casos de uso

- `application/auth.service.js` — Casos de uso de autenticacion: login (con bloqueo por intentos) y registro publico como employee, que publica user.registered.
- `application/invitations.service.js` — Invitaciones de usuarios.
- `application/recovery.service.js` — Casos de uso de recuperacion de contrasena: generar el token y restablecer la contrasena, que publica user.password_changed.
- `application/sso.service.js` — Caso de uso de ingreso con Google: busca la cuenta por correo y, si no existe, la crea y publica user.registered.
- `application/user.service.js` — Casos de uso de cuentas: alta por un admin, listado, cambio de rol o estado, baja logica y perfil propio.

**domain/** — Domain: entidades y reglas de negocio

- `domain/invitacion.js` — Reglas del dominio de invitaciones.
- `domain/usuario.js` — Reglas del dominio de identidad.

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/notificaciones.cliente.js` — Cliente del servicio de notificaciones, visto desde identidad.
- `infrastructure/client/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde identidad.
- `infrastructure/passport.js` — Integracion con Google OAuth (passport).
- `infrastructure/persistence/equipos.repositorio.js` — Repositorio de equipos (areas) del servicio de identidad.
- `infrastructure/persistence/invitaciones.repositorio.js` — Repositorio de invitaciones (esquema identidad).
- `infrastructure/persistence/recuperacion.repositorio.js` — Repositorio de tokens de recuperacion de contrasena (esquema identidad).
- `infrastructure/persistence/usuarios.repositorio.js` — Repositorio de cuentas de usuario (esquema identidad).
- `infrastructure/seed_admin.js` — Script que crea una cuenta admin con credenciales tomadas del entorno.

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de identidad.

---

## cursos

Catalogo de cursos y lecciones, asignacion de cursos a usuarios, progreso por leccion, cierre del curso al completar la ultima leccion y aviso de fechas limite proximas.

- **Carpeta:** `human-firewall-backend/src/servicios/cursos/`
- **Tablas propias:** `cursos.courses`, `cursos.course_contents`, `cursos.course_assignments`, `cursos.lesson_progress`
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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `obtenerTitulo`, `obtenerTitulos`, `idsDeCursosAsignados`, `obtenerLeccion`, `contarLeccionesCompletadas`, `contarCursosCompletados`, `listarConCriticidad`, `marcarCritico`, `buscarVencimientosProximos`, `titulosOrdenados`, `usuariosAsignadosA`, `asignacionesDe`, `accionesPorUsuarioEntre`, `ultimaActividadDe`, `cursosCompletadosPorUsuarioEntre`, `avanceDe`, `leccionesPendientes`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de cursos — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de cursos.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de cursos (equivale al application.yml de la seccion 11).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/course.controller.js` — Controlador HTTP de cursos.
- `controller/course.routes.js` — Rutas del servicio de cursos, montadas en /api/courses.
- `controller/dto.js` — DTO del servicio de cursos: la forma de lo que acepta cada endpoint.

**application/** — Application / Service: casos de uso

- `application/cursos.service.js` — Casos de uso del servicio de cursos.

**domain/** — Domain: entidades y reglas de negocio

- `domain/curso.js` — Curso (servicio de cursos).

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/persistence/cursos.repositorio.js` — Repositorio de cursos: el unico archivo del servicio que escribe SQL.

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de cursos.

---

## evaluaciones

Simulaciones de phishing (pasos, opciones y decisiones), desafios del portal y el historial de intentos de evaluacion con su puntaje calculado en el servidor.

- **Carpeta:** `human-firewall-backend/src/servicios/evaluaciones/`
- **Tablas propias:** `evaluaciones.simulations`, `evaluaciones.simulation_steps`, `evaluaciones.simulation_options`, `evaluaciones.simulation_results`, `evaluaciones.challenges`, `evaluaciones.user_challenge_results`, `evaluaciones.quiz_attempts`
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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `nombreDeDesafio`, `tituloDeSimulacion`, `contarEvaluacionesAprobadas`, `ultimosResultados`, `resultadosConsolidados`, `pendientesDe`, `serieDeIntentos`, `accionesPorUsuarioEntre`, `ultimaActividadDe`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de evaluaciones — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de evaluaciones.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de evaluaciones (equivale al application.yml de la seccion 11 del material).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/desafios.controller.js` — Controlador HTTP de los desafios del portal.
- `controller/desafios.routes.js` — Ruta de desafios del portal, montada en /api/gamification/challenge.
- `controller/dto.js` — DTO del servicio de evaluaciones.
- `controller/simulation.controller.js` — Controlador HTTP de simulaciones.
- `controller/simulation.routes.js` — Rutas de simulaciones, montadas en /api/simulations.

**application/** — Application / Service: casos de uso

- `application/desafios.service.js` — Casos de uso de los desafios del portal (minijuegos).
- `application/simulaciones.service.js` — Casos de uso de las simulaciones.

**domain/** — Domain: entidades y reglas de negocio

- `domain/puntaje.js` — Reglas de puntaje de las evaluaciones.

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/cursos.cliente.js` — Cliente del servicio de cursos, visto desde evaluaciones.
- `infrastructure/client/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde evaluaciones.
- `infrastructure/persistence/evaluaciones.repositorio.js` — Repositorio de evaluaciones: simulaciones, desafios e intentos.

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de evaluaciones.

---

## gamificacion

Puntos (historial inmutable y reglas), recompensas e insignias, niveles, ranking y recomendaciones de refuerzo segun el desempeno.

- **Carpeta:** `human-firewall-backend/src/servicios/gamificacion/`
- **Tablas propias:** `gamificacion.points_ledger`, `gamificacion.points_rules`, `gamificacion.v_user_points`, `gamificacion.rewards_catalog`, `gamificacion.user_rewards`, `gamificacion.badges`, `gamificacion.user_badges`, `gamificacion.levels_config`, `gamificacion.user_level_history`, `gamificacion.recommendation_rules`, `gamificacion.user_recommendations`
- **Publica:** `points_assigned`, `level_up`, `reward_granted`
- **Consume:** `lesson.completed`, `quiz.approved`, `course.completed`, `simulation.decision_made`, `simulation.completed`, `points_assigned`
- **Depende de (por contrato interno):** identidad, cursos, evaluaciones, seguridad
- **Procesos de fondo:** -

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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `yaOtorgado`, `obtenerTotalesPorUsuarios`, `obtenerResumenPorUsuarios`, `obtenerEscalera`, `calcularProgreso`, `obtenerPuntos`, `obtenerNivelDeUsuario`, `contarRecompensasDe`, `buscarRecompensa`, `accionesPorUsuarioEntre`, `ultimaActividadDe`, `puntosPorUsuarioHasta`, `movimientosEnVentana`, `usuariosConMovimientosRecientes`, `ultimosMovimientos`, `registrarMovimiento`, `otorgarRecompensa`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de gamificacion — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de gamificacion.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de gamificacion (equivale al application.yml de la seccion 11 del material).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/dto.js` — DTO del servicio de gamificacion.
- `controller/gamification.controller.js` — Controlador HTTP de gamificacion.
- `controller/gamification.routes.js` — Rutas del servicio de gamificacion, montadas en /api/gamification.

**application/** — Application / Service: casos de uso

- `application/gamificacion.service.js` — Consultas de gamificacion que pide el controller (ranking, estado del usuario, catalogo, reglas).
- `application/levels.service.js` — Servicio de niveles.
- `application/points.service.js` — Servicio de asignacion automatica de puntos.
- `application/recommendations.service.js` — Motor de recomendaciones y resumen de desempeno.
- `application/rewards.service.js` — Motor de evaluacion de recompensas.

**domain/** — Domain: entidades y reglas de negocio

- `domain/nivel.js` — Niveles (servicio de gamificacion).
- `domain/puntos.js` — Puntos (servicio de gamificacion).
- `domain/recomendacion.js` — Recomendaciones (servicio de gamificacion).
- `domain/recompensa.js` — Recompensas (servicio de gamificacion).

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/cursos.cliente.js` — Cliente del servicio de cursos, visto desde gamificacion.
- `infrastructure/client/evaluaciones.cliente.js` — Cliente del servicio de evaluaciones, visto desde gamificacion.
- `infrastructure/client/identidad.cliente.js` — Cliente del servicio de identidad, visto desde gamificacion.
- `infrastructure/client/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde gamificacion.
- `infrastructure/persistence/gamificacion.repositorio.js` — Repositorio de las consultas de los endpoints de gamificacion (insignias, catalogo de recompensas, reglas de puntos).
- `infrastructure/persistence/niveles.repositorio.js` — Repositorio de niveles: levels_config, user_level_history y la cache users.level.
- `infrastructure/persistence/puntos.repositorio.js` — Repositorio de puntos: points_rules, points_ledger (historial inmutable), la vista v_user_points y la cache users.total_points.
- `infrastructure/persistence/recomendaciones.repositorio.js` — Repositorio de recomendaciones (servicio de gamificacion).
- `infrastructure/persistence/recompensas.repositorio.js` — Repositorio de recompensas: rewards_catalog y user_rewards (con el snapshot de la recompensa al momento de otorgarse).

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de gamificacion.

---

## notificaciones

Avisos in-app, notificacion de resultados (con alerta a RH en cursos criticos), preferencias por canal y cola de correo con plantillas versionadas e idioma.

- **Carpeta:** `human-firewall-backend/src/servicios/notificaciones/`
- **Tablas propias:** `notificaciones.notifications`, `notificaciones.notification_deliveries`, `notificaciones.notification_preferences`, `notificaciones.email_jobs`, `notificaciones.email_job_attempts`, `notificaciones.email_notification_types`, `notificaciones.email_preferences`, `notificaciones.email_templates`
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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `avisarEnBandeja`, `notificar`, `reenviarCorreo`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de notificaciones — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de notificaciones.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de notificaciones (equivale al application.yml de la seccion 11 del material).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/dto.js` — DTO del servicio de notificaciones.
- `controller/emailNotifications.controller.js` — Preferencias de correo y diagnostico de la cola (HU de notificaciones por correo).
- `controller/notification.controller.js` — Controlador HTTP de la bandeja de avisos y del diagnostico del bus.
- `controller/notification.routes.js` — Rutas del servicio de notificaciones, montadas en /api/notifications.
- `controller/resultNotifications.controller.js` — Centro de notificaciones de resultados y su configuracion.

**application/** — Application / Service: casos de uso

- `application/emailNotifications.service.js` — Notificaciones por correo electronico.
- `application/emailTemplates.service.js` — Plantillas de correo versionadas (criterio tecnico 2 de la HU de notificaciones por correo).
- `application/notifications.service.js` — Servicio de notificaciones.
- `application/resultNotifications.service.js` — Notificacion de resultados de evaluaciones y simulaciones.

**domain/** — Domain: entidades y reglas de negocio

- `domain/entrega.js` — Entrega de correos (servicio de notificaciones).
- `domain/notificacion.js` — Notificaciones (servicio de notificaciones).
- `domain/plantilla.js` — Plantillas de correo (servicio de notificaciones).

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/cursos.cliente.js` — Cliente del servicio de cursos, visto desde notificaciones.
- `infrastructure/client/evaluaciones.cliente.js` — Cliente del servicio de evaluaciones, visto desde notificaciones.
- `infrastructure/client/identidad.cliente.js` — Cliente del servicio de identidad, visto desde notificaciones.
- `infrastructure/persistence/correos.repositorio.js` — Repositorio de la cola de correos (servicio de notificaciones).
- `infrastructure/persistence/notificaciones.repositorio.js` — Repositorio de la bandeja de notificaciones (servicio de notificaciones).
- `infrastructure/persistence/plantillas.repositorio.js` — Repositorio de plantillas de correo (servicio de notificaciones).
- `infrastructure/persistence/resultados.repositorio.js` — Repositorio de notificaciones de resultados (servicio de notificaciones).

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de notificaciones.

---

## reportes

Reporte de desempeno para RH con exportacion CSV/PDF, reportes automaticos programados con su historico y consolidado organizacional para gerencia.

- **Carpeta:** `human-firewall-backend/src/servicios/reportes/`
- **Tablas propias:** `reportes.report_exports`, `reportes.report_schedules`, `reportes.report_history`, `reportes.report_notifications`, `reportes.org_kpi_snapshots`, `reportes.org_report_access_log`
- **Publica:** `report.export_requested`, `report.scheduled_run`, `report.auto_generated`
- **Consume:** `report.export_requested`, `report.scheduled_run`, `report.auto_generated`
- **Depende de (por contrato interno):** identidad, cursos, evaluaciones, gamificacion, notificaciones, seguridad
- **Procesos de fondo:** Scheduler de reportes programados; Job de KPIs organizacionales

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

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de reportes (equivale al application.yml de la seccion 11 del material).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/dto.js` — Esquemas de entrada del servicio de reportes.
- `controller/orgReports.controller.js` — Resultados organizacionales para gerencia.
- `controller/report.controller.js` — Reportes de desempeno para RH.
- `controller/reportes.routes.js` — Rutas del servicio de reportes, montadas en /api/gamification/reports.
- `controller/scheduledReports.controller.js` — Reportes automaticos periodicos.

**application/** — Application / Service: casos de uso

- `application/actividad.js` — Actividad de los usuarios, armada con los contratos de los servicios que la registran.
- `application/orgReports.service.js` — Resultados organizacionales consolidados.
- `application/reportExports.service.js` — Exportacion de reportes a CSV y PDF.
- `application/reports.service.js` — Reportes de desempeno para RH.
- `application/scheduledReports.service.js` — Reportes automaticos periodicos.

**domain/** — Domain: entidades y reglas de negocio

- `domain/periodo.js` — Periodos de reporte (servicio de reportes).
- `domain/programacion.js` — Programacion de reportes (servicio de reportes).

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/cursos.cliente.js` — Cliente del servicio de cursos, visto desde reportes.
- `infrastructure/client/evaluaciones.cliente.js` — Cliente del servicio de evaluaciones, visto desde reportes.
- `infrastructure/client/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde reportes.
- `infrastructure/client/identidad.cliente.js` — Cliente del servicio de identidad, visto desde reportes.
- `infrastructure/client/notificaciones.cliente.js` — Cliente del servicio de notificaciones, visto desde reportes.
- `infrastructure/client/seguridad.cliente.js` — Cliente del servicio de seguridad, visto desde reportes.
- `infrastructure/persistence/exportaciones.repositorio.js` — Repositorio de exportaciones de reportes (servicio de reportes).
- `infrastructure/persistence/organizacional.repositorio.js` — Repositorio del reporte organizacional (servicio de reportes).
- `infrastructure/persistence/programados.repositorio.js` — Repositorio de reportes programados (servicio de reportes).

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de reportes.

---

## seguridad

Deteccion de abuso de puntos (anomalias), auditoria de ajustes manuales y registro centralizado e inmutable de acciones criticas (data.logs).

- **Carpeta:** `human-firewall-backend/src/servicios/seguridad/`
- **Tablas propias:** `seguridad.anomaly_rules`, `seguridad.anomaly_events`, `seguridad.anomaly_status_history`, `seguridad.audit_log`, `data.logs`, `data.logs_purges`, `seguridad.activity_logs`
- **Publica:** `audit.log_recorded`
- **Consume:** `points_assigned`, `audit.log_recorded`
- **Depende de (por contrato interno):** identidad, gamificacion
- **Procesos de fondo:** Job de respaldo de deteccion de anomalias; Job de retencion de data.logs

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

Lo que otros servicios pueden usar, siempre a traves de un cliente en su `infrastructure/client/`: `registrarAccion`, `ACCIONES`, `MODULOS`, `auditarAjusteManual`.

### Estructura

**Raiz del servicio**

- `index.js` — Servicio de seguridad — puerta de entrada publica.
- `manifiesto.js` — Ficha del servicio de seguridad.

**config/** — Configuracion del servicio (equivale al application.yml)

- `config/configuracion.js` — Configuracion del servicio de seguridad (equivale al application.yml de la seccion 11 del material).

**controller/** — Controller / API: rutas, controladores y DTO

- `controller/ajustes.routes.js` — Ajuste manual de puntos, nivel o insignias, montado en /api/gamification/users.
- `controller/dto.js` — DTO del servicio de seguridad.
- `controller/logs.controller.js` — Consulta de los logs de auditoria (data.logs).
- `controller/logs.routes.js` — Rutas del registro de acciones criticas (data.logs), montadas en /api/logs.
- `controller/security.controller.js` — Panel de seguridad: anomalias y auditoria.
- `controller/seguridad.routes.js` — Rutas del panel de seguridad, montadas en /api/gamification/security.

**application/** — Application / Service: casos de uso

- `application/anomalies.service.js` — Deteccion de anomalias en la asignacion de puntos.
- `application/audit.service.js` — Auditoria de ajustes manuales.
- `application/cuentas.js` — Correos de las cuentas para los listados de seguridad.
- `application/dataLogs.service.js` — Registro centralizado de logs de auditoria (data.logs).

**domain/** — Domain: entidades y reglas de negocio

- `domain/anomalia.js` — Anomalias (servicio de seguridad).
- `domain/registro.js` — Registro de actividad (servicio de seguridad).

**infrastructure/** — Infrastructure: persistencia (repositorios), clientes de otros servicios e integraciones

- `infrastructure/client/gamificacion.cliente.js` — Cliente del servicio de gamificacion, visto desde seguridad.
- `infrastructure/client/identidad.cliente.js` — Cliente del servicio de identidad, visto desde seguridad.
- `infrastructure/persistence/anomalias.repositorio.js` — Repositorio de anomalias (servicio de seguridad).
- `infrastructure/persistence/auditoria.repositorio.js` — Repositorio de auditoria de ajustes manuales (servicio de seguridad).
- `infrastructure/persistence/logs.repositorio.js` — Repositorio del registro de actividad (servicio de seguridad).

**contract/** — Contrato publico OpenAPI

- `contract/openapi.js` — Contrato publico (OpenAPI) del servicio de seguridad.
