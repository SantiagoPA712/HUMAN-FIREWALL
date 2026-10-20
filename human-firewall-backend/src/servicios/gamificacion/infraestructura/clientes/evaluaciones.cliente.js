/** Cliente del servicio de evaluaciones, visto desde gamificacion. */
const evaluaciones = () => require('../../../evaluaciones');

module.exports = {
    contarEvaluacionesAprobadas: (userId) => evaluaciones().contarEvaluacionesAprobadas(userId),
    ultimosResultados: (userId, limite) => evaluaciones().ultimosResultados(userId, limite)
};
