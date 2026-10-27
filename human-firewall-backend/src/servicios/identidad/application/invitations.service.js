/**
 * Invitaciones de usuarios.
 *
 * HU: "Yo como sistema quiero enviar invitaciones por correo a nuevos
 * usuarios (empleados, instructores, RH) con un enlace seguro para completar
 * su registro, para facilitar el proceso de onboarding sin que el
 * administrador deba compartir credenciales manualmente."
 *
 * ---------------------------------------------------------------------
 * El ciclo de una invitacion
 * ---------------------------------------------------------------------
 *
 *   admin invita --> pending --(invitado acepta)--> accepted  (se crea la cuenta)
 *                      |  ^
 *                      |  +--(admin reenvia: token nuevo)--+
 *                      |                                   |
 *                      +--(pasa expires_at)--> expired ----+--(admin cancela)--> cancelled
 *                      +--(admin cancela)------------------------------------> cancelled
 *
 * ---------------------------------------------------------------------
 * El token (criterios tecnicos 1 y 2)
 * ---------------------------------------------------------------------
 * 32 bytes de crypto.randomBytes en base64url. En la base se guarda SOLO su
 * SHA-256: con la tabla en la mano no se puede armar un enlace. El token en
 * claro existe en el correo y en el evento que lo encola (ver catalogo).
 *
 * Un solo uso: aceptar es un UPDATE ... WHERE status = 'pending' AND
 * expires_at > now(). Dos pestanas que envian el formulario a la vez compiten
 * por la misma fila y solo una la actualiza; la otra recibe "ya usada".
 *
 * Reenviar genera un token NUEVO y pisa el hash: el enlace anterior deja de
 * servir en el mismo instante en que existe el nuevo.
 */

const crypto = require('crypto');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const { esCorreoValido } = require('../../../compartido/utils/correo');
const { hashPassword } = require('../../../compartido/utils/hash');
const { generateToken } = require('../../../compartido/utils/token');
const config = require('../config/configuracion');
const dominio = require('../domain/invitacion');
const invitaciones = require('../infrastructure/persistence/invitaciones.repositorio');
const usuarios = require('../infrastructure/persistence/usuarios.repositorio');
// data.logs es de seguridad y la bandeja de avisos de notificaciones: se
// llega a los dos por su contrato, no importando sus archivos internos.
const dataLogs = require('../infrastructure/client/seguridad.cliente');
const notificaciones = require('../infrastructure/client/notificaciones.cliente');

const { ROLES_INVITABLES, ESTADOS, RECHAZOS } = dominio;

/** Criterio tecnico 1: "expiracion configurable (ej. 72 horas)". */
const horasDeVigencia = () => config.horasDeVigenciaInvitacion;

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

/** Error con codigo HTTP y cuerpo, para que el controlador responda tal cual. */
function errorHttp(codigo, cuerpo) {
    const error = new Error(cuerpo.msg);
    error.codigo = codigo;
    error.cuerpo = cuerpo;
    return error;
}

function generarToken() {
    const token = crypto.randomBytes(32).toString('base64url');
    return { token, hash: hashToken(token) };
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Lo que sale por la API de una invitacion. Nunca el hash del token. */
function publica(fila) {
    return {
        id: Number(fila.id),
        email: fila.email,
        role: fila.role,
        language: fila.language,
        estado: ESTADOS[fila.status],
        expires_at: fila.expires_at,
        invited_by: fila.invited_by,
        invited_by_email: fila.invited_by_email ?? undefined,
        send_count: fila.send_count,
        resend_requested_at: fila.resend_requested_at,
        accepted_user_id: fila.accepted_user_id,
        created_at: fila.created_at,
        accepted_at: fila.accepted_at,
        cancelled_at: fila.cancelled_at,
        expired_at: fila.expired_at
    };
}

/**
 * Log central de auditoria (data.logs). Nunca lanza.
 *
 * @param {number} [actorId]  quien hizo el cambio si no es el usuario del
 *                            request (al aceptar, la cuenta recien creada)
 */
function auditar(req, accion, inv, extra = {}, actorId = undefined) {
    dataLogs.registrarAccion({
        req,
        accion,
        modulo: dataLogs.MODULOS.USERS,
        recurso: 'user_invitation',
        recursoId: inv.id,
        despues: {
            email: inv.email,
            role: inv.role,
            invited_by: inv.invited_by,
            estado: ESTADOS[inv.status],
            ...extra
        },
        ...(actorId !== undefined ? { userId: actorId } : {})
    });
}

/** Senal interna: el UPDATE de aceptar no encontro la invitacion vigente. */
const YA_NO_VIGENTE = new Error('la invitacion dejo de estar vigente');

/**
 * Pasa a 'expired' las pendientes cuyo plazo ya paso, y deja constancia con la
 * hora en que vencieron (no la hora en que alguien lo noto).
 *
 * No hay un reloj que lo haga: se materializa cada vez que alguien mira
 * (listar, validar, invitar, reenviar). Entre medio la invitacion ya no sirve
 * igual, porque aceptar exige expires_at > now().
 */
async function marcarVencidas() {
    return conTransaccion(async (tx) => {
        const vencidas = await invitaciones.marcarVencidas(tx);
        for (const inv of vencidas) {
            await invitaciones.registrarEvento(inv, 'expired', null, inv.expires_at, tx);
        }
        return vencidas.length;
    });
}

/** Encola el correo de invitacion, dentro de la transaccion que la crea o reenvia. */
async function publicarInvitacion(tx, inv, token) {
    await eventBus.publish(EVENTOS.USER_INVITED, {
        invitationId: Number(inv.id),
        email: inv.email,
        role: inv.role,
        language: inv.language,
        token,
        expiresAt: new Date(inv.expires_at).toISOString(),
        invitedBy: inv.invited_by,
        invitedByEmail: await usuarios.correoDe(inv.invited_by),
        sendNo: inv.send_count
    }, tx);
}

/**
 * Criterio tecnico 3: el correo no puede tener una cuenta ni una invitacion
 * pendiente. Devuelve el conflicto, o null si se puede invitar.
 */
async function conflictoPara(email, { excepto = null } = {}) {
    const cuenta = await usuarios.cuentaPorCorreo(email);
    if (cuenta) {
        return cuenta.is_active === false
            ? {
                msg: 'Ya existe una cuenta desactivada con ese correo. Reactivala desde la gestion de usuarios en lugar de invitar.',
                estado_actual: 'cuenta_inactiva'
            }
            : { msg: 'Ya existe una cuenta activa con ese correo.', estado_actual: 'cuenta_activa' };
    }

    const pendiente = await invitaciones.pendientePorCorreo(email, excepto);
    if (pendiente) {
        return {
            msg: 'Ese correo ya tiene una invitacion pendiente. Podes reenviarla o cancelarla.',
            estado_actual: 'invitacion_pendiente',
            invitacion_id: Number(pendiente.id),
            expires_at: pendiente.expires_at
        };
    }

    return null;
}

/** 23505 = unique_violation. La carrera entre dos invitaciones simultaneas. */
function esDuplicado(err) {
    return err && err.code === '23505';
}

// ---------------------------------------------------------------------
// Administrador (criterios de aceptacion 1 y 4)
// ---------------------------------------------------------------------

/**
 * Crea una invitacion y encola su correo.
 *
 * @returns {Promise<object>} la invitacion (sin token)
 * @throws  400 datos invalidos, 409 correo con cuenta o invitacion pendiente
 */
async function invitar({ email, role, language = null }, { adminId, req = null } = {}) {
    const correo = dominio.normalizarEmail(email);
    const errores = dominio.validarInvitacion({ correo, role, language }, esCorreoValido);
    if (errores.length > 0) throw errorHttp(400, { msg: 'Parametros invalidos', errores });

    // Una invitacion vencida no bloquea una nueva: primero se cierra.
    await marcarVencidas();

    const conflicto = await conflictoPara(correo);
    if (conflicto) throw errorHttp(409, conflicto);

    const { token, hash } = generarToken();

    let inv;
    try {
        inv = await conTransaccion(async (tx) => {
            const creada = await invitaciones.insertar({
                email: correo, role, language: language || null,
                tokenHash: hash, horasDeVigencia: horasDeVigencia(), invitedBy: adminId
            }, tx);
            await invitaciones.registrarEvento(creada, 'created', adminId, null, tx);
            await publicarInvitacion(tx, creada, token);
            return creada;
        });
    } catch (err) {
        if (esDuplicado(err)) {
            throw errorHttp(409, (await conflictoPara(correo)) ||
                { msg: 'Ese correo ya tiene una invitacion pendiente.', estado_actual: 'invitacion_pendiente' });
        }
        throw err;
    }

    auditar(req, dataLogs.ACCIONES.INVITE, inv);
    return publica(inv);
}

/**
 * Listado para el panel, con el historial de cada invitacion.
 *
 * @param {object} filtros  { estado?: 'pendiente'|'aceptada'|'expirada'|'cancelada' }
 */
async function listar({ estado = null } = {}) {
    await marcarVencidas();

    const status = estado ? dominio.estadoDesdeNombre(estado) : null;
    if (estado && !status) {
        throw errorHttp(400, {
            msg: 'Parametros invalidos',
            errores: [{ campo: 'estado', detalle: `Validos: ${Object.values(ESTADOS).join(', ')}.` }]
        });
    }

    const filas = await invitaciones.listar(status);

    const resumen = { pendiente: 0, aceptada: 0, expirada: 0, cancelada: 0 };
    for (const c of await invitaciones.contarPorEstado()) resumen[ESTADOS[c.status]] = c.total;

    return {
        resumen,
        invitaciones: filas.map(r => ({ ...publica(r), historial: r.historial }))
    };
}

/** La invitacion bloqueada para cambiarla, o el error que corresponde. */
async function bloquearModificable(id, accion, tx) {
    const actual = await invitaciones.bloquear(id, tx);
    if (!actual) throw errorHttp(404, { msg: 'Invitacion no encontrada' });

    if (!dominio.sePuedeReenviarOCancelar(actual.status)) {
        throw errorHttp(409, {
            msg: `La invitacion esta ${ESTADOS[actual.status]} y no se puede ${accion}.`,
            estado_actual: ESTADOS[actual.status]
        });
    }
    return actual;
}

/**
 * Reenvia una invitacion pendiente o vencida con un enlace NUEVO. El anterior
 * deja de servir: su hash ya no esta en la tabla.
 *
 * @throws 404 si no existe, 409 si ya fue aceptada o cancelada, o si el correo
 *         ya tiene cuenta u otra invitacion pendiente
 */
async function reenviar(id, { adminId, req = null } = {}) {
    await marcarVencidas();

    const { token, hash } = generarToken();

    let inv;
    try {
        inv = await conTransaccion(async (tx) => {
            const actual = await bloquearModificable(id, 'reenviar', tx);

            const conflicto = await conflictoPara(actual.email, { excepto: actual.id });
            if (conflicto) throw errorHttp(409, conflicto);

            const nueva = await invitaciones.renovar(id, { tokenHash: hash, horasDeVigencia: horasDeVigencia() }, tx);
            await invitaciones.registrarEvento(nueva, 'resent', adminId, null, tx);
            await publicarInvitacion(tx, nueva, token);
            return nueva;
        });
    } catch (err) {
        if (esDuplicado(err)) {
            throw errorHttp(409, { msg: 'Ese correo ya tiene otra invitacion pendiente.', estado_actual: 'invitacion_pendiente' });
        }
        throw err;
    }

    auditar(req, dataLogs.ACCIONES.INVITE_RESEND, inv, { envio: inv.send_count, reenviado_por: adminId });
    return publica(inv);
}

/**
 * Cancela una invitacion que no fue aceptada. El enlace deja de servir y el
 * invitado ve "cancelada" si lo abre.
 */
async function cancelar(id, { adminId, req = null } = {}) {
    await marcarVencidas();

    const inv = await conTransaccion(async (tx) => {
        await bloquearModificable(id, 'cancelar', tx);
        const cancelada = await invitaciones.cancelar(id, tx);
        await invitaciones.registrarEvento(cancelada, 'cancelled', adminId, null, tx);
        return cancelada;
    });

    auditar(req, dataLogs.ACCIONES.INVITE_CANCEL, inv, { cancelado_por: adminId });
    return publica(inv);
}

// ---------------------------------------------------------------------
// Invitado (criterios de aceptacion 2 y 3, tecnico 2)
// ---------------------------------------------------------------------

/**
 * Criterio tecnico 2: el token existe, no vencio y no se uso.
 *
 * @returns {Promise<{valida: true, invitacion: object} | {valida: false, motivo: string, invitacion?: object}>}
 */
async function evaluarToken(token) {
    if (!dominio.tokenConFormaValida(token)) return { valida: false, motivo: 'invalida' };

    const inv = await invitaciones.buscarPorHash(hashToken(token));
    const estado = dominio.evaluar(inv);

    if (!estado.valida && estado.motivo === 'expirada' && inv.status === 'pending') {
        await marcarVencidas();
    }
    return { ...estado, ...(inv ? { invitacion: inv } : {}) };
}

function rechazo(motivo, inv = null) {
    const r = RECHAZOS[motivo];
    return errorHttp(r.codigo, {
        msg: r.msg,
        motivo,
        ...(motivo === 'expirada'
            ? { puede_solicitar_reenvio: true, reenvio_solicitado: !!inv?.resend_requested_at }
            : {})
    });
}

/**
 * Lo que necesita el formulario de registro: a que correo y con que rol.
 * Solo si el token es valido; si no, el formulario no se muestra.
 */
async function validar(token) {
    const r = await evaluarToken(token);
    if (!r.valida) throw rechazo(r.motivo, r.invitacion);

    return {
        valida: true,
        email: r.invitacion.email,
        role: r.invitacion.role,
        language: r.invitacion.language,
        expires_at: r.invitacion.expires_at
    };
}

/**
 * Completa el registro: crea la cuenta con el rol de la invitacion y quema el
 * token, todo en una transaccion.
 *
 * @param {string} token
 * @param {object} datos  { password, full_name, language? }
 * @returns {Promise<{token: string, user: object}>} JWT para entrar directo
 */
async function aceptar(token, { password, full_name, language } = {}, { req = null } = {}) {
    const nombre = typeof full_name === 'string' ? full_name.trim() : '';
    const errores = dominio.validarAceptacion({ nombre, password, language });

    // El token se evalua ANTES que los datos del formulario: con un enlace
    // vencido no importa que la contrasena este bien, y el invitado tiene que
    // enterarse de lo primero.
    const previa = await evaluarToken(token);
    if (!previa.valida) throw rechazo(previa.motivo, previa.invitacion);
    if (errores.length > 0) throw errorHttp(400, { msg: 'Parametros invalidos', errores });

    const hash = await hashPassword(password);

    const resultado = await conTransaccion(async (tx) => {
        // Un solo uso (criterio tecnico 1): si otro request la acepto un
        // instante antes, aca no vuelve ninguna fila.
        const inv = await invitaciones.aceptarPorHash(hashToken(token), tx);
        if (!inv) throw YA_NO_VIGENTE;   // se resuelve afuera, con el motivo real

        if (await usuarios.cuentaPorCorreo(inv.email, tx)) {
            throw errorHttp(409, { msg: 'Ya existe una cuenta con ese correo.', estado_actual: 'cuenta_activa' });
        }

        const usuario = await usuarios.insertar({
            email: inv.email,
            passwordHash: hash,
            role: inv.role,
            fullName: nombre,
            language: language || inv.language || null
        }, tx);

        await invitaciones.asignarCuenta(inv.id, usuario.id, tx);
        await invitaciones.registrarEvento(inv, 'accepted', usuario.id, null, tx);

        // Mismo evento que el registro publico y el de Google: el correo de
        // bienvenida, y lo que venga despues, no necesita saber como entro.
        await eventBus.publish(EVENTOS.USER_REGISTERED, {
            userId: usuario.id,
            email: usuario.email,
            role: usuario.role,
            provider: 'invitation'
        }, tx);

        return { inv, usuario };
    }).catch(async (err) => {
        if (err !== YA_NO_VIGENTE) throw err;
        const ahora = await evaluarToken(token);
        throw rechazo(ahora.valida ? 'usada' : ahora.motivo, ahora.invitacion);
    });

    auditar(req, dataLogs.ACCIONES.INVITE_ACCEPT, resultado.inv,
        { cuenta_creada: resultado.usuario.id }, resultado.usuario.id);

    return {
        token: generateToken({ id: resultado.usuario.id, role: resultado.usuario.role }),
        user: resultado.usuario
    };
}

/**
 * Criterio de aceptacion 3: el invitado con un enlace vencido pide uno nuevo.
 *
 * No se genera el enlace aca: se registra el pedido y se le avisa a quien lo
 * invito, que decide si reenviar. Si un enlace vencido bastara para emitir
 * otro, cualquiera que encontrara un correo viejo podria reactivar una
 * invitacion que el admin dejo vencer a proposito.
 *
 * Idempotente: pedirlo dos veces no genera dos avisos.
 */
async function solicitarReenvio(token) {
    const r = await evaluarToken(token);

    if (r.valida) {
        throw errorHttp(409, { msg: 'Tu invitacion sigue vigente: podes completar el registro ahora.', motivo: 'vigente' });
    }
    if (r.motivo !== 'expirada') throw rechazo(r.motivo, r.invitacion);

    const inv = r.invitacion;
    if (inv.resend_requested_at) {
        return { msg: 'Ya pediste una nueva invitacion. El administrador la va a reenviar.', ya_solicitado: true };
    }

    await conTransaccion(async (tx) => {
        const marcada = await invitaciones.marcarReenvioSolicitado(inv.id, tx);
        if (marcada) await invitaciones.registrarEvento(marcada, 'resend_requested', null, null, tx);
    });

    // Aviso en la bandeja de quien la genero; si esa cuenta ya no esta
    // activa, a todos los admins activos, para que el pedido no se pierda.
    const destinatarios = await usuarios.estaActivo(inv.invited_by)
        ? [inv.invited_by]
        : await usuarios.activosConRol('admin');

    for (const id of destinatarios) {
        await notificaciones.avisarEnBandeja('user.invitation_resend_requested', {
            title: `Pedido de reenvio de invitacion: ${inv.email}`,
            body: `La invitacion de ${inv.email} (${inv.role}) vencio y la persona pidio una nueva.\n` +
                  `Podes reenviarla desde el panel de administracion: /admin`,
            payload: { invitationId: Number(inv.id), email: inv.email, ruta: '/admin' },
            dedupeKey: `invitation-resend:${inv.id}:${inv.send_count}:${id}`
        }, id);
    }

    return { msg: 'Listo: le avisamos al administrador para que te envie una nueva invitacion.', ya_solicitado: false };
}

module.exports = {
    ROLES_INVITABLES,
    ESTADOS,
    horasDeVigencia,
    hashToken,
    marcarVencidas,
    invitar,
    listar,
    reenviar,
    cancelar,
    validar,
    aceptar,
    solicitarReenvio
};
