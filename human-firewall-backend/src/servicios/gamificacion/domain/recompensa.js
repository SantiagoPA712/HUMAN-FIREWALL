/**
 * Recompensas (servicio de gamificacion).
 *
 * Capa Domain (seccion 11 del material): Regla de recompensas: el umbral que hay que alcanzar para obtener una recompensa.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/** Umbral configurado para una recompensa. */
function umbralDe(recompensa) {
    const params = recompensa.condition_params || {};
    const valor = Number(params.threshold);
    return Number.isFinite(valor) ? valor : Infinity;
}

module.exports = { umbralDe };
