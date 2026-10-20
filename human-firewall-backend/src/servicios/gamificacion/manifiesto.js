/** Ficha del servicio de gamificacion. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'gamificacion',
    responsabilidad:
        'Puntos (historial inmutable y reglas), recompensas e insignias, niveles, ' +
        'ranking y recomendaciones de refuerzo segun el desempeno.',
    prefijos: ['/api/gamification'],
    tablas: [
        'points_ledger', 'points_rules', 'v_user_points',
        'rewards_catalog', 'user_rewards', 'badges', 'user_badges',
        'levels_config', 'user_level_history',
        'recommendation_rules', 'user_recommendations'
    ],
    publica: ['points_assigned', 'level_up', 'reward_granted'],
    consume: [
        'lesson.completed', 'quiz.approved', 'course.completed',
        'simulation.decision_made', 'simulation.completed', 'points_assigned'
    ],
    dependeDe: ['identidad', 'cursos', 'evaluaciones', 'seguridad'],
    lecturasCompartidas: [
        {
            tabla: 'users', servicio: 'identidad',
            motivo: 'El ranking ordena por las columnas de cache total_points y level, que vive en users ' +
                    'y mantiene este mismo servicio (ver escriturasCompartidas).'
        },
        {
            tablas: ['quiz_attempts', 'challenges', 'simulations'], servicio: 'evaluaciones',
            motivo: 'El resumen de desempeno y las recomendaciones agregan el historial de intentos en ' +
                    'una sola consulta. Es una proyeccion de lectura: nunca escribe en esas tablas.'
        },
        {
            tablas: ['courses', 'course_contents', 'course_assignments', 'lesson_progress'], servicio: 'cursos',
            motivo: 'Mismo caso: el avance por curso del resumen de desempeno se calcula con un JOIN.'
        }
    ],
    escriturasCompartidas: [
        {
            tabla: 'users', servicio: 'identidad', columnas: ['total_points', 'level'],
            motivo: 'Cache desnormalizada del total y del nivel. La fuente de verdad es points_ledger; ' +
                    'identidad no escribe nunca estas dos columnas.'
        }
    ],
    procesos: []
};
