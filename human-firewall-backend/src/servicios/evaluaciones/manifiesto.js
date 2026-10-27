/** Ficha del servicio de evaluaciones. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'evaluaciones',
    responsabilidad:
        'Simulaciones de phishing (pasos, opciones y decisiones), desafios del portal ' +
        'y el historial de intentos de evaluacion con su puntaje calculado en el servidor.',
    prefijos: ['/api/simulations', '/api/gamification/challenge'],
    // Esquemas de PostgreSQL del servicio (migracion 090). Sus tablas viven ahi.
    esquemas: ['evaluaciones'],
    tablas: [
        'evaluaciones.simulations', 'evaluaciones.simulation_steps', 'evaluaciones.simulation_options', 'evaluaciones.simulation_results',
        'evaluaciones.challenges', 'evaluaciones.user_challenge_results', 'evaluaciones.quiz_attempts'
    ],
    publica: [
        'simulation.decision_made', 'simulation.completed', 'quiz.approved', 'quiz.failed'
    ],
    consume: [],
    dependeDe: ['cursos', 'gamificacion'],
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: []
};
