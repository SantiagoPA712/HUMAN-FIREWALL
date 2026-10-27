/**
 * Repositorio de tokens de recuperacion de contrasena (esquema identidad).
 *
 * Capa Infrastructure / Persistence.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

async function insertarToken({ userId, token, expiraEn }) {
    await db.query(
        'INSERT INTO identidad.password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, expiraEn]
    );
}

/** { user_id, expires_at } o null. */
async function buscarToken(token) {
    const { rows } = await db.query(
        'SELECT user_id, expires_at FROM identidad.password_reset_tokens WHERE token = $1',
        [token]
    );
    return rows[0] || null;
}

async function borrarToken(token, tx) {
    await q(tx).query('DELETE FROM identidad.password_reset_tokens WHERE token = $1', [token]);
}

module.exports = { insertarToken, buscarToken, borrarToken };
