/**
 * Niveles (servicio de gamificacion).
 *
 * Capa Domain (seccion 11 del material): Regla de niveles: en que nivel esta un usuario segun sus puntos y cuanto le falta para el siguiente.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/**
 * Calcula el nivel y el avance dentro de el. Funcion pura: no toca la base,
 * asi que se puede probar con cualquier escalera sin montar datos.
 *
 * El nivel es el mayor cuyo min_points no supera los puntos del usuario.
 *
 * @param {number} puntos
 * @param {Array}  escalera  ordenada por min_points ascendente
 */
function calcularProgreso(puntos, escalera) {
    if (!escalera || escalera.length === 0) {
        return {
            nivel_actual: null, nombre: null, puntos_actuales: puntos,
            porcentaje_avance: 0, es_nivel_maximo: true,
            siguiente_nivel: null, puntos_para_siguiente: null, puntos_faltantes: null
        };
    }

    let indice = 0;
    for (let i = 0; i < escalera.length; i++) {
        if (puntos >= escalera[i].min_points) indice = i;
        else break;
    }

    const actual = escalera[indice];
    const siguiente = escalera[indice + 1] || null;

    // En el ultimo nivel no hay "siguiente umbral": el avance es 100% y lo
    // que falta es 0. Devolver null en puntos_para_siguiente evita que el
    // frontend pinte una barra contra un objetivo inexistente.
    if (!siguiente) {
        return {
            nivel_actual: actual.level,
            nombre: actual.name,
            descripcion: actual.description,
            icon_url: actual.icon_url,
            nivel_min_puntos: actual.min_points,
            puntos_actuales: puntos,
            siguiente_nivel: null,
            siguiente_nombre: null,
            puntos_para_siguiente: null,
            puntos_faltantes: 0,
            porcentaje_avance: 100,
            es_nivel_maximo: true
        };
    }

    const rango = siguiente.min_points - actual.min_points;
    const avance = puntos - actual.min_points;

    return {
        nivel_actual: actual.level,
        nombre: actual.name,
        descripcion: actual.description,
        icon_url: actual.icon_url,
        nivel_min_puntos: actual.min_points,
        puntos_actuales: puntos,
        siguiente_nivel: siguiente.level,
        siguiente_nombre: siguiente.name,
        puntos_para_siguiente: siguiente.min_points,
        puntos_faltantes: Math.max(0, siguiente.min_points - puntos),
        // rango > 0 siempre, porque min_points es UNIQUE y esta ordenado.
        porcentaje_avance: Math.max(0, Math.min(100, Math.round(avance * 100 / rango))),
        es_nivel_maximo: false
    };
}

module.exports = { calcularProgreso };
