const db = require('../config/db');
const crypto = require('crypto');
const { hashPassword } = require('../utils/hash');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');

exports.generateResetToken = async (email) => {
    // Verificar si el usuario existe
    const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (rows.length === 0) {
        throw new Error("El correo no está registrado");
    }

    const userId = rows[0].id;
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hora de validez

    await db.query(
        "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
        [userId, resetToken, expiresAt]
    );

    return resetToken;
};

exports.resetPassword = async (token, newPassword) => {
    const { rows } = await db.query(
        "SELECT user_id, expires_at FROM password_reset_tokens WHERE token = $1",
        [token]
    );

    if (rows.length === 0) {
        throw new Error("Token inválido");
    }

    const { user_id, expires_at } = rows[0];

    if (new Date() > new Date(expires_at)) {
        throw new Error("El token ha expirado");
    }

    // Validar contraseña
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
        throw new Error("La contraseña debe tener mínimo 8 caracteres, al menos una mayúscula y un número");
    }

    const hashed = await hashPassword(newPassword);

    // HU de notificaciones por correo: el cambio publica user.password_changed,
    // que dispara un correo CRITICO de seguridad (no desactivable). Va en la
    // misma transaccion que el UPDATE: si la contrasena cambio, el aviso
    // existe; si el UPDATE se revierte, no sale un aviso falso.
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, user_id]);
        await client.query("DELETE FROM password_reset_tokens WHERE token = $1", [token]);
        await eventBus.publish(EVENTOS.USER_PASSWORD_CHANGED, {
            userId: user_id,
            changedAt: new Date().toISOString()
        }, client);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }

    // Antes devolvia true. Ahora devuelve a quien se le cambio la contrasena,
    // para que el log de auditoria sepa sobre que cuenta fue.
    return { userId: user_id };
};
