/**
 * Programacion de reportes (servicio de reportes).
 *
 * Capa Domain (seccion 11 del material): Reglas de los reportes programados: tipos, frecuencias, formatos, periodo cubierto y proxima ejecucion.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/** Fecha UTC en formato YYYY-MM-DD. */
const soloFecha = (d) => d.toISOString().slice(0, 10);

const TIPOS = ['performance', 'organizational'];

const FRECUENCIAS = ['daily', 'weekly', 'monthly'];

const FORMATOS = ['csv', 'pdf'];

/** Numero de semana ISO 8601 de una fecha (la semana empieza el lunes). */
function semanaISO(fecha) {
    // Se corre la fecha al jueves de su semana: por definicion de ISO 8601,
    // el anio de la semana es el anio de ese jueves. Sin este paso, el 31 de
    // diciembre puede pertenecer a la semana 1 del anio siguiente y quedar
    // etiquetado con el anio equivocado.
    const jueves = new Date(fecha);
    jueves.setUTCDate(jueves.getUTCDate() + 3 - ((jueves.getUTCDay() + 6) % 7));

    const primeroDeEnero = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
    const dias = Math.round((jueves - primeroDeEnero) / 86400000);
    const semana = Math.ceil((dias + primeroDeEnero.getUTCDay() + 1) / 7);

    return `${jueves.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/**
 * Periodo que cubre una corrida.
 *
 * Es el periodo YA CERRADO anterior al momento de la corrida, no el que esta
 * en curso: un reporte semanal que se dispara el lunes informa la semana
 * pasada completa. Informar la semana en curso daria un numero que cambia
 * cada dia y que nadie puede comparar con el del lunes anterior.
 *
 * @returns {{clave: string, from: string, to: string}} rango inclusivo en
 *          formato YYYY-MM-DD, que es lo que esperan los filtros del reporte.
 */
function calcularPeriodo(frecuencia, referencia = new Date()) {
    const ref = new Date(referencia);
    const hoy = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    const DIA = 86400000;

    if (frecuencia === 'daily') {
        const ayer = new Date(hoy - DIA);
        return { clave: soloFecha(ayer), from: soloFecha(ayer), to: soloFecha(ayer) };
    }

    if (frecuencia === 'weekly') {
        // (getUTCDay() + 6) % 7 => 0 el lunes, 6 el domingo.
        const diaDeSemana = (new Date(hoy).getUTCDay() + 6) % 7;
        const lunesDeEstaSemana = hoy - diaDeSemana * DIA;
        const inicio = new Date(lunesDeEstaSemana - 7 * DIA);
        const fin = new Date(lunesDeEstaSemana - DIA);
        return { clave: semanaISO(inicio), from: soloFecha(inicio), to: soloFecha(fin) };
    }

    // mensual
    const inicio = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    const fin = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1) - DIA);
    return {
        clave: `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, '0')}`,
        from: soloFecha(inicio),
        to: soloFecha(fin)
    };
}

/**
 * Proxima ejecucion segun la frecuencia (criterio tecnico 1).
 *
 * Avanza desde la ejecucion prevista, no desde "ahora", y repite hasta pasar
 * el presente. Las dos cosas importan:
 *
 *   - Avanzar desde la prevista conserva la hora: una programacion de las
 *     08:00 sigue siendo de las 08:00 aunque el worker la haya tomado 08:04.
 *     Con `now() + intervalo` la hora se corre unos minutos en cada corrida y
 *     en un mes el reporte "de la manana" sale a la tarde.
 *
 *   - Repetir hasta pasar el presente evita la rafaga: si el servidor estuvo
 *     una semana apagado, una programacion diaria no dispara siete corridas
 *     seguidas de periodos viejos, dispara la de hoy.
 */
function calcularProximaEjecucion(frecuencia, prevista, ahora = new Date()) {
    const siguiente = new Date(prevista);
    const limite = new Date(ahora);
    let vueltas = 0;

    do {
        if (frecuencia === 'daily') siguiente.setUTCDate(siguiente.getUTCDate() + 1);
        else if (frecuencia === 'weekly') siguiente.setUTCDate(siguiente.getUTCDate() + 7);
        else siguiente.setUTCMonth(siguiente.getUTCMonth() + 1);

        // Tope de seguridad: con una fecha prevista absurdamente vieja (un
        // dato cargado a mano en 1970) el bucle diario daria decenas de miles
        // de vueltas. A partir de aca se salta al presente.
        if (++vueltas > 500) {
            const desdeAhora = new Date(limite);
            desdeAhora.setUTCDate(desdeAhora.getUTCDate() + 1);
            return desdeAhora;
        }
    } while (siguiente <= limite);

    return siguiente;
}

module.exports = { TIPOS, FRECUENCIAS, FORMATOS, soloFecha, semanaISO, calcularPeriodo, calcularProximaEjecucion };
