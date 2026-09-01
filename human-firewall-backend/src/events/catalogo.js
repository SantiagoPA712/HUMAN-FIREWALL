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
     *  { userId, quizRef, quizType, score, passed, attemptNo?, basePoints? } */
    QUIZ_APPROVED: 'quiz.approved',

    /** Decision tomada dentro de una simulacion.
     *  { userId, optionId, simulationId, stepId, isCorrect, points } */
    SIMULATION_DECISION_MADE: 'simulation.decision_made',

    /** Simulacion cerrada, con el intento ya registrado.
     *  { userId, simulationId, courseId, score, aprobada, aciertos, pasos, attemptNo } */
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
    REPORT_AUTO_GENERATED: 'report.auto_generated'
};

/**
 * Quien reacciona a que. No lo lee el runtime: es documentacion ejecutable
 * para la prueba de eventos, que verifica que todo evento del catalogo tenga
 * al menos un suscriptor registrado y que nadie escuche un evento inexistente.
 */
const SUSCRIPTORES_ESPERADOS = {
    [EVENTOS.USER_REGISTERED]:           ['notifications'],
    [EVENTOS.LESSON_COMPLETED]:          ['points'],
    [EVENTOS.COURSE_COMPLETED]:          ['points', 'rewards'],
    [EVENTOS.QUIZ_APPROVED]:             ['points', 'rewards', 'recommendations'],
    [EVENTOS.SIMULATION_DECISION_MADE]:  ['points'],
    [EVENTOS.SIMULATION_COMPLETED]:      ['rewards', 'recommendations'],
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
    [EVENTOS.REPORT_AUTO_GENERATED]:     ['scheduledReports']
};

/** Todos los nombres validos, para validar en publish(). */
const NOMBRES_VALIDOS = new Set(Object.values(EVENTOS));

module.exports = { EVENTOS, SUSCRIPTORES_ESPERADOS, NOMBRES_VALIDOS };
