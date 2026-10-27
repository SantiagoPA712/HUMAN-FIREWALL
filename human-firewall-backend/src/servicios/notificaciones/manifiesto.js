/** Ficha del servicio de notificaciones. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'notificaciones',
    responsabilidad:
        'Avisos in-app, notificacion de resultados (con alerta a RH en cursos criticos), ' +
        'preferencias por canal y cola de correo con plantillas versionadas e idioma.',
    prefijos: ['/api/notifications'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['notificaciones'],
    tablas: [
        'notificaciones.notifications', 'notificaciones.notification_deliveries', 'notificaciones.notification_preferences',
        'notificaciones.email_jobs', 'notificaciones.email_job_attempts', 'notificaciones.email_notification_types',
        'notificaciones.email_preferences', 'notificaciones.email_templates'
    ],
    publica: [],
    consume: [
        'user.registered', 'level_up', 'reward_granted',
        'quiz.approved', 'quiz.failed', 'course.completed', 'simulation.completed',
        'course.assigned', 'course.deadline_approaching', 'user.password_changed', 'user.invited'
    ],
    dependeDe: ['identidad', 'cursos', 'evaluaciones'],
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: ['Worker de la cola de correo (email_jobs)']
};
