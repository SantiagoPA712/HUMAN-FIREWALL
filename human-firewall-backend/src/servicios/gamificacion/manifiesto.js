/** Ficha del servicio de gamificacion. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'gamificacion',
    responsabilidad:
        'Puntos (historial inmutable y reglas), recompensas e insignias, niveles, ' +
        'ranking y recomendaciones de refuerzo segun el desempeno.',
    prefijos: ['/api/gamification'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['gamificacion'],
    tablas: [
        'gamificacion.points_ledger', 'gamificacion.points_rules', 'gamificacion.v_user_points',
        'gamificacion.rewards_catalog', 'gamificacion.user_rewards', 'gamificacion.badges', 'gamificacion.user_badges',
        'gamificacion.levels_config', 'gamificacion.user_level_history',
        'gamificacion.recommendation_rules', 'gamificacion.user_recommendations'
    ],
    publica: ['points_assigned', 'level_up', 'reward_granted'],
    consume: [
        'lesson.completed', 'quiz.approved', 'course.completed',
        'simulation.decision_made', 'simulation.completed', 'points_assigned'
    ],
    dependeDe: ['identidad', 'cursos', 'evaluaciones', 'seguridad'],
    // Base de datos por servicio: no lee ni escribe tablas ajenas. La cache de
    // puntos y nivel de la cuenta se actualiza por el contrato de identidad, y
    // los intentos y cursos del resumen de desempeno se piden por contrato.
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: []
};
