/**
 * Periodos de reporte (servicio de reportes).
 *
 * Capa Domain (seccion 11 del material): Reglas de los periodos mensuales (YYYY-MM) y de la variacion porcentual entre dos periodos.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

const FORMATO_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/;

function esPeriodoValido(periodo) {
    return typeof periodo === 'string' && FORMATO_PERIODO.test(periodo);
}

/** Periodo (YYYY-MM) que contiene una fecha. */
function periodoDe(fecha = new Date()) {
    const d = new Date(fecha);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** El mes anterior a un periodo. '2026-01' -> '2025-12'. */
function periodoAnterior(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    const d = new Date(Date.UTC(anio, mes - 2, 1));
    return periodoDe(d);
}

/**
 * Rango [inicio, fin) del periodo, en UTC.
 *
 * Medio abierto y no cerrado: con `< fin` no hay que preocuparse por el ultimo
 * milisegundo del mes, que es la clase de detalle que hace que un movimiento
 * de las 23:59:59.700 del 31 no aparezca en ningun periodo.
 */
function rangoDePeriodo(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    return {
        inicio: new Date(Date.UTC(anio, mes - 1, 1)).toISOString(),
        fin: new Date(Date.UTC(anio, mes, 1)).toISOString()
    };
}

/**
 * Variacion porcentual entre dos periodos (criterio tecnico 4).
 *
 * La formula es la del criterio, literal: (period_b - period_a) / period_a.
 * `a` es el periodo base (el anterior) y `b` el consultado.
 *
 * Los dos casos que no son un numero se devuelven explicitos y no como error:
 *   - falta el valor de alguno de los dos periodos,
 *   - el periodo base es 0 (la division no existe; y "creci infinito desde
 *     cero" no es informacion util para un gerente).
 *
 * @returns {{variacion: number|null, variacion_porcentaje: number|null, tendencia: string, motivo: string|null}}
 */
function calcularVariacion(valorA, valorB) {
    if (valorA == null || valorB == null) {
        return {
            variacion: null, variacion_porcentaje: null,
            tendencia: 'sin_datos_comparables',
            motivo: 'No hay snapshot de alguno de los dos periodos.'
        };
    }

    if (Number(valorA) === 0) {
        return {
            variacion: null, variacion_porcentaje: null,
            tendencia: 'sin_datos_comparables',
            motivo: 'El periodo base es 0: la variacion porcentual no esta definida.'
        };
    }

    const variacion = (Number(valorB) - Number(valorA)) / Number(valorA);

    return {
        variacion: Math.round(variacion * 10000) / 10000,
        variacion_porcentaje: Math.round(variacion * 1000) / 10,
        tendencia: variacion > 0 ? 'positiva' : (variacion < 0 ? 'negativa' : 'sin_cambio'),
        motivo: null
    };
}

module.exports = { FORMATO_PERIODO, esPeriodoValido, periodoDe, periodoAnterior, rangoDePeriodo, calcularVariacion };
