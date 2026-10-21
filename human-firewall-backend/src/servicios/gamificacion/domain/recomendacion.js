/**
 * Recomendaciones (servicio de gamificacion).
 *
 * Capa Domain (seccion 11 del material): Regla de recomendaciones: que evaluaciones son un area de oportunidad.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

const REGLA_POR_DEFECTO = {
    code: 'refuerzo_por_puntaje_bajo',
    score_threshold: 70,
    include_failed: true,
    max_suggestions: 5
};

/**
 * Criterio de aceptacion 1: evaluaciones con menor puntaje y reprobadas.
 *
 * Una evaluacion es area de oportunidad en tres casos:
 *
 *   1. Nunca se aprobo.
 *   2. Su mejor puntaje sigue por debajo del umbral.
 *   3. El ULTIMO intento fallo o quedo bajo el umbral, aunque antes se haya
 *      aprobado. Este caso faltaba y era el mas grave: alguien que aprobo con
 *      100 y despues fallo dos veces seguidas no aparecia por ningun lado,
 *      porque solo se miraba el maximo historico. El sistema le respondia
 *      "ninguna evaluacion por debajo del 70%" justo cuando acababa de fallar.
 *
 * El mejor puntaje sigue contando para el caso 2: quien saco 45 y despues 90
 * ya domina el tema y no tiene sentido seguir marcandoselo.
 */
function filtrarAreasDeOportunidad(evaluaciones, regla) {
    return evaluaciones
        .map(e => {
            // Un intento suelto puede no traer los campos del ultimo intento
            // (por ejemplo si la evaluacion viene de otra consulta): en ese
            // caso se cae al mejor puntaje, que siempre esta.
            const ultimoPuntaje = e.ultimo_puntaje != null ? e.ultimo_puntaje : e.mejor_puntaje;
            const ultimoAprobado = e.ultimo_aprobado != null ? e.ultimo_aprobado : e.aprobada;

            const nuncaAprobada = !e.aprobada;
            const mejorBajoUmbral = e.mejor_puntaje < regla.score_threshold;
            const retrocedio = e.aprobada && (!ultimoAprobado || ultimoPuntaje < regla.score_threshold);

            const esArea = (nuncaAprobada && regla.include_failed) || mejorBajoUmbral || retrocedio;
            if (!esArea) return null;

            let motivo;
            if (nuncaAprobada) {
                motivo = `Todavía no aprobás esta evaluación (mejor intento: ${e.mejor_puntaje}%)`;
            } else if (retrocedio) {
                motivo = !ultimoAprobado
                    ? `La aprobaste antes, pero tu último intento falló (${ultimoPuntaje}%)`
                    : `Tu último intento bajó a ${ultimoPuntaje}%, por debajo del ${regla.score_threshold}% esperado`;
            } else {
                motivo = `Tu mejor puntaje fue ${e.mejor_puntaje}%, por debajo del ${regla.score_threshold}% esperado`;
            }

            return { ...e, ultimo_puntaje: ultimoPuntaje, retrocedio, motivo };
        })
        .filter(Boolean);
}

module.exports = { REGLA_POR_DEFECTO, filtrarAreasDeOportunidad };
