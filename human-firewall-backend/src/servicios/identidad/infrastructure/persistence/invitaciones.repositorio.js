/**
 * Repositorio de invitaciones (esquema identidad).
 *
 * Capa Infrastructure / Persistence: user_invitations y su historial
 * user_invitation_events. Las reglas (vigencia, estados, quien puede
 * reenviar) estan en domain/invitacion.js y el flujo en
 * application/invitations.service.js.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/**
 * Agrega una fila al historial. Copia correo, rol y admin que la genero: el
 * historial se tiene que poder leer solo.
 */
async function registrarEvento(inv, accion, actorId = null, ocurrio = null, tx) {
    await q(tx).query(
        `INSERT INTO identidad.user_invitation_events
             (invitation_id, action, actor_user_id, invited_by, email, role, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [inv.id, accion, actorId, inv.invited_by, inv.email, inv.role, ocurrio]
    );
}

/** Pasa a 'expired' las pendientes vencidas. Devuelve las filas afectadas. */
async function marcarVencidas(tx) {
    const { rows } = await q(tx).query(
        `UPDATE identidad.user_invitations
            SET status = 'expired', expired_at = expires_at, updated_at = now()
          WHERE status = 'pending' AND expires_at <= now()
          RETURNING *`
    );
    return rows;
}

/** La invitacion pendiente de ese correo (opcionalmente excluyendo una), o null. */
async function pendientePorCorreo(email, excepto = null) {
    const { rows } = await db.query(
        `SELECT id, expires_at FROM identidad.user_invitations
          WHERE email = $1 AND status = 'pending' AND ($2::bigint IS NULL OR id <> $2)`,
        [email, excepto]
    );
    return rows[0] || null;
}

async function insertar({ email, role, language, tokenHash, horasDeVigencia, invitedBy }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO identidad.user_invitations (email, role, language, token_hash, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6)
         RETURNING *`,
        [email, role, language, tokenHash, String(horasDeVigencia), invitedBy]
    );
    return rows[0];
}

/** Lee y bloquea (FOR UPDATE) una invitacion por id. */
async function bloquear(id, tx) {
    const { rows } = await q(tx).query('SELECT * FROM identidad.user_invitations WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] || null;
}

/** Enlace nuevo: hash nuevo, vigencia nueva, un envio mas. */
async function renovar(id, { tokenHash, horasDeVigencia }, tx) {
    const { rows } = await q(tx).query(
        `UPDATE identidad.user_invitations
            SET token_hash = $2,
                expires_at = now() + ($3 || ' hours')::interval,
                status = 'pending',
                send_count = send_count + 1,
                resend_requested_at = NULL,
                expired_at = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id, tokenHash, String(horasDeVigencia)]
    );
    return rows[0];
}

async function cancelar(id, tx) {
    const { rows } = await q(tx).query(
        `UPDATE identidad.user_invitations
            SET status = 'cancelled', cancelled_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [id]
    );
    return rows[0];
}

/** Listado del panel con el correo de quien invito y el historial. */
async function listar(status = null) {
    const { rows } = await db.query(
        `SELECT i.*, u.email AS invited_by_email,
                COALESCE(
                    json_agg(json_build_object(
                        'accion', e.action, 'actor_id', e.actor_user_id, 'en', e.occurred_at
                    ) ORDER BY e.occurred_at, e.id) FILTER (WHERE e.id IS NOT NULL),
                    '[]'
                ) AS historial
           FROM identidad.user_invitations i
           LEFT JOIN identidad.users u ON u.id = i.invited_by
           LEFT JOIN identidad.user_invitation_events e ON e.invitation_id = i.id
          WHERE ($1::text IS NULL OR i.status = $1)
          GROUP BY i.id, u.email
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT 200`,
        [status]
    );
    return rows;
}

async function contarPorEstado() {
    const { rows } = await db.query(
        'SELECT status, COUNT(*)::int AS total FROM identidad.user_invitations GROUP BY status'
    );
    return rows;
}

async function buscarPorHash(tokenHash) {
    const { rows } = await db.query('SELECT * FROM identidad.user_invitations WHERE token_hash = $1', [tokenHash]);
    return rows[0] || null;
}

/**
 * Un solo uso: el UPDATE condicionado es la unica puerta. Si otro request la
 * acepto un instante antes, no vuelve ninguna fila.
 */
async function aceptarPorHash(tokenHash, tx) {
    const { rows } = await q(tx).query(
        `UPDATE identidad.user_invitations
            SET status = 'accepted', accepted_at = now(), updated_at = now()
          WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
          RETURNING *`,
        [tokenHash]
    );
    return rows[0] || null;
}

async function asignarCuenta(id, userId, tx) {
    await q(tx).query('UPDATE identidad.user_invitations SET accepted_user_id = $2 WHERE id = $1', [id, userId]);
}

/** Marca el pedido de reenvio una sola vez. Devuelve la fila, o null si ya estaba. */
async function marcarReenvioSolicitado(id, tx) {
    const { rows } = await q(tx).query(
        `UPDATE identidad.user_invitations SET resend_requested_at = now(), updated_at = now()
          WHERE id = $1 AND resend_requested_at IS NULL
          RETURNING *`,
        [id]
    );
    return rows[0] || null;
}

module.exports = {
    registrarEvento,
    marcarVencidas,
    pendientePorCorreo,
    insertar,
    bloquear,
    renovar,
    cancelar,
    listar,
    contarPorEstado,
    buscarPorHash,
    aceptarPorHash,
    asignarCuenta,
    marcarReenvioSolicitado
};
