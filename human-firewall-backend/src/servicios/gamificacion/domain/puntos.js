/**
 * Puntos (servicio de gamificacion).
 *
 * Capa Domain (seccion 11 del material): Regla de puntos: cuantos puntos otorga una regla para un puntaje.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/** Calcula cuantos puntos otorga una regla para un puntaje dado. */
function calcularPuntos(regla, score) {
    if (regla.points_mode === 'by_score') {
        const s = Math.max(0, Math.min(100, Number(score) || 0));
        return Math.round(regla.points * s / 100);
    }
    return regla.points;
}

module.exports = { calcularPuntos };
