/**
 * Resultados organizacionales consolidados.
 *
 * HU: "quiero ver resultados organizacionales consolidados del sistema de
 * gamificacion para evaluar el impacto del programa en el desempeno general
 * de la organizacion".
 *
 * ---------------------------------------------------------------------
 * La decision central: precalcular
 * ---------------------------------------------------------------------
 * Criterio tecnico 2: el endpoint NO consulta points_ledger. Lee
 * org_kpi_snapshots, que un job periodico llena.
 *
 * No es una optimizacion prematura. El reporte de RH (reports.service) es
 * pesado pero acotado: pagina de a 50 usuarios. Este consolida a TODA la
 * organizacion y ademas la compara contra otro periodo, o sea que en caliente
 * recorreria el historial completo de movimientos dos veces por cada vez que
 * un gerente abre el dashboard. Con el precalculo, la pantalla hace una
 * consulta indexada sobre un punado de filas.
 *
 * La contrapartida honesta: los numeros son del ultimo recalculo, no de este
 * segundo. Por eso toda respuesta viaja con `calculado_en`, y cuando todavia
 * no hay snapshot del periodo se responde un estado explicito
 * ("pendiente_de_calculo") en lugar de un cero que parezca un dato real.
 *
 * ---------------------------------------------------------------------
 * Que es un "area"
 * ---------------------------------------------------------------------
 * La tabla teams de la migracion 025. Ya es el area/departamento de cada
 * persona (users.team_id) y es lo que filtra el reporte de RH. Una tabla
 * areas paralela partiria la organizacion en dos jerarquias que habria que
 * mantener sincronizadas a mano.
 *
 * Las personas sin area entran en el consolidado general pero no forman un
 * area propia: en org_kpi_snapshots, area_id NULL ya significa "toda la
 * organizacion" y no puede significar dos cosas a la vez.
 */

const config = require('../config/configuracion');
// Escalera de niveles y progreso: por el contrato de gamificacion.
const gamificacion = require('../infrastructure/client/gamificacion.cliente');
const { FORMATO_PERIODO, esPeriodoValido, periodoDe, periodoAnterior, rangoDePeriodo, calcularVariacion } = require('../domain/periodo');
const repo = require('../infrastructure/persistence/organizacional.repositorio');

/**
 * Cada cuanto recalcula el job. Criterio tecnico 3: configurable, diaria por
 * defecto.
 */
const INTERVALO_JOB_MS =
    config.horasEntreSnapshotsDeKpis * 60 * 60 * 1000;

/** Cuantos periodos devuelve el grafico de tendencia (mockup 3). */
const PERIODOS_DE_TENDENCIA = 6;

let temporizador = null;

/**
 * Los cuatro KPIs del criterio de aceptacion 1, con lo necesario para
 * pintarlos sin que el frontend tenga que saber que significa cada codigo.
 *
 * `unidad` no es decoracion: una variacion del 10% sobre un porcentaje y una
 * sobre un promedio se leen distinto, y la pantalla necesita saber cual es
 * cual para no escribir "62.5%%".
 */
const KPIS = {
    participacion: {
        etiqueta: 'Participacion',
        unidad: '%',
        descripcion: 'Porcentaje de personas activas con al menos una actividad registrada en el periodo.'
    },
    progreso_promedio: {
        etiqueta: 'Progreso promedio por nivel',
        unidad: 'nivel',
        descripcion: 'Nivel promedio de la organizacion al cierre del periodo, calculado con la escalera de levels_config.'
    },
    cursos_completados: {
        etiqueta: 'Cursos completados',
        unidad: 'cursos',
        descripcion: 'Asignaciones de curso marcadas como completadas dentro del periodo.'
    },
    engagement: {
        etiqueta: 'Engagement general',
        unidad: 'acciones/persona',
        descripcion: 'Acciones registradas (puntos, evaluaciones y lecciones) por persona del padron.'
    }
};

// ---------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------
//
// El grano es el mes: es lo que pide la HU al hablar de "mes actual vs
// anterior", y es el unico grano en el que los KPIs de una organizacion chica
// dejan de ser ruido.

// ---------------------------------------------------------------------
// Calculo de los KPIs (criterio tecnico 3)
// ---------------------------------------------------------------------



/**
 * Normaliza las filas de una consulta agrupada a { areaId, esTotal, ...fila }.
 *
 * Descarta el grupo de las personas sin area (team_id NULL y GROUPING = 0):
 * su actividad ya esta contada en el total, y no puede tener snapshot propio
 * porque area_id NULL significa "toda la organizacion".
 */
function normalizarGrupos(rows) {
    return rows
        .filter(r => r.total_org === 1 || r.area_id !== null)
        .map(r => ({ ...r, areaId: r.total_org === 1 ? null : r.area_id }));
}

/** Participacion: activos / padron * 100. */
async function calcularParticipacion(inicio, fin) {
    const rows = await repo.participacionPorArea(inicio, fin);

    return normalizarGrupos(rows).map(r => ({
        areaId: r.areaId,
        kpi: 'participacion',
        // Sin padron no hay porcentaje: 0/0 es 0, no "nadie participo".
        valor: r.padron > 0 ? Math.round((r.activos * 10000) / r.padron) / 100 : 0,
        metadata: { activos: r.activos, padron: r.padron }
    }));
}

/**
 * Progreso promedio por nivel.
 *
 * El nivel NO se recalcula aca con una formula propia: se pide la escalera a
 * levels.service y se aplica su funcion pura, igual que hace el reporte de
 * RH. Si manana se mueven los umbrales, este archivo no se toca.
 *
 * Se toman los puntos acumulados hasta el CIERRE del periodo, no los del
 * periodo: el nivel es una posicion alcanzada, no una produccion mensual.
 */
async function calcularProgresoPromedio(inicio, fin) {
    const [{ rows: usuarios }, escalera] = await Promise.all([
        repo.puntosPorUsuarioHasta(fin),
        gamificacion.obtenerEscalera()
    ]);

    // Acumuladores: uno por area, mas el de toda la organizacion (clave null).
    const acumulado = new Map([[null, { suma: 0, usuarios: 0 }]]);

    for (const u of usuarios) {
        const progreso = gamificacion.calcularProgreso(u.puntos, escalera);
        const nivel = progreso.nivel_actual || 0;

        const total = acumulado.get(null);
        total.suma += nivel;
        total.usuarios += 1;

        if (u.team_id == null) continue;   // sin area: cuenta en el total, no en un area

        if (!acumulado.has(u.team_id)) acumulado.set(u.team_id, { suma: 0, usuarios: 0 });
        const area = acumulado.get(u.team_id);
        area.suma += nivel;
        area.usuarios += 1;
    }

    return [...acumulado.entries()].map(([areaId, a]) => ({
        areaId,
        kpi: 'progreso_promedio',
        valor: a.usuarios > 0 ? Math.round((a.suma * 100) / a.usuarios) / 100 : 0,
        metadata: { suma_niveles: a.suma, usuarios: a.usuarios }
    }));
}

/** Cursos completados dentro del periodo. */
async function calcularCursosCompletados(inicio, fin) {
    const rows = await repo.cursosCompletadosPorArea(inicio, fin);

    return normalizarGrupos(rows).map(r => ({
        areaId: r.areaId,
        kpi: 'cursos_completados',
        valor: r.cursos,
        metadata: { cursos: r.cursos, personas: r.personas }
    }));
}

/**
 * Engagement: acciones registradas por persona del padron.
 *
 * "Acciones" son los tres hechos que el sistema registra por si mismo
 * (movimientos de puntos, intentos de evaluacion, lecciones completadas). No
 * incluye inicios de sesion ni navegacion: eso no se guarda en ningun lado, y
 * un KPI que finge medir lo que no mide es peor que no tenerlo.
 */
async function calcularEngagement(inicio, fin) {
    const rows = await repo.engagementPorArea(inicio, fin);

    return normalizarGrupos(rows).map(r => ({
        areaId: r.areaId,
        kpi: 'engagement',
        valor: r.padron > 0 ? Math.round((r.acciones * 100) / r.padron) / 100 : 0,
        metadata: { acciones: r.acciones, padron: r.padron }
    }));
}

/**
 * Completa con ceros las areas activas que no produjeron ninguna fila.
 *
 * Las consultas agrupan sobre users: un area sin nadie asignado no aparece en
 * ningun grupo y se quedaria sin snapshot. Al consultarla, la pantalla diria
 * "calculo pendiente", que es falso -- el calculo corrio, lo que no hay es
 * gente. El snapshot en cero, con `padron: 0` en el detalle, dice la verdad.
 */
function completarAreasSinGente(medidas, areas) {
    const existentes = new Set(medidas.map(m => `${m.areaId}:${m.kpi}`));
    const completadas = [...medidas];

    for (const area of areas) {
        for (const kpi of Object.keys(KPIS)) {
            if (existentes.has(`${area.id}:${kpi}`)) continue;
            completadas.push({
                areaId: area.id,
                kpi,
                valor: 0,
                metadata: { padron: 0, sin_personas: true }
            });
        }
    }

    return completadas;
}

/**
 * Recalcula y guarda los snapshots de un periodo (criterio tecnico 3).
 *
 * Siempre INSERTA. Nunca actualiza ni borra: "sin sobrescribir snapshots
 * anteriores". Dos corridas del mismo periodo dejan dos snapshots, y la
 * lectura toma el mas reciente. El costo es una tabla que crece; a cambio, se
 * puede reconstruir como se veia un KPI antes de que alguien cargara datos
 * viejos.
 *
 * @param {string} [periodo]  YYYY-MM. Por defecto, el mes en curso.
 * @returns {Promise<{periodo: string, snapshots: number}>}
 */
async function recalcularPeriodo(periodo = periodoDe()) {
    if (!esPeriodoValido(periodo)) {
        const error = new Error(`Periodo invalido: "${periodo}". Se espera YYYY-MM.`);
        error.campo = 'period';
        throw error;
    }

    const { inicio, fin } = rangoDePeriodo(periodo);

    const medidas = completarAreasSinGente([
        ...await calcularParticipacion(inicio, fin),
        ...await calcularProgresoPromedio(inicio, fin),
        ...await calcularCursosCompletados(inicio, fin),
        ...await calcularEngagement(inicio, fin)
    ], await obtenerAreas());

    for (const m of medidas) {
        await repo.insertarSnapshot(periodo, m);
    }

    console.log(`[org-kpis] periodo ${periodo}: ${medidas.length} snapshots recalculados`);
    return { periodo, snapshots: medidas.length };
}

/**
 * Job periodico.
 *
 * Recalcula el mes en curso y tambien el anterior: un movimiento con fecha
 * del 31 puede insertarse el 1ro (un evento demorado en la cola, una
 * simulacion que se cerro a medianoche), y si el mes anterior no se volviera
 * a mirar nunca, ese dato no entraria en ningun snapshot.
 */
async function ejecutarJob() {
    const actual = periodoDe();
    const anterior = periodoAnterior(actual);

    const resultados = [];
    for (const periodo of [anterior, actual]) {
        resultados.push(await recalcularPeriodo(periodo));
    }
    return resultados;
}

function iniciarJob() {
    if (temporizador) return;

    temporizador = setInterval(
        () => ejecutarJob().catch(e => console.error('[org-kpis] job:', e.message)),
        INTERVALO_JOB_MS
    );
    if (temporizador.unref) temporizador.unref();

    // Primera corrida poco despues del arranque.
    //
    // Sin esto, un sistema recien desplegado muestra "calculo pendiente"
    // durante 24 horas, y el estado que el criterio tecnico 2 pide para el
    // caso raro (todavia no se calculo) seria el caso normal.
    const arranque = setTimeout(
        () => ejecutarJob().catch(e => console.error('[org-kpis] calculo inicial:', e.message)),
        5000
    );
    if (arranque.unref) arranque.unref();

    console.log(`[org-kpis] job de recalculo cada ${INTERVALO_JOB_MS / 3600000} h`);
}

function detenerJob() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

// ---------------------------------------------------------------------
// Lectura (criterio tecnico 2)
// ---------------------------------------------------------------------

/**
 * Ultimo snapshot de cada KPI para un periodo y un area.
 *
 * DISTINCT ON: de todas las corridas guardadas para esa combinacion, la mas
 * reciente. `IS NOT DISTINCT FROM` y no `=` porque area_id NULL (toda la
 * organizacion) es un valor con significado, y `= NULL` no compara: filtra.
 *
 * @param {string} periodo
 * @param {number|null} areaId
 * @returns {Promise<Map<string, {value: number, metadata: object, calculated_at: Date}>>}
 */
async function obtenerSnapshots(periodo, areaId = null) {
    const rows = await repo.snapshotsDe(periodo, areaId);

    const mapa = new Map();
    for (const r of rows) {
        mapa.set(r.kpi_type, {
            value: Number(r.value),
            metadata: r.metadata,
            calculated_at: r.calculated_at
        });
    }
    return mapa;
}

/**
 * Verifica que el area exista y este activa (criterio tecnico 5).
 *
 * Devuelve el area, o lanza un error con `codigo = 404` para que el
 * controlador lo traduzca sin tener que conocer la tabla.
 */
async function validarArea(areaId) {
    const id = Number(areaId);

    if (!Number.isInteger(id) || id <= 0) {
        const error = new Error(`area_id invalido: "${areaId}". Debe ser un entero positivo.`);
        error.codigo = 400;
        error.campo = 'area_id';
        throw error;
    }

    const rows = await repo.buscarArea(id);

    // Un area desactivada se trata igual que una inexistente: el criterio pide
    // "que exista y este activa". La diferencia se explica en el mensaje, para
    // que quien la consulta entienda que no escribio mal el id.
    if (rows.length === 0) {
        const error = new Error(`No existe ningun area con id ${id}.`);
        error.codigo = 404;
        error.area_id = id;
        throw error;
    }

    if (!rows[0].is_active) {
        const error = new Error(`El area ${id} (${rows[0].name}) esta desactivada.`);
        error.codigo = 404;
        error.area_id = id;
        throw error;
    }

    return rows[0];
}

/** Areas activas, para el selector del dashboard. */
async function obtenerAreas() {
    const rows = await repo.areasActivas();
    return rows;
}

/**
 * Serie de un KPI a lo largo de los ultimos periodos (mockup 3).
 *
 * Solo devuelve periodos que tengan snapshot: un hueco en el grafico dice la
 * verdad ("de ese mes no hay calculo"), y rellenarlo con ceros seria dibujar
 * una caida que nunca ocurrio.
 */
async function obtenerTendencia(kpi, areaId, hastaPeriodo, limite = PERIODOS_DE_TENDENCIA) {
    const rows = await repo.tendenciaDe(kpi, areaId, hastaPeriodo, limite);

    return rows
        .map(r => ({ period: r.period, valor: Number(r.value) }))
        .reverse();   // del mas viejo al mas nuevo, que es como se lee un grafico
}

/**
 * Bitacora de acceso (criterio tecnico 6).
 *
 * Se registra el intento, no el exito: si alguien consulta un area que no
 * existe, eso tambien es informacion para quien revise la bitacora.
 *
 * Queda en la tabla y en el log del servidor. En ningun endpoint: la tabla
 * org_report_access_log no se lee desde ninguna ruta de la API, y esa ausencia
 * es intencional.
 */
async function registrarConsulta({ userId, periodo, compararCon, areaId }) {
    const parametros = { period: periodo, compare_to: compararCon, area_id: areaId ?? null };

    await repo.registrarConsulta(userId, periodo, compararCon, areaId, parametros);

    console.log(
        `[org-reportes] consulta organizacional usuario=${userId} ` +
        `parametros=${JSON.stringify(parametros)} en=${new Date().toISOString()}`
    );
}

/**
 * El reporte organizacional completo.
 *
 * @param {object} opciones
 * @param {number} opciones.userId       quien consulta (para la bitacora)
 * @param {string} [opciones.periodo]    YYYY-MM; por defecto el mes en curso
 * @param {string} [opciones.compararCon] YYYY-MM; por defecto el mes anterior
 * @param {number} [opciones.areaId]     null = toda la organizacion
 */
async function obtenerReporteOrganizacional({ userId, periodo, compararCon, areaId = null } = {}) {
    const periodoConsultado = periodo || periodoDe();

    if (!esPeriodoValido(periodoConsultado)) {
        const error = new Error(`Periodo invalido: "${periodoConsultado}". Se espera YYYY-MM.`);
        error.codigo = 400;
        error.campo = 'period';
        throw error;
    }

    const periodoBase = compararCon || periodoAnterior(periodoConsultado);
    if (!esPeriodoValido(periodoBase)) {
        const error = new Error(`Periodo de comparacion invalido: "${periodoBase}". Se espera YYYY-MM.`);
        error.codigo = 400;
        error.campo = 'compare_to';
        throw error;
    }

    // La bitacora va antes que cualquier lectura de datos: se registra la
    // consulta, no el resultado.
    //
    // Sin userId no se registra nada: ese caso es el reporte automatico, donde
    // no hay una persona consultando. La bitacora del criterio tecnico 6
    // responde "quien miro estos datos", y anotar ahi al propio sistema
    // llenaria de ruido la unica tabla que sirve para contestar esa pregunta.
    if (userId) {
        await registrarConsulta({
            userId, periodo: periodoConsultado, compararCon: periodoBase, areaId
        });
    }

    // Criterio tecnico 5: el area se valida ANTES de segmentar. Si no existe,
    // el 404 sale sin haber leido un solo snapshot.
    const area = areaId == null || areaId === '' ? null : await validarArea(areaId);
    const areaFiltrada = area ? area.id : null;

    const [actual, base, tendencia, areas] = await Promise.all([
        obtenerSnapshots(periodoConsultado, areaFiltrada),
        obtenerSnapshots(periodoBase, areaFiltrada),
        obtenerTendencia('engagement', areaFiltrada, periodoConsultado),
        obtenerAreas()
    ]);

    // Criterio tecnico 2: sin snapshot del periodo, estado explicito. No un
    // 500, no una lista de ceros que se lea como "la organizacion no hizo
    // nada".
    if (actual.size === 0) {
        return {
            period: periodoConsultado,
            compare_to: periodoBase,
            area: area ? { id: area.id, name: area.name } : null,
            estado: 'pendiente_de_calculo',
            mensaje: `Todavia no hay KPIs calculados para ${periodoConsultado}. ` +
                     `El recalculo corre de forma periodica; volve a consultar mas tarde.`,
            kpis: [],
            tendencia,
            areas_disponibles: areas,
            calculado_en: null
        };
    }

    const kpis = Object.entries(KPIS).map(([codigo, definicion]) => {
        const snapshotActual = actual.get(codigo);
        const snapshotBase = base.get(codigo);

        return {
            kpi_type: codigo,
            etiqueta: definicion.etiqueta,
            unidad: definicion.unidad,
            descripcion: definicion.descripcion,
            valor: snapshotActual ? snapshotActual.value : null,
            valor_comparado: snapshotBase ? snapshotBase.value : null,
            detalle: snapshotActual ? snapshotActual.metadata : null,
            ...calcularVariacion(
                snapshotBase ? snapshotBase.value : null,
                snapshotActual ? snapshotActual.value : null
            )
        };
    });

    // El calculo mas reciente entre los KPIs del periodo: es lo que le dice al
    // gerente que tan fresco es lo que esta mirando.
    const calculadoEn = [...actual.values()]
        .map(s => s.calculated_at)
        .sort()
        .pop() || null;

    return {
        period: periodoConsultado,
        compare_to: periodoBase,
        area: area ? { id: area.id, name: area.name } : null,
        estado: 'listo',
        kpis,
        tendencia,
        areas_disponibles: areas,
        calculado_en: calculadoEn
    };
}

// ---------------------------------------------------------------------
// Archivo para el reporte automatico
// ---------------------------------------------------------------------

/**
 * CSV del consolidado organizacional.
 *
 * Lo usa la HU de reportes automaticos cuando la programacion es de tipo
 * 'organizational'. Se apoya en el mismo escapado del servicio de
 * exportaciones (neutraliza la inyeccion de formulas de Excel) en vez de
 * escribir uno propio.
 *
 * @returns {Promise<{buffer: Buffer, mime: string, filas: number}>}
 */
async function generarCsvOrganizacional({ periodo, areaId = null }) {
    const { escaparCSV } = require('../../../compartido/utils/csv');

    const reporte = await obtenerReporteOrganizacional({
        userId: null, periodo, areaId
    });

    // Sin snapshots no se entrega un archivo con solo encabezados: eso llegaria
    // a gerencia como "la organizacion no hizo nada". Se falla con un mensaje
    // claro, que queda en report_history y se avisa al equipo tecnico.
    if (reporte.estado !== 'listo') {
        throw new Error(
            `No hay KPIs calculados para el periodo ${reporte.period}: ` +
            `el reporte organizacional no se puede generar todavia.`
        );
    }

    const cabecera = ['KPI', 'Unidad', 'Valor', `Valor ${reporte.compare_to}`, 'Variacion %', 'Detalle'];
    const lineas = [cabecera.map(escaparCSV).join(',')];

    for (const k of reporte.kpis) {
        lineas.push([
            k.etiqueta,
            k.unidad,
            k.valor ?? 'sin datos',
            k.valor_comparado ?? 'sin datos',
            k.variacion_porcentaje ?? 'sin datos comparables',
            JSON.stringify(k.detalle || {})
        ].map(escaparCSV).join(','));
    }

    return {
        // BOM UTF-8, igual que el resto de las exportaciones: sin el, Excel en
        // Windows rompe los acentos.
        buffer: Buffer.from('﻿' + lineas.join('\r\n'), 'utf8'),
        mime: 'text/csv; charset=utf-8',
        filas: reporte.kpis.length
    };
}

/**
 * Este servicio no se suscribe a ningun evento: su trabajo es un job
 * periodico, no una reaccion.
 *
 * La funcion existe igual porque events/suscriptores.js recorre la lista de
 * servicios llamando a registrarHandlers(). Declararla vacia y explicita es
 * mas honesto que agregar un `if` en el cableado para saltear este caso.
 */
function registrarHandlers() {
    console.log('[orgReports.service] sin suscripciones: trabaja por job periodico');
}

module.exports = {
    KPIS,
    INTERVALO_JOB_MS,
    PERIODOS_DE_TENDENCIA,
    esPeriodoValido,
    periodoDe,
    periodoAnterior,
    rangoDePeriodo,
    recalcularPeriodo,
    ejecutarJob,
    iniciarJob,
    detenerJob,
    obtenerSnapshots,
    calcularVariacion,
    validarArea,
    obtenerAreas,
    obtenerTendencia,
    registrarConsulta,
    obtenerReporteOrganizacional,
    generarCsvOrganizacional,
    registrarHandlers
};
