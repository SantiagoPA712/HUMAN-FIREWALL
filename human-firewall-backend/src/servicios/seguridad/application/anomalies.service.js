/**
 * Deteccion de anomalias en la asignacion de puntos.
 *
 * HU: "quiero analizar metricas de uso y comportamiento del sistema de
 * gamificacion para detectar patrones anomalos o posible abuso del sistema de
 * puntos".
 *
 * ---------------------------------------------------------------------
 * Dos caminos hacia la misma deteccion
 * ---------------------------------------------------------------------
 * Criterio tecnico 1: en tiempo real, suscrito a points_assigned. El evento ya
 * existia (lo publica points.service dentro de la transaccion que escribe el
 * ledger), asi que no hubo que tocar nada del modulo de puntos: alcanza con
 * escuchar. Y como el bus es asincrono, la deteccion no retrasa ni un
 * milisegundo la respuesta de la accion que otorgo los puntos.
 *
 * Criterio tecnico 6: ademas, un job periodico reevalua la ventana reciente.
 * Es la red de seguridad para el caso en que un evento se pierda, quede
 * fallido tras agotar los reintentos, o el proceso se reinicie con la cola a
 * medio procesar. Una deteccion de abuso que depende de que ningun mensaje se
 * caiga no es una deteccion de abuso.
 *
 * Los dos caminos escriben por la misma funcion y comparten la misma clave de
 * deduplicacion, asi que ejecutar los dos sobre el mismo movimiento produce
 * una sola alerta.
 */

const config = require('../config/configuracion');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { ESTADOS } = require('../domain/anomalia');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const repo = require('../infrastructure/persistence/anomalias.repositorio');
// El historial de puntos y las cuentas viven en otras bases: se piden por contrato.
const gamificacion = require('../infrastructure/client/gamificacion.cliente');
const { conCuentas } = require('./cuentas');

/** Cada cuanto corre el job de respaldo. Configurable (criterio tecnico 6). */
const INTERVALO_JOB_MS =
    config.minutosEntreRevisionesDeAnomalias * 60 * 1000;

let temporizador = null;

/** Reglas activas. */
async function obtenerReglas() {
    const rows = await repo.reglasActivas();
    return rows;
}

/**
 * Movimientos de un usuario dentro de la ventana de una regla.
 *
 * Devuelve el detalle completo y no solo la suma: es la evidencia que pide el
 * criterio tecnico 2, y lo que permite que el panel muestre "de donde salieron
 * esos puntos" (criterio de aceptacion 1).
 */
async function movimientosEnVentana(userId, ventanaMinutos, hasta = null) {
    // El historial de puntos es de gamificacion (otra base): se pide por contrato.
    return gamificacion.movimientosEnVentana(userId, ventanaMinutos, hasta);
}

/**
 * Registra una anomalia. Idempotente por (regla, movimiento disparador).
 *
 * Criterio tecnico 6: la clave es source_id + rule_triggered. Con eso, el job
 * periodico puede reevaluar la misma ventana cuantas veces quiera sin generar
 * alertas duplicadas.
 *
 * @returns {Promise<object|null>} la anomalia creada, o null si ya existia
 */
async function registrarAnomalia({ userId, regla, movimientos, disparadorId }) {
    const totalVentana = movimientos.reduce((a, m) => a + m.points, 0);
    const dedupeKey = `${regla.code}:${disparadorId}`;

    const evidencia = {
        total_en_ventana: totalVentana,
        umbral: regla.max_points,
        ventana_minutos: regla.window_minutes,
        // Los movimientos concretos, con su origen. Congelados: si manana
        // cambia una regla de puntuacion, la evidencia sigue mostrando lo que
        // se vio al detectar.
        movimientos: movimientos.map(m => ({
            ledger_id: m.id,
            origen: m.source_type,
            referencia: m.source_id,
            puntos: m.points,
            regla_puntos: m.rule_code,
            fecha: m.created_at
        }))
    };

    // Una sola escritura: no hace falta transaccion. La deduplicacion la
    // garantiza el UNIQUE sobre dedupe_key, no un bloqueo.
    const rows = await repo.insertarAnomalia(userId, regla, evidencia, disparadorId, dedupeKey);

    if (rows.length === 0) return null;   // ya detectada

    // Queda en el log del servidor ademas de en la tabla: si alguien vacia el
    // panel sin mirarlo, el rastro sigue estando en algun lado.
    //
    // No se publica ningun evento en el bus: hoy nadie reaccionaria a el, y un
    // evento sin suscriptores es una fila mas en la cola que no hace nada. Si
    // manana se quiere avisar al area de seguridad por correo, se agrega el
    // nombre al catalogo y notifications.service se suscribe; este archivo no
    // tendria que cambiar mas que en esta linea.
    console.warn(
        `[anomalias] ${regla.severity.toUpperCase()} usuario=${userId} regla=${regla.code} ` +
        `${totalVentana} pts en ${regla.window_minutes} min (umbral ${regla.max_points})`
    );

    return rows[0];
}

/**
 * Evalua a un usuario contra todas las reglas activas.
 *
 * @param {number} userId
 * @param {object} [opciones]
 * @param {number|string} [opciones.disparadorId]  movimiento que motivo la
 *        evaluacion; es la mitad de la clave de idempotencia
 * @param {string} [opciones.hasta]  evaluar como si "ahora" fuera este
 *        instante. Lo usa el job de respaldo para reconstruir la ventana tal
 *        como estaba cuando ocurrio el movimiento, y no la de este momento.
 * @returns {Promise<object[]>} anomalias nuevas
 */
async function evaluarUsuario(userId, { disparadorId = null, hasta = null } = {}) {
    if (!userId) return [];

    const reglas = await obtenerReglas();
    const detectadas = [];

    // Las ventanas se piden una sola vez por duracion: dos reglas de 60
    // minutos comparten la misma consulta.
    const cache = new Map();

    for (const regla of reglas) {
        const clave = `${regla.window_minutes}:${hasta || 'now'}`;
        if (!cache.has(clave)) {
            cache.set(clave, await movimientosEnVentana(userId, regla.window_minutes, hasta));
        }
        const movimientos = cache.get(clave);

        const total = movimientos.reduce((a, m) => a + m.points, 0);
        if (total <= regla.max_points) continue;

        // Sin movimiento disparador explicito se usa el ultimo de la ventana:
        // asi la clave de deduplicacion es estable entre el camino en tiempo
        // real y el job de respaldo.
        const disparador = disparadorId ?? movimientos[movimientos.length - 1]?.id;
        if (!disparador) continue;

        const anomalia = await registrarAnomalia({
            userId, regla, movimientos, disparadorId: disparador
        });
        if (anomalia) detectadas.push(anomalia);
    }

    return detectadas;
}

// ---------------------------------------------------------------------
// Job periodico de respaldo (criterio tecnico 6)
// ---------------------------------------------------------------------

/**
 * Reevalua los movimientos recientes.
 *
 * Sobre "la ventana no procesada": no se guarda una marca de agua del ultimo
 * movimiento revisado. Se reevalua directamente la ventana reciente y se
 * confia en la deduplicacion.
 *
 * Es a proposito. Una marca de agua se rompe de dos formas conocidas: si el
 * job muere a mitad de camino queda adelantada sobre trabajo que no se hizo, y
 * si un movimiento se inserta con fecha anterior al ultimo procesado (un
 * reintento demorado de la cola) queda por detras de la marca y no se revisa
 * nunca. Reevaluar y deduplicar no tiene ninguno de los dos problemas: el
 * costo es una consulta mas, y a cambio ningun movimiento se pierde.
 *
 * @param {number} [minutosHaciaAtras]  por defecto, el doble de la ventana mas
 *        larga configurada: cubre de sobra el hueco entre dos ejecuciones.
 */
async function ejecutarJob(minutosHaciaAtras = null) {
    const reglas = await obtenerReglas();
    if (reglas.length === 0) return { usuarios: 0, detectadas: 0 };

    const ventanaMaxima = Math.max(...reglas.map(r => r.window_minutes));
    const lookback = minutosHaciaAtras || ventanaMaxima * 2;

    // Solo los usuarios con movimientos recientes: no tiene sentido recorrer
    // el padron entero.
    const usuarios = await gamificacion.usuariosConMovimientosRecientes(lookback);

    let detectadas = 0;
    for (const user_id of usuarios) {
        // Sin disparador explicito: evaluarUsuario toma el ultimo movimiento
        // de la ventana, que es la misma clave que habria usado el camino en
        // tiempo real.
        const nuevas = await evaluarUsuario(user_id);
        detectadas += nuevas.length;
    }

    if (detectadas > 0) {
        console.warn(`[anomalias] job de respaldo: ${detectadas} alerta(s) que el camino en tiempo real no genero`);
    }

    return { usuarios: usuarios.length, detectadas };
}

function iniciarJob() {
    if (temporizador) return;
    temporizador = setInterval(
        () => ejecutarJob().catch(e => console.error('[anomalias] job:', e.message)),
        INTERVALO_JOB_MS
    );
    // unref: un temporizador de respaldo no debe impedir que el proceso
    // termine cuando ya no queda nada mas que hacer (por ejemplo en pruebas).
    if (temporizador.unref) temporizador.unref();

    console.log(`[anomalias] job de respaldo cada ${INTERVALO_JOB_MS / 60000} min`);
}

function detenerJob() {
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
}

// ---------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------

/** Listado para el panel, con filtros y paginacion. */
async function listarAnomalias({ status = null, severity = null, userId = null,
                                 page = 1, pageSize = 25 } = {}) {
    const filtros = { status, severity, userId };
    const total = await repo.contarAnomalias(filtros);
    const rows = await conCuentas(
        await repo.paginaDeAnomalias(filtros, { limit: pageSize, offset: (page - 1) * pageSize }),
        [{ campoId: 'user_id', correo: 'email', obligatoria: true }]
    );

    return {
        paginacion: { page, page_size: pageSize, total, total_paginas: Math.max(1, Math.ceil(total / pageSize)) },
        resumen: await obtenerResumen(),
        resultados: rows
    };
}

/** Contadores para la cabecera del panel. */
async function obtenerResumen() {
    const rows = await repo.resumenPorEstadoYSeveridad();

    const resumen = { total: 0, pendientes: 0, revisadas: 0, descartadas: 0, por_severidad: {} };
    for (const r of rows) {
        resumen.total += r.total;
        if (r.status === 'pending')   resumen.pendientes += r.total;
        if (r.status === 'reviewed')  resumen.revisadas += r.total;
        if (r.status === 'dismissed') resumen.descartadas += r.total;
        resumen.por_severidad[r.severity] = (resumen.por_severidad[r.severity] || 0) + r.total;
    }
    return resumen;
}

/**
 * Detalle de una anomalia, con la linea de tiempo del usuario involucrado
 * (mockup 2).
 *
 * La linea de tiempo mezcla los movimientos de puntos con los ajustes
 * manuales que se le hicieron: si alguien acumulo 5000 puntos porque un
 * administrador se los otorgo a mano, eso tiene que verse al lado de la
 * alerta y no en otra pantalla.
 */
async function obtenerAnomalia(id) {
    const rows = await conCuentas(await repo.buscarAnomalia(id),
        [{ campoId: 'user_id', correo: 'email', rol: 'role', obligatoria: true }]);
    if (rows.length === 0) return null;

    const anomalia = rows[0];
    const afectadoId = anomalia.user_id;

    const [historial, linea, ajustes] = await Promise.all([
        repo.historialDeEstados(id),
        gamificacion.ultimosMovimientos(afectadoId, 50),
        repo.ajustesManuales(afectadoId)
    ]);

    const [historialConCorreos, ajustesConCorreos] = await Promise.all([
        conCuentas(historial.rows, [{ campoId: 'changed_by', correo: 'changed_by_email', obligatoria: true }]),
        conCuentas(ajustes.rows, [{ campoId: 'actor_id', correo: 'actor_email', obligatoria: true }])
    ]);

    return {
        ...anomalia,
        historial_estados: historialConCorreos.map(({ changed_by, ...h }) => h),
        linea_de_tiempo: linea,
        ajustes_manuales: ajustesConCorreos.map(({ actor_id, ...a }) => a)
    };
}

/**
 * Cambia el estado de una anomalia dejando traza.
 *
 * El UPDATE y el INSERT en el historial van en la misma transaccion: un
 * cambio de estado sin su registro seria exactamente el agujero que esta
 * historia viene a cerrar.
 */
async function cambiarEstado({ anomalyId, nuevoEstado, userId, nota = null }) {
    if (!ESTADOS.includes(nuevoEstado)) {
        const error = new Error(`Estado invalido: "${nuevoEstado}". Validos: ${ESTADOS.join(', ')}.`);
        error.campo = 'status';
        throw error;
    }

    return conTransaccion(async (tx) => {
        const actual = await repo.bloquearAnomalia(anomalyId, tx);
        if (!actual) return null;

        const anterior = actual.status;
        const actualizada = await repo.actualizarEstado(anomalyId, nuevoEstado, tx);
        await repo.registrarCambioDeEstado({ anomalyId, anterior, nuevoEstado, userId, nota }, tx);

        return { ...actualizada, previous_status: anterior };
    });
}

/** Conecta el servicio al bus y arranca el job de respaldo. */
function registrarHandlers() {
    // Criterio tecnico 1: se reutiliza el evento que points.service ya
    // publicaba. No hubo que tocar el modulo de puntos.
    eventBus.subscribe(EVENTOS.POINTS_ASSIGNED, ({ userId, ledgerId }) =>
        evaluarUsuario(userId, { disparadorId: ledgerId })
    );
    console.log('[anomalies.service] handlers registrados');
}

module.exports = {
    ESTADOS,
    INTERVALO_JOB_MS,
    obtenerReglas,
    movimientosEnVentana,
    evaluarUsuario,
    registrarAnomalia,
    ejecutarJob,
    iniciarJob,
    detenerJob,
    listarAnomalias,
    obtenerResumen,
    obtenerAnomalia,
    cambiarEstado,
    registrarHandlers
};
