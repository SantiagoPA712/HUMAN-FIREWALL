/** Cliente del servicio de evaluaciones, visto desde gamificacion. */
const evaluaciones = () => require('../../../evaluaciones/index');

module.exports = {
    contarEvaluacionesAprobadas: (userId) => evaluaciones().contarEvaluacionesAprobadas(userId),
    ultimosResultados: (userId, limite) => evaluaciones().ultimosResultados(userId, limite),
    /** Recomendaciones: resultados consolidados, pendientes y serie de intentos. */
    resultadosConsolidados: (userId) => evaluaciones().resultadosConsolidados(userId),
    pendientesDe: (userId, cursosAsignados) => evaluaciones().pendientesDe(userId, cursosAsignados),
    serieDeIntentos: (userId) => evaluaciones().serieDeIntentos(userId)
};
