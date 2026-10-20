/**
 * Catalogo de eventos del sistema.
 *
 * Este archivo es el CONTRATO de la arquitectura basada en eventos: quien
 * publica no conoce a quien escucha, asi que lo unico que los mantiene unidos
 * es el nombre del evento y la forma de su payload. Si eso vive suelto como
 * cadenas repartidas por el codigo, un error de tipeo no falla: simplemente
 * el evento no le llega a nadie y el sintoma aparece lejos del origen.
 *
 * Regla: ningun modulo escribe el nombre de un evento a mano. Se importa de
 * aca.
 *
 * ---------------------------------------------------------------------
 * Nota sobre los nombres
 * ---------------------------------------------------------------------
 * Conviven dos estilos: 'lesson.completed' (punto) y 'points_assigned'
 * (guion bajo). Es una herencia de la HU de gamificacion y NO se unifico a
 * proposito: los nombres estan escritos en las filas de event_outbox que ya
 * existen en la base. Renombrarlos dejaria huerfano cualquier evento
 * pendiente o fallido (su handler ya no existiria bajo ese nombre) y
 * romperia el historial. El nombre de un evento es parte del contrato
 * publico: se agrega, no se renombra.
 */

/** Nombres de evento. Maximo 50 caracteres (event_outbox.event_name). */
const EVENTOS = {
    // --- Eventos de dominio: los publica quien ejecuta la accion ---

    /** Cuenta creada. { userId, email, role } */
    USER_REGISTERED: 'user.registered',

    /** Leccion marcada como completada. { userId, contentId } */
    LESSON_COMPLETED: 'lesson.completed',

    /** Ultima leccion del curso completada. { userId, courseId } */
    COURSE_COMPLETED: 'course.completed',

    /** Evaluacion o desafio aprobado.
     *  { userId, quizRef, quizType, score, passed, attemptNo?, basePoints?, courseId? }
     *
     *  `courseId` se sumo con la HU de notificacion de resultados: es lo que
     *  permite avisarle a RH cuando el contenido pertenece a un curso marcado
     *  como critico. Es un campo mas y opcional; quienes ya consumian el
     *  evento (points, rewards, recommendations) leen campos puntuales y no
     *  se enteran de el. */
    QUIZ_APPROVED: 'quiz.approved',

    /** Evaluacion o desafio reprobado.
     *  { userId, quizRef, quizType, score, passed: false, attemptId, attemptNo, courseId }
     *
     *  `attemptId` es el id de la fila de quiz_attempts y es quien IDENTIFICA
     *  el hecho: lo asigna la secuencia de la tabla, asi que dos envios
     *  simultaneos del mismo desafio nunca comparten valor. `attemptNo` es
     *  para el texto del aviso ("intento 2"); sale de un COUNT(*) sin lock y
     *  por lo tanto puede repetirse, asi que no sirve como identidad.
     *
     *  Se agrego con la HU de notificacion de resultados. Hasta entonces un
     *  intento reprobado quedaba en quiz_attempts y no publicaba nada: el
     *  modulo de puntos no lo necesitaba, porque reprobar no otorga puntos.
     *  Avisarle al usuario que reprobo si lo necesita, y un hecho que no se
     *  publica no se puede escuchar.
     *
     *  Nadie mas que las notificaciones lo consume: no otorga puntos, no
     *  mueve niveles y no dispara recompensas. */
    QUIZ_FAILED: 'quiz.failed',

    /** Decision tomada dentro de una simulacion.
     *  { userId, optionId, simulationId, stepId, isCorrect, points } */
    SIMULATION_DECISION_MADE: 'simulation.decision_made',

    /** Simulacion cerrada, con el intento ya registrado.
     *  { userId, simulationId, courseId, score, aprobada, aciertos, pasos,
     *    attemptId, attemptNo }
     *
     *  `attemptId` se sumo con la HU de notificacion de resultados, por la
     *  misma razon que en quiz.failed: identifica el intento sin depender de
     *  un numero calculado con COUNT(*), que dos envios simultaneos pueden
     *  repetir. Es un campo mas y no reemplaza a ninguno, asi que los
     *  suscriptores que ya existian siguen leyendo lo mismo de siempre. */
    SIMULATION_COMPLETED: 'simulation.completed',

    // --- Eventos de reaccion: los publican los propios servicios ---

    /** Se sumo un movimiento al historial de puntos.
     *  { userId, sourceType, sourceId, points, ledgerId } */
    POINTS_ASSIGNED: 'points_assigned',

    /** El usuario alcanzo uno o mas niveles nuevos.
     *  { userId, nivel, nombre, nivelesAlcanzados, puntos } */
    LEVEL_UP: 'level_up',

    /** Se otorgo una recompensa.
     *  { userId, rewardId, rewardName, userRewardId } */
    REWARD_GRANTED: 'reward_granted',

    /** Exportacion de reporte encolada por superar el umbral de filas.
     *  Solo se publica en el camino asincrono: por debajo del umbral el
     *  archivo se genera dentro del mismo request y no hay nada que encolar.
     *  { exportUid, userId, formato, filtros } */
    REPORT_EXPORT_REQUESTED: 'report.export_requested',

    /** El scheduler detecto que vencio el next_run_at de una programacion y
     *  encolo su generacion. Los parametros viajan congelados: si alguien
     *  edita la programacion mientras el job espera en la cola, el reporte
     *  sale con los filtros que estaban vigentes al dispararse.
     *  { scheduleId, tipo, formato, periodo, params } */
    REPORT_SCHEDULED_RUN: 'report.scheduled_run',

    /** Un reporte automatico quedo generado con exito. Separa la generacion
     *  del aviso: un servidor de correo caido no puede impedir que el reporte
     *  se genere, y por eso el envio se encola aparte.
     *  { historyId, scheduleId, periodo } */
    REPORT_AUTO_GENERATED: 'report.auto_generated',

    /** Se ejecuto una accion critica que debe quedar en data.logs (HU de
     *  logs de auditoria). Lo publica dataLogs.registrar() desde cualquier
     *  modulo; el worker lo persiste fuera del request, asi que la accion
     *  original no espera al log ni falla si el log falla.
     *  Los valores ya viajan enmascarados: la cola tampoco guarda secretos.
     *  { logUid, userId, actorType, actorEmail, actionType, module,
     *    resourceType, resourceId, oldValue, newValue, ipAddress, traceId,
     *    occurredAt } */
    AUDIT_LOG_RECORDED: 'audit.log_recorded',

    // --- HU de notificaciones por correo ---

    /** Se asigno un curso a un usuario. Lo publica course.controller en la
     *  misma transaccion que el INSERT de la asignacion.
     *  { userId, courseId, assignmentId, dueDate } (dueDate: ISO o null) */
    COURSE_ASSIGNED: 'course.assigned',

    /** Una asignacion abierta vence dentro de la ventana configurada
     *  (EMAIL_DEADLINE_WINDOW_HOURS). No lo publica una accion de nadie sino
     *  el reloj de emailNotifications, una sola vez por asignacion.
     *  { userId, courseId, assignmentId, dueDate } */
    COURSE_DEADLINE_APPROACHING: 'course.deadline_approaching',

    /** Se cambio la contrasena de una cuenta. Dispara un correo CRITICO de
     *  seguridad, que el usuario no puede desactivar.
     *  { userId, changedAt } */
    USER_PASSWORD_CHANGED: 'user.password_changed',

    // --- HU de invitaciones ---

    /** Un admin creo o reenvio una invitacion. Se publica en la misma
     *  transaccion que la fila, asi el correo existe si y solo si la
     *  invitacion existe. Lleva el token EN CLARO: en user_invitations solo
     *  queda el hash, y sin el token no hay enlace que mandar.
     *  { invitationId, email, role, language, token, expiresAt,
     *    invitedBy, invitedByEmail, sendNo } */
    USER_INVITED: 'user.invited'
};

/**
 * Quien reacciona a que. No lo lee el runtime: es documentacion ejecutable
 * para la prueba de eventos, que verifica que todo evento del catalogo tenga
 * al menos un suscriptor registrado y que nadie escuche un evento inexistente.
 */
const SUSCRIPTORES_ESPERADOS = {
    [EVENTOS.USER_REGISTERED]:           ['notifications'],
    [EVENTOS.LESSON_COMPLETED]:          ['points'],
    // resultNotifications se sumo con la HU de notificacion de resultados:
    // escucha los mismos hechos que ya se publicaban y arma el aviso con los
    // datos que trae el evento. No hubo que tocar a quien los publica, salvo
    // para crear quiz.failed, que no existia.
    [EVENTOS.COURSE_COMPLETED]:          ['points', 'rewards', 'resultNotifications'],
    [EVENTOS.QUIZ_APPROVED]:             ['points', 'rewards', 'recommendations', 'resultNotifications'],
    [EVENTOS.QUIZ_FAILED]:               ['resultNotifications'],
    [EVENTOS.SIMULATION_DECISION_MADE]:  ['points'],
    [EVENTOS.SIMULATION_COMPLETED]:      ['rewards', 'recommendations', 'resultNotifications'],
    // anomalies se sumo con la HU de seguridad: evalua cada asignacion contra
    // los umbrales de anomaly_rules. No hubo que tocar points.service, que es
    // quien publica: alcanzo con suscribirse.
    [EVENTOS.POINTS_ASSIGNED]:           ['rewards', 'levels', 'anomalies'],
    [EVENTOS.LEVEL_UP]:                  ['notifications'],
    [EVENTOS.REWARD_GRANTED]:            ['notifications'],
    [EVENTOS.REPORT_EXPORT_REQUESTED]:   ['reportExports'],
    // Los dos eventos de la HU de reportes automaticos los escucha el mismo
    // servicio, pero en dos handlers distintos: uno genera y el otro avisa.
    // Estan separados a proposito, para que un fallo al notificar no vuelva a
    // disparar la generacion cuando el bus reintente.
    [EVENTOS.REPORT_SCHEDULED_RUN]:      ['scheduledReports'],
    [EVENTOS.REPORT_AUTO_GENERATED]:     ['scheduledReports'],
    // Un solo suscriptor: el que escribe la fila. Cualquier modulo publica,
    // ninguno necesita saber que existe data.logs.
    [EVENTOS.AUDIT_LOG_RECORDED]:        ['dataLogs'],
    // HU de notificaciones por correo. Los resultados de evaluaciones NO
    // estan aca: esos ya los escucha resultNotifications, que le pide el
    // correo a emailNotifications como un canal mas.
    [EVENTOS.COURSE_ASSIGNED]:             ['emailNotifications'],
    [EVENTOS.COURSE_DEADLINE_APPROACHING]: ['emailNotifications'],
    [EVENTOS.USER_PASSWORD_CHANGED]:       ['emailNotifications'],
    [EVENTOS.USER_INVITED]:                ['emailNotifications']
};

/** Todos los nombres validos, para validar en publish(). */
const NOMBRES_VALIDOS = new Set(Object.values(EVENTOS));

module.exports = { EVENTOS, SUSCRIPTORES_ESPERADOS, NOMBRES_VALIDOS };
