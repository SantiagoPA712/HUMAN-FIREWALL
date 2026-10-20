/**
 * Reglas de puntaje de las evaluaciones.
 *
 * Capa de dominio: funciones puras, sin base de datos, sin HTTP y sin
 * eventos. Reciben datos y devuelven un resultado, asi que se prueban con
 * una llamada y se pueden reutilizar desde cualquier caso de uso.
 *
 * Antes estas reglas vivian en medio de simulation.controller.js y
 * gamification.controller.js, entre consultas SQL y res.status().
 */

/** Puntaje minimo (0-100) para aprobar una simulacion o un desafio. */
const PUNTAJE_MINIMO = 60;

class ReglaDeEvaluacion extends Error {
    constructor(mensaje, campo) {
        super(mensaje);
        this.name = 'ReglaDeEvaluacion';
        this.campo = campo;
    }
}

/**
 * Calcula el resultado de una simulacion a partir de las opciones elegidas.
 *
 * El puntaje se calcula SIEMPRE en el servidor: aceptarlo del cliente
 * permitiria mandar { score: 100 } y aprobar sin jugar.
 *
 * @param {Array<{id, step_id, is_correct, points_awarded}>} opciones  todas las de la simulacion
 * @param {Array<number|string>} decisiones  ids de las opciones elegidas
 */
function calcularResultadoSimulacion(opciones, decisiones) {
    if (opciones.length === 0) {
        throw new ReglaDeEvaluacion('La simulación no tiene opciones configuradas', 'simulationId');
    }

    const porId = new Map(opciones.map(o => [o.id, o]));
    const elegidas = decisiones.map(Number);

    // Una opcion de otra simulacion inflaria el puntaje de esta.
    const ajena = elegidas.find(id => !porId.has(id));
    if (ajena !== undefined) {
        throw new ReglaDeEvaluacion(`La opción ${ajena} no pertenece a esta simulación`, 'decisiones');
    }

    // Techo del puntaje: la mejor opcion de cada paso.
    const mejorPorPaso = new Map();
    for (const o of opciones) {
        const previa = mejorPorPaso.get(o.step_id) || 0;
        if (o.points_awarded > previa) mejorPorPaso.set(o.step_id, o.points_awarded);
    }
    const puntajeMaximo = [...mejorPorPaso.values()].reduce((a, b) => a + b, 0);

    const seleccionadas = elegidas.map(id => porId.get(id));
    const puntajeObtenido = seleccionadas.reduce((a, o) => a + o.points_awarded, 0);
    const aciertos = seleccionadas.filter(o => o.is_correct).length;
    const pasos = mejorPorPaso.size;

    // Si ninguna opcion otorga puntos, el porcentaje sale de los aciertos:
    // dividir por cero daria NaN y romperia el CHECK de score.
    const score = puntajeMaximo > 0
        ? Math.round(puntajeObtenido * 100 / puntajeMaximo)
        : (pasos > 0 ? Math.round(aciertos * 100 / pasos) : 0);

    return {
        score,
        aprobada: score >= PUNTAJE_MINIMO,
        aciertos,
        pasos,
        puntajeObtenido,
        puntajeMaximo
    };
}

/**
 * Normaliza el resultado de un desafio del portal.
 *
 * `passed` es opcional y por defecto true para no romper a un cliente viejo
 * que no lo mande; las pantallas actuales siempre mandan el real. El puntaje
 * se acota a 0..100 y, si no viene, es 100 al aprobar y 0 al reprobar.
 */
function normalizarResultadoDesafio({ passed, score }) {
    const aprobado = passed !== false;
    const puntaje = Number.isInteger(score)
        ? Math.max(0, Math.min(100, score))
        : (aprobado ? 100 : 0);
    return { aprobado, puntaje };
}

/** Acota un puntaje a 0..100 (el CHECK de quiz_attempts.score). */
const acotar = (score) => Math.max(0, Math.min(100, score));

module.exports = {
    PUNTAJE_MINIMO,
    ReglaDeEvaluacion,
    calcularResultadoSimulacion,
    normalizarResultadoDesafio,
    acotar
};
