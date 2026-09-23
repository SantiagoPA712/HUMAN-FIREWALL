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
const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
const dataLogs = require('./dataLogs.service');
const notificationsService = require('./notifications.service');
const { esCorreoValido } = require('./emailNotifications.service');
const { hashPassword } = require('../utils/hash');
const { generateToken } = require('../utils/token');

/** Roles que se pueden invitar. Mismos valores que el CHECK de la migracion 035. */
const ROLES_INVITABLES = ['employee', 'instructor', 'rh'];

const IDIOMAS = ['es', 'en'];

/** Criterio tecnico 1: "expiracion configurable (ej. 72 horas)". */
function horasDeVigencia() {
    const valor = Number(process.env.INVITATION_EXPIRY_HOURS);
    return Number.isFinite(valor) && valor > 0 ? valor : 72;
}

/** Misma regla que el registro publico (auth.controller). */
const REGLA_CONTRASENA = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

/** Estados de la base -> lo que ve el panel (criterio de aceptacion 1). */
const ESTADOS = {
    pending:   'pendiente',
    accepted:  'aceptada',
    expired:   'expirada',
    cancelled: 'cancelada'
};

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

function normalizarEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
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
 * Agrega una fila al historial (criterio tecnico 4). Copia correo, rol y admin
 * que la genero: el historial se tiene que poder leer solo.
 */
async function registrarEvento(cliente, inv, accion, actorId = null, ocurrio = null) {
    await cliente.query(
        `INSERT INTO user_invitation_events
             (invitation_id, action, actor_user_id, invited_by, email, role, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [inv.id, accion, actorId, inv.invited_by, inv.email, inv.role, ocurrio]
    );
}

/**
 * Log central de auditoria (data.logs). Nunca lanza.
 *
 * @param {number} [actorId]  quien hizo el cambio si no es el usuario del
 *                            request (al aceptar, la cuenta recien creada)
 */
function auditar(req, accion, inv, extra = {}, actorId = undefined) {
    dataLogs.registrar({
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

async function enTransaccion(fn) {
    const cliente = await db.connect();
    try {
        await cliente.query('BEGIN');
        const resultado = await fn(cliente);
        await cliente.query('COMMIT');
        return resultado;
    } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        cliente.release();
    }
}

/**
 * Pasa a 'expired' las pendientes cuyo plazo ya paso, y deja constancia con la
 * hora en que vencieron (no la hora en que alguien lo noto).
 *
 * No hay un reloj que lo haga: se materializa cada vez que alguien mira
 * (listar, validar, invitar, reenviar). Entre medio la invitacion ya no sirve
 * igual, porque aceptar exige expires_at > now().
 */
async function marcarVencidas() {
    return enTransaccion(async (cliente) => {
        const { rows } = await cliente.query(
            `UPDATE user_invitations
                SET status = 'expired', expired_at = expires_at, updated_at = now()
              WHERE status = 'pending' AND expires_at <= now()
              RETURNING *`
        );
        for (const inv of rows) {
            await registrarEvento(cliente, inv, 'expired', null, inv.expires_at);
        }
        return rows.length;
    });
}

async function correoDeUsuario(userId) {
    if (!userId) return null;
    const { rows } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    return rows[0]?.email || null;
}

/** Encola el correo de invitacion, dentro de la transaccion que la crea o reenvia. */
async function publicarInvitacion(cliente, inv, token) {
    await eventBus.publish(EVENTOS.USER_INVITED, {
        invitationId: Number(inv.id),
        email: inv.email,
        role: inv.role,
        language: inv.language,
        token,
        expiresAt: new Date(inv.expires_at).toISOString(),
        invitedBy: inv.invited_by,
        invitedByEmail: await correoDeUsuario(inv.invited_by),
        sendNo: inv.send_count
    }, cliente);
}

/**
 * Criterio tecnico 3: el correo no puede tener una cuenta ni una invitacion
 * pendiente. Devuelve el conflicto, o null si se puede invitar.
 */
async function conflictoPara(email, { excepto = null } = {}) {
    const { rows: cuentas } = await db.query(
        'SELECT id, is_active FROM users WHERE lower(email) = $1',
        [email]
    );
    if (cuentas[0]) {
        return cuentas[0].is_active === false
            ? {
                msg: 'Ya existe una cuenta desactivada con ese correo. Reactivala desde la gestion de usuarios en lugar de invitar.',
                estado_actual: 'cuenta_inactiva'
            }
            : { msg: 'Ya existe una cuenta activa con ese correo.', estado_actual: 'cuenta_activa' };
    }

    const { rows: pendientes } = await db.query(
        `SELECT id, expires_at FROM user_invitations
          WHERE email = $1 AND status = 'pending' AND ($2::bigint IS NULL OR id <> $2)`,
        [email, excepto]
    );
    if (pendientes[0]) {
        return {
            msg: 'Ese correo ya tiene una invitacion pendiente. Podes reenviarla o cancelarla.',
            estado_actual: 'invitacion_pendiente',
            invitacion_id: Number(pendientes[0].id),
            expires_at: pendientes[0].expires_at
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
    const correo = normalizarEmail(email);
    const errores = [];

    if (!esCorreoValido(correo)) errores.push({ campo: 'email', detalle: 'Correo invalido.' });
    if (!ROLES_INVITABLES.includes(role)) {
        errores.push({ campo: 'role', detalle: `Rol invalido. Se puede invitar a: ${ROLES_INVITABLES.join(', ')}.` });
    }
    if (language !== null && language !== undefined && language !== '' && !IDIOMAS.includes(language)) {
        errores.push({ campo: 'language', detalle: `Idioma invalido. Validos: ${IDIOMAS.join(', ')}.` });
    }
    if (errores.length > 0) throw errorHttp(400, { msg: 'Parametros invalidos', errores });

    // Una invitacion vencida no bloquea una nueva: primero se cierra.
    await marcarVencidas();

    const conflicto = await conflictoPara(correo);
    if (conflicto) throw errorHttp(409, conflicto);

    const { token, hash } = generarToken();

    let inv;
    try {
        inv = await enTransaccion(async (cliente) => {
            const { rows: [creada] } = await cliente.query(
                `INSERT INTO user_invitations (email, role, language, token_hash, expires_at, invited_by)
                 VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6)
                 RETURNING *`,
                [correo, role, language || null, hash, String(horasDeVigencia()), adminId]
            );
            await registrarEvento(cliente, creada, 'created', adminId);
            await publicarInvitacion(cliente, creada, token);
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

    const status = estado
        ? Object.entries(ESTADOS).find(([, es]) => es === estado)?.[0]
        : null;
    if (estado && !status) {
        throw errorHttp(400, {
            msg: 'Parametros invalidos',
            errores: [{ campo: 'estado', detalle: `Validos: ${Object.values(ESTADOS).join(', ')}.` }]
        });
    }

    const { rows } = await db.query(
        `SELECT i.*, u.email AS invited_by_email,
                COALESCE(
                    json_agg(json_build_object(
                        'accion', e.action, 'actor_id', e.actor_user_id, 'en', e.occurred_at
                    ) ORDER BY e.occurred_at, e.id) FILTER (WHERE e.id IS NOT NULL),
                    '[]'
                ) AS historial
           FROM user_invitations i
           LEFT JOIN users u ON u.id = i.invited_by
           LEFT JOIN user_invitation_events e ON e.invitation_id = i.id
          WHERE ($1::text IS NULL OR i.status = $1)
          GROUP BY i.id, u.email
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 200`,
        [status]
    );

    const { rows: conteo } = await db.query(
        'SELECT status, COUNT(*)::int AS total FROM user_invitations GROUP BY status'
    );
    const resumen = { pendiente: 0, aceptada: 0, expirada: 0, cancelada: 0 };
    for (const c of conteo) resumen[ESTADOS[c.status]] = c.total;

    return {
        resumen,
        invitaciones: rows.map(r => ({ ...publica(r), historial: r.historial }))
    };
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
        inv = await enTransaccion(async (cliente) => {
            const { rows: [actual] } = await cliente.query(
                'SELECT * FROM user_invitations WHERE id = $1 FOR UPDATE', [id]
            );
            if (!actual) throw errorHttp(404, { msg: 'Invitacion no encontrada' });

            if (!['pending', 'expired'].includes(actual.status)) {
                throw errorHttp(409, {
                    msg: `La invitacion esta ${ESTADOS[actual.status]} y no se puede reenviar.`,
                    estado_actual: ESTADOS[actual.status]
                });
            }

            const conflicto = await conflictoPara(actual.email, { excepto: actual.id });
            if (conflicto) throw errorHttp(409, conflicto);

            const { rows: [nueva] } = await cliente.query(
                `UPDATE user_invitations
                    SET token_hash = $2,
                        expires_at = now() + ($3 || ' hours')::interval,
                        status = 'pending',
                        send_count = send_count + 1,
                        resend_requested_at = NULL,
                        expired_at = NULL,
                        updated_at = now()
                  WHERE id = $1
                  RETURNING *`,
                [id, hash, String(horasDeVigencia())]
            );
            await registrarEvento(cliente, nueva, 'resent', adminId);
            await publicarInvitacion(cliente, nueva, token);
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

    const inv = await enTransaccion(async (cliente) => {
        const { rows: [actual] } = await cliente.query(
            'SELECT * FROM user_invitations WHERE id = $1 FOR UPDATE', [id]
        );
        if (!actual) throw errorHttp(404, { msg: 'Invitacion no encontrada' });

        if (!['pending', 'expired'].includes(actual.status)) {
            throw errorHttp(409, {
                msg: `La invitacion esta ${ESTADOS[actual.status]} y no se puede cancelar.`,
                estado_actual: ESTADOS[actual.status]
            });
        }

        const { rows: [cancelada] } = await cliente.query(
            `UPDATE user_invitations
                SET status = 'cancelled', cancelled_at = now(), updated_at = now()
              WHERE id = $1
              RETURNING *`,
            [id]
        );
        await registrarEvento(cliente, cancelada, 'cancelled', adminId);
        return cancelada;
    });

    auditar(req, dataLogs.ACCIONES.INVITE_CANCEL, inv, { cancelado_por: adminId });
    return publica(inv);
}

// ---------------------------------------------------------------------
// Invitado (criterios de aceptacion 2 y 3, tecnico 2)
// ---------------------------------------------------------------------

/**
 * Motivos por los que un enlace no sirve. El cuerpo NO repite el correo ni el
 * rol: con un token adivinado o robado no se aprende nada de la invitacion.
 */
const RECHAZOS = {
    invalida:  { codigo: 404, msg: 'El enlace de invitacion no es valido.' },
    usada:     { codigo: 410, msg: 'Esta invitacion ya fue utilizada. Si ya tenes cuenta, inicia sesion.' },
    cancelada: { codigo: 410, msg: 'Esta invitacion fue cancelada por un administrador.' },
    expirada:  { codigo: 410, msg: 'Esta invitacion vencio. Podes pedir que te envien una nueva.' }
};

/**
 * Criterio tecnico 2: el token existe, no vencio y no se uso.
 *
 * @returns {Promise<{valida: true, invitacion: object} | {valida: false, motivo: string, invitacion?: object}>}
 */
async function evaluarToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
        return { valida: false, motivo: 'invalida' };
    }

    const { rows: [inv] } = await db.query(
        'SELECT * FROM user_invitations WHERE token_hash = $1', [hashToken(token)]
    );
    if (!inv) return { valida: false, motivo: 'invalida' };

    if (inv.status === 'accepted') return { valida: false, motivo: 'usada', invitacion: inv };
    if (inv.status === 'cancelled') return { valida: false, motivo: 'cancelada', invitacion: inv };

    if (inv.status === 'expired' || new Date(inv.expires_at) <= new Date()) {
        if (inv.status === 'pending') await marcarVencidas();
        return { valida: false, motivo: 'expirada', invitacion: inv };
    }

    return { valida: true, invitacion: inv };
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
    const errores = [];
    const nombre = typeof full_name === 'string' ? full_name.trim() : '';

    if (nombre.length < 2 || nombre.length > 150) {
        errores.push({ campo: 'full_name', detalle: 'Ingresa tu nombre completo (entre 2 y 150 caracteres).' });
    }
    if (typeof password !== 'string' || !REGLA_CONTRASENA.test(password)) {
        errores.push({
            campo: 'password',
            detalle: 'La contrasena debe tener minimo 8 caracteres, al menos una mayuscula y un numero.'
        });
    }
    if (language !== undefined && language !== null && language !== '' && !IDIOMAS.includes(language)) {
        errores.push({ campo: 'language', detalle: `Idioma invalido. Validos: ${IDIOMAS.join(', ')}.` });
    }

    // El token se evalua ANTES que los datos del formulario: con un enlace
    // vencido no importa que la contrasena este bien, y el invitado tiene que
    // enterarse de lo primero.
    const previa = await evaluarToken(token);
    if (!previa.valida) throw rechazo(previa.motivo, previa.invitacion);
    if (errores.length > 0) throw errorHttp(400, { msg: 'Parametros invalidos', errores });

    const hash = await hashPassword(password);

    const resultado = await enTransaccion(async (cliente) => {
        // Un solo uso (criterio tecnico 1): el UPDATE condicionado es la
        // unica puerta. Si otro request lo acepto un instante antes, aca no
        // vuelve ninguna fila.
        const { rows: [inv] } = await cliente.query(
            `UPDATE user_invitations
                SET status = 'accepted', accepted_at = now(), updated_at = now()
              WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
              RETURNING *`,
            [hashToken(token)]
        );
        if (!inv) throw YA_NO_VIGENTE;   // se resuelve afuera, con el motivo real

        const { rows: existentes } = await cliente.query(
            'SELECT 1 FROM users WHERE lower(email) = $1', [inv.email]
        );
        if (existentes.length > 0) {
            throw errorHttp(409, { msg: 'Ya existe una cuenta con ese correo.', estado_actual: 'cuenta_activa' });
        }

        const { rows: [usuario] } = await cliente.query(
            `INSERT INTO users (email, password, role, full_name, language, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING id, email, role, full_name, language`,
            [inv.email, hash, inv.role, nombre, language || inv.language || null]
        );

        await cliente.query(
            'UPDATE user_invitations SET accepted_user_id = $2 WHERE id = $1', [inv.id, usuario.id]
        );
        await registrarEvento(cliente, inv, 'accepted', usuario.id);

        // Mismo evento que el registro publico y el de Google: el correo de
        // bienvenida, y lo que venga despues, no necesita saber como entro.
        await eventBus.publish(EVENTOS.USER_REGISTERED, {
            userId: usuario.id,
            email: usuario.email,
            role: usuario.role,
            provider: 'invitation'
        }, cliente);

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

    await enTransaccion(async (cliente) => {
        const { rows: [marcada] } = await cliente.query(
            `UPDATE user_invitations SET resend_requested_at = now(), updated_at = now()
              WHERE id = $1 AND resend_requested_at IS NULL
              RETURNING *`,
            [inv.id]
        );
        if (marcada) await registrarEvento(cliente, marcada, 'resend_requested', null);
    });

    // Aviso en la bandeja de quien la genero; si esa cuenta ya no esta
    // activa, a todos los admins activos, para que el pedido no se pierda.
    let { rows: destinatarios } = await db.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = true', [inv.invited_by]
    );
    if (destinatarios.length === 0) {
        ({ rows: destinatarios } = await db.query(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = true"
        ));
    }
    for (const { id } of destinatarios) {
        await notificationsService.crearSinEnviar('user.invitation_resend_requested', {
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
