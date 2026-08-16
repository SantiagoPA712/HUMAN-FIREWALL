const db = require('../config/db');
const crypto = require('crypto');
const { hashPassword } = require('../utils/hash');

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

    await db.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, user_id]);
    await db.query("DELETE FROM password_reset_tokens WHERE token = $1", [token]);

    return true;
};
