/** Ficha del servicio de evaluaciones. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'evaluaciones',
    responsabilidad:
        'Simulaciones de phishing (pasos, opciones y decisiones), desafios del portal ' +
        'y el historial de intentos de evaluacion con su puntaje calculado en el servidor.',
    prefijos: ['/api/simulations', '/api/gamification/challenge'],
    tablas: [
        'simulations', 'simulation_steps', 'simulation_options', 'simulation_results',
        'challenges', 'user_challenge_results', 'quiz_attempts'
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
