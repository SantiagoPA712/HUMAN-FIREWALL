/**
 * Registro centralizado de logs de auditoria (data.logs).
 *
 * HU: "Yo como sistema quiero registrar en una tabla centralizada (data.logs)
 * las acciones criticas realizadas por los usuarios y por el propio sistema".
 *
 * ---------------------------------------------------------------------
 * Como llega una fila a data.logs
 * ---------------------------------------------------------------------
 *
 *   controlador --registrar()--> event_outbox --worker--> persistir() --> data.logs
 *        |                          (INSERT)                (fuera del request)
 *        +-- responde sin esperar
 *
 * Criterio tecnico 2: "registrar el log de forma asincrona (cola/job en
 * background) y si el registro falla, la operacion de negocio original no
 * debe fallar ni revertirse por esa causa".
 *
 * Por eso registrar():
 *   - usa el bus de eventos que ya existe (patron outbox), que trae gratis los
 *     5 reintentos con backoff y sobrevive a una caida del proceso;
 *   - NUNCA lanza: cualquier error se atrapa y se imprime. Los controladores
 *     lo llaman sin await, asi que tampoco suma latencia;
 *   - encola con el pool, NO con el cliente de una transaccion ajena. Si se
 *     encolara dentro de la transaccion del negocio, un INSERT fallido en el
 *     outbox abortaria esa transaccion (en PostgreSQL, un error deja la
 *     transaccion entera inutilizable) y el log terminaria revirtiendo la
 *     operacion, que es justo lo que el criterio prohibe.
 *
 *     El precio: si el proceso muere entre el COMMIT del negocio y el INSERT
 *     del outbox, ese log se pierde. Es una ventana de milisegundos, y es la
 *     unica forma de cumplir "el log no puede tumbar la operacion". Es la
 *     decision contraria a la de user.registered, donde el evento SI va en
 *     la transaccion porque ahi perderlo seria peor que no registrar.
 *
 * ---------------------------------------------------------------------
 * Lo que NO hay en este archivo
 * ---------------------------------------------------------------------
 * No hay funciones para editar ni borrar logs (criterio tecnico 4). La unica
 * escritura destructiva es aplicarRetencion(), y la base la rechaza si no
 * viene de ahi (trigger de la migracion 011).
 */

const crypto = require('crypto');
const config = require('../config/configuracion');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { escaparCSV } = require('../../../compartido/utils/csv');
const identidad = require('../infrastructure/client/identidad.cliente');
const { CLAVE_SENSIBLE, VALOR_SENSIBLE, REDACTADO, enmascarar } = require('../domain/registro');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const repo = require('../infrastructure/persistence/logs.repositorio');

// ---------------------------------------------------------------------
// Catalogos
// ---------------------------------------------------------------------

/** Tipos de accion. Son los valores de data.logs.action_type. */
const ACCIONES = {
    CREATE:            'create',
    UPDATE:            'update',
    DELETE:            'delete',
    DEACTIVATE:        'deactivate',
    ROLE_CHANGE:       'role_change',
    LOGIN_FAILED:      'login_failed',
    PASSWORD_RESET:    'password_reset',
    EXPORT:            'export',
    CONFIG_CHANGE:     'config_change',
    MANUAL_ADJUSTMENT: 'manual_adjustment',
    STATUS_CHANGE:     'status_change',
    RETENTION_PURGE:   'retention_purge',
    // HU de invitaciones (criterio tecnico 4): cada cambio de estado.
    INVITE:            'invite',
    INVITE_RESEND:     'invite_resend',
    INVITE_CANCEL:     'invite_cancel',
    INVITE_ACCEPT:     'invite_accept'
};

/** Modulos de origen. Son los valores de data.logs.module. */
const MODULOS = {
    AUTH:         'auth',
    USERS:        'users',
    GAMIFICATION: 'gamification',
    SECURITY:     'security',
    REPORTS:      'reports',
    LOGS:         'logs',
    SYSTEM:       'system'
};

const LISTA_ACCIONES = Object.values(ACCIONES);
const LISTA_MODULOS = Object.values(MODULOS);

// ---------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------

const TAMANO_PAGINA = config.tamanoDePaginaDeLogs;
const TAMANO_PAGINA_MAXIMO = 200;

// Tope de filas de una exportacion. Sin tope, un CSV sin filtros sobre un
// anio de logs se armaria entero en memoria dentro del request.
const MAXIMO_EXPORTACION = config.maximoDeFilasExportadas;

// Criterio tecnico 6: "periodo de retencion definido (ej. 12 meses)".
const RETENCION_MESES = config.mesesDeRetencion;
const INTERVALO_RETENCION_MS = config.horasEntrePurgas * 60 * 60 * 1000;

// ---------------------------------------------------------------------
// Enmascarado de datos sensibles (criterio tecnico 5)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Contexto del request
// ---------------------------------------------------------------------

/**
 * IP de origen. Express entrega "::ffff:127.0.0.1" cuando escucha en IPv6 y
 * la conexion es IPv4; se guarda la forma corta.
 */
function ipDe(req) {
    const ip = req?.ip || req?.socket?.remoteAddress || null;
    if (!ip) return null;
    return String(ip).replace(/^::ffff:/, '').slice(0, 64);
}

// ---------------------------------------------------------------------
// Escritura (lado del publicador)
// ---------------------------------------------------------------------

/**
 * Arma el payload del evento. Separado de registrar() para poder probarlo
 * sin bus.
 */
function construirPayload({
    req = null,
    accion,
    modulo,
    recurso,
    recursoId = null,
    antes = null,
    despues = null,
    userId,
    actorEmail = null,
    sistema = false,
    traceId = null
}) {
    if (!accion || !modulo || !recurso) {
        throw new Error('registrar() necesita accion, modulo y recurso.');
    }

    if (!LISTA_ACCIONES.includes(accion)) {
        console.warn(`[dataLogs] accion "${accion}" fuera del catalogo ACCIONES. Se registra igual.`);
    }

    // Si no se dice otra cosa, el actor es quien hizo el request.
    const actor = sistema ? null : (userId !== undefined ? userId : (req?.user?.id ?? null));

    return {
        logUid: crypto.randomUUID(),
        userId: actor === null || actor === undefined ? null : Number(actor),
        actorType: sistema ? 'system' : 'user',
        actorEmail: actorEmail ? String(actorEmail).slice(0, 255) : null,
        actionType: accion,
        module: modulo,
        resourceType: recurso,
        resourceId: recursoId === null || recursoId === undefined ? null : String(recursoId).slice(0, 100),
        oldValue: enmascarar(antes),
        newValue: enmascarar(despues),
        ipAddress: sistema ? null : ipDe(req),
        traceId: traceId || req?.traceId || null,
        // "Timestamp del servidor": la hora de la accion, tomada aca y no
        // cuando el worker inserte la fila.
        occurredAt: new Date().toISOString()
    };
}

/**
 * Registra una accion critica. NUNCA lanza.
 *
 * Uso desde un controlador (sin await, a proposito):
 *
 *     dataLogs.registrar({
 *         req,
 *         accion: dataLogs.ACCIONES.ROLE_CHANGE,
 *         modulo: dataLogs.MODULOS.USERS,
 *         recurso: 'user',
 *         recursoId: id,
 *         antes: { role: 'employee' },
 *         despues: { role: 'admin' }
 *     });
 *
 * @returns {Promise<string|null>} el log_uid encolado, o null si no se pudo
 *          encolar. Las pruebas lo esperan; los controladores no.
 */
async function registrar(datos) {
    try {
        const payload = construirPayload(datos);
        await eventBus.publish(EVENTOS.AUDIT_LOG_RECORDED, payload);
        return payload.logUid;
    } catch (err) {
        // Criterio tecnico 2: el log no puede tumbar la operacion. Queda
        // constancia en la salida del servidor, que es lo unico que queda
        // si ni siquiera la cola esta disponible.
        console.error(
            `[dataLogs] no se pudo encolar el log (${datos?.accion || '?'} sobre ${datos?.recurso || '?'}): ${err.message}`
        );
        return null;
    }
}

// ---------------------------------------------------------------------
// Escritura (lado del suscriptor)
// ---------------------------------------------------------------------

/**
 * Handler de audit.log_recorded: escribe la fila.
 *
 * Idempotente: el bus reintenta, y ON CONFLICT (log_uid) evita duplicar.
 *
 * Completa lo que el publicador no sabia: el correo del actor (el JWT solo
 * trae id y rol) o, en un login fallido, el id de la cuenta que se intento
 * usar a partir del correo.
 */
async function persistir(p) {
    if (!p || !p.logUid || !p.actionType || !p.module || !p.resourceType || !p.occurredAt) {
        throw new Error('Payload de audit.log_recorded incompleto.');
    }

    let userId = p.userId ?? null;
    let actorEmail = p.actorEmail ?? null;

    if (p.actorType !== 'system') {
        // Las cuentas son de identidad: se resuelven por su contrato.
        if (userId && !actorEmail) {
            actorEmail = await identidad.correoDe(userId);
        } else if (!userId && actorEmail) {
            userId = await identidad.idPorCorreo(actorEmail);
        }
    }

    await repo.insertarLog({ ...p, userId, actorEmail });
}

// ---------------------------------------------------------------------
// Lectura: filtros
// ---------------------------------------------------------------------

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Interpreta una fecha del filtro. Devuelve { tipo, valor } o null. */
function leerFecha(texto) {
    if (FECHA.test(texto)) {
        const d = new Date(`${texto}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? null : { tipo: 'fecha', valor: texto };
    }
    if (FECHA_HORA.test(texto)) {
        const d = new Date(texto);
        return Number.isNaN(d.getTime()) ? null : { tipo: 'fecha_hora', valor: d.toISOString() };
    }
    return null;
}

/**
 * Valida los filtros del query string.
 *
 * La usan el listado Y la exportacion. Criterio de aceptacion 4: "el archivo
 * exportado debe reflejar exactamente los filtros aplicados en pantalla". La
 * forma de garantizarlo es que no existan dos interpretaciones de los
 * filtros: una sola funcion, una sola consulta (construirWhere del repositorio).
 *
 * Query aceptado:
 *   from, to        YYYY-MM-DD (dia completo, inclusive) o fecha-hora ISO
 *   user_id         id numerico, o "system" para las acciones del sistema
 *   module          uno de MODULOS
 *   action_type     uno de ACCIONES
 *   resource_type   texto libre
 *   order           desc (por defecto, mas reciente primero) | asc
 *   page, page_size paginacion
 *
 * @returns {{ errores: {campo:string, detalle:string}[], filtros: object }}
 */
function validarFiltros(query = {}) {
    const errores = [];
    const filtros = {
        desde: null,
        hasta: null,
        userId: null,
        soloSistema: false,
        modulo: null,
        accion: null,
        recurso: null,
        orden: 'desc',
        page: 1,
        pageSize: TAMANO_PAGINA
    };

    const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());

    const from = texto(query.from);
    if (from) {
        const f = leerFecha(from);
        if (!f) errores.push({ campo: 'from', detalle: 'Fecha invalida. Formato: YYYY-MM-DD o fecha-hora ISO.' });
        else filtros.desde = f;
    }

    const to = texto(query.to);
    if (to) {
        const f = leerFecha(to);
        if (!f) errores.push({ campo: 'to', detalle: 'Fecha invalida. Formato: YYYY-MM-DD o fecha-hora ISO.' });
        else filtros.hasta = f;
    }

    if (filtros.desde && filtros.hasta) {
        // Comparacion por el instante de inicio de cada uno: alcanza para
        // detectar un rango al reves.
        const inicio = new Date(filtros.desde.tipo === 'fecha' ? `${filtros.desde.valor}T00:00:00Z` : filtros.desde.valor);
        const fin = new Date(filtros.hasta.tipo === 'fecha' ? `${filtros.hasta.valor}T23:59:59Z` : filtros.hasta.valor);
        if (inicio > fin) {
            errores.push({ campo: 'to', detalle: 'La fecha final es anterior a la inicial.' });
        }
    }

    const usuario = texto(query.user_id);
    if (usuario) {
        if (usuario.toLowerCase() === 'system') {
            filtros.soloSistema = true;
        } else {
            const n = Number.parseInt(usuario, 10);
            if (!Number.isInteger(n) || n <= 0 || String(n) !== usuario) {
                errores.push({ campo: 'user_id', detalle: 'Debe ser un id de usuario o "system".' });
            } else {
                filtros.userId = n;
            }
        }
    }

    const modulo = texto(query.module);
    if (modulo) {
        if (!LISTA_MODULOS.includes(modulo)) {
            errores.push({ campo: 'module', detalle: `Modulo invalido. Validos: ${LISTA_MODULOS.join(', ')}.` });
        } else {
            filtros.modulo = modulo;
        }
    }

    const accion = texto(query.action_type);
    if (accion) {
        if (!LISTA_ACCIONES.includes(accion)) {
            errores.push({ campo: 'action_type', detalle: `Tipo de accion invalido. Validos: ${LISTA_ACCIONES.join(', ')}.` });
        } else {
            filtros.accion = accion;
        }
    }

    const recurso = texto(query.resource_type);
    if (recurso) filtros.recurso = recurso.slice(0, 40);

    const orden = texto(query.order).toLowerCase();
    if (orden) {
        if (orden !== 'asc' && orden !== 'desc') {
            errores.push({ campo: 'order', detalle: 'Debe ser "desc" (mas reciente primero) o "asc".' });
        } else {
            filtros.orden = orden;
        }
    }

    const page = texto(query.page);
    if (page) {
        const n = Number.parseInt(page, 10);
        if (!Number.isInteger(n) || n < 1) errores.push({ campo: 'page', detalle: 'Debe ser un entero mayor o igual a 1.' });
        else filtros.page = n;
    }

    const pageSize = texto(query.page_size);
    if (pageSize) {
        const n = Number.parseInt(pageSize, 10);
        if (!Number.isInteger(n) || n < 1 || n > TAMANO_PAGINA_MAXIMO) {
            errores.push({ campo: 'page_size', detalle: `Debe estar entre 1 y ${TAMANO_PAGINA_MAXIMO}.` });
        } else {
            filtros.pageSize = n;
        }
    }

    return { errores, filtros };
}

// ---------------------------------------------------------------------
// Lectura: listado, detalle, opciones
// ---------------------------------------------------------------------

/**
 * Listado paginado (criterios de aceptacion 1 y 2, criterio tecnico 7).
 *
 * El listado no trae old_value/new_value: pueden ser JSON grandes y la
 * pantalla no los muestra hasta abrir el detalle.
 *
 * @param {object} filtros  la salida de validarFiltros().filtros
 */
async function listar(filtros) {
    const total = await repo.contarLogs(filtros);
    const rows = await repo.paginaDeLogs(filtros, {
        limit: filtros.pageSize,
        offset: (filtros.page - 1) * filtros.pageSize
    });

    return {
        paginacion: {
            page: filtros.page,
            page_size: filtros.pageSize,
            total,
            total_paginas: Math.max(1, Math.ceil(total / filtros.pageSize))
        },
        orden: filtros.orden,
        resultados: rows
    };
}

/** Detalle completo de un log (criterio de aceptacion 3). null si no existe. */
async function obtenerDetalle(id) {
    return repo.detalleDeLog(id);
}

/**
 * Opciones para los desplegables de filtro.
 * Los usuarios salen del propio log: solo tiene sentido filtrar por alguien
 * que tenga acciones registradas.
 */
async function opcionesDeFiltro() {
    const usuarios = await repo.usuariosConAcciones();

    usuarios.sort((a, b) => String(a.actor_email || '').localeCompare(String(b.actor_email || '')));

    return {
        modulos: LISTA_MODULOS,
        acciones: LISTA_ACCIONES,
        usuarios,
        tamano_pagina: TAMANO_PAGINA,
        tamano_pagina_maximo: TAMANO_PAGINA_MAXIMO
    };
}

// ---------------------------------------------------------------------
// Exportacion CSV (criterio de aceptacion 4)
// ---------------------------------------------------------------------

const COLUMNAS_CSV = [
    ['id', 'id'],
    ['fecha_hora_servidor', 'occurred_at'],
    ['usuario', 'usuario'],
    ['user_id', 'user_id'],
    ['tipo_accion', 'action_type'],
    ['modulo', 'module'],
    ['tipo_recurso', 'resource_type'],
    ['recurso_id', 'resource_id'],
    ['valor_anterior', 'old_value'],
    ['valor_nuevo', 'new_value'],
    ['ip_origen', 'ip_address'],
    ['trace_id', 'trace_id']
];

/**
 * Genera el CSV con los MISMOS filtros y el MISMO orden del listado, sin
 * paginar: el archivo es lo que se ve en pantalla, todas las paginas.
 *
 * @returns {Promise<{buffer: Buffer, filas: number, fileName: string}>}
 * @throws  error con .campo = 'filtros' si el resultado supera el tope
 */
async function exportarCSV(filtros) {
    // Se pide una fila de mas para saber si se paso del tope sin contar aparte.
    const rows = await repo.logsParaExportar(filtros, MAXIMO_EXPORTACION + 1);

    if (rows.length > MAXIMO_EXPORTACION) {
        const error = new Error(
            `La exportacion supera el maximo de ${MAXIMO_EXPORTACION} registros. Acota los filtros (por ejemplo, el rango de fechas).`
        );
        error.campo = 'filtros';
        throw error;
    }

    const lineas = [COLUMNAS_CSV.map(([titulo]) => escaparCSV(titulo)).join(',')];

    for (const fila of rows) {
        const plana = {
            ...fila,
            occurred_at: new Date(fila.occurred_at).toISOString(),
            usuario: fila.actor_type === 'system' ? 'system' : (fila.actor_email || ''),
            old_value: fila.old_value === null ? '' : JSON.stringify(fila.old_value),
            new_value: fila.new_value === null ? '' : JSON.stringify(fila.new_value)
        };
        lineas.push(COLUMNAS_CSV.map(([, clave]) => escaparCSV(plana[clave])).join(','));
    }

    const sello = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);   // 20260922T1530

    return {
        // BOM UTF-8 para que Excel no rompa las tildes (mismo criterio que
        // los reportes de RH).
        buffer: Buffer.from('\uFEFF' + lineas.join('\r\n'), 'utf8'),
        filas: rows.length,
        fileName: `logs_auditoria_${sello}.csv`
    };
}

/** Filtros en forma legible para dejarlos en el log de la exportacion. */
function filtrosComoTexto(filtros) {
    const salida = {};
    if (filtros.desde) salida.from = filtros.desde.valor;
    if (filtros.hasta) salida.to = filtros.hasta.valor;
    if (filtros.soloSistema) salida.user_id = 'system';
    if (filtros.userId) salida.user_id = filtros.userId;
    if (filtros.modulo) salida.module = filtros.modulo;
    if (filtros.accion) salida.action_type = filtros.accion;
    if (filtros.recurso) salida.resource_type = filtros.recurso;
    salida.order = filtros.orden;
    return salida;
}

// ---------------------------------------------------------------------
// Retencion (criterio tecnico 6)
// ---------------------------------------------------------------------

/**
 * Elimina los logs mas viejos que el periodo de retencion y deja la
 * evidencia en data.logs_purges.
 *
 * Todo en una transaccion: si no se puede escribir la evidencia, tampoco se
 * borra nada. Una purga sin evidencia es exactamente lo que el criterio
 * quiere impedir.
 *
 * Si no habia nada que purgar no se escribe evidencia: el job corre una vez
 * al dia y llenaria la tabla de filas en cero.
 *
 * @returns {Promise<{eliminados:number, desde:?Date, hasta:?Date, corte:Date, meses:number}>}
 */
async function aplicarRetencion({ meses = RETENCION_MESES, ahora = new Date() } = {}) {
    if (!Number.isInteger(meses) || meses <= 0) {
        throw new Error(`Periodo de retencion invalido: ${meses}. Debe ser un entero positivo de meses.`);
    }

    const resultado = await conTransaccion(async (tx) => {
        const purga = await repo.purgarAnterioresA({ ahora, meses }, tx);
        if (purga.eliminados > 0) {
            await repo.registrarPurga({ ...purga, meses, traceId: crypto.randomUUID() }, tx);
        }
        return purga;
    });

    if (resultado.eliminados > 0) {
        console.log(
            `[dataLogs] retencion: ${resultado.eliminados} logs anteriores a ` +
            `${new Date(resultado.corte).toISOString()} eliminados (politica de ${meses} meses)`
        );
    }

    return {
        eliminados: resultado.eliminados,
        desde: resultado.desde,
        hasta: resultado.hasta,
        corte: resultado.corte,
        meses
    };
}

/** Historial de purgas, lo mas reciente primero. */
async function listarPurgas(limite = 50) {
    return repo.purgas(limite);
}

let temporizadorRetencion = null;

/**
 * Job periodico de retencion. Se llama una vez, desde conectarTodo().
 * No usa el bus: no es una reaccion a un hecho sino un reloj, igual que el
 * job de respaldo de anomalias.
 */
function iniciarJobRetencion(intervaloMs = INTERVALO_RETENCION_MS) {
    if (temporizadorRetencion) return;

    const correr = () => aplicarRetencion().catch(err =>
        console.error('[dataLogs] fallo la purga por retencion:', err.message)
    );

    temporizadorRetencion = setInterval(correr, intervaloMs);
    if (temporizadorRetencion.unref) temporizadorRetencion.unref();

    // Una corrida al arrancar, sin esperar el primer intervalo (24 h por
    // defecto): un servidor que se reinicia a diario nunca purgaria.
    const primera = setTimeout(correr, 30 * 1000);
    if (primera.unref) primera.unref();

    console.log(`[dataLogs] job de retencion iniciado (${RETENCION_MESES} meses, cada ${Math.round(intervaloMs / 3600000)} h)`);
}

function detenerJobRetencion() {
    if (temporizadorRetencion) { clearInterval(temporizadorRetencion); temporizadorRetencion = null; }
}

// ---------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------

function registrarHandlers() {
    eventBus.subscribe(EVENTOS.AUDIT_LOG_RECORDED, persistir);
    console.log('[dataLogs.service] handlers registrados');
}

module.exports = {
    ACCIONES,
    MODULOS,
    REDACTADO,
    TAMANO_PAGINA,
    TAMANO_PAGINA_MAXIMO,
    MAXIMO_EXPORTACION,
    RETENCION_MESES,
    enmascarar,
    construirPayload,
    registrar,
    persistir,
    validarFiltros,
    listar,
    obtenerDetalle,
    opcionesDeFiltro,
    exportarCSV,
    filtrosComoTexto,
    aplicarRetencion,
    listarPurgas,
    iniciarJobRetencion,
    detenerJobRetencion,
    registrarHandlers
};
