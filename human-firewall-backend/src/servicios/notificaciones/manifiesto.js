/** Ficha del servicio de notificaciones. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'notificaciones',
    responsabilidad:
        'Avisos in-app, notificacion de resultados (con alerta a RH en cursos criticos), ' +
        'preferencias por canal y cola de correo con plantillas versionadas e idioma.',
    prefijos: ['/api/notifications'],
    tablas: [
        'notifications', 'notification_deliveries', 'notification_preferences',
        'email_jobs', 'email_job_attempts', 'email_notification_types',
        'email_preferences', 'email_templates'
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
