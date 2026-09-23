const db = require('../config/db');
const { hashPassword } = require('../utils/hash');

exports.createUser = async (data) => {

    const hashed = await hashPassword(data.password);

    const result = await db.query(
        "INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role",
        [data.email, hashed, data.role || 'employee']
    );

    return result.rows[0];
};

exports.getUsers = async () => {
    const { rows } = await db.query("SELECT id, email, role FROM users");
    return rows;
};

/**
 * Perfil propio. Por ahora solo lo que el usuario puede ver y cambiar de su
 * cuenta: el idioma (HU de notificaciones por correo, criterio de aceptacion 3).
 */
exports.getProfile = async (userId) => {
    const { rows } = await db.query(
        "SELECT id, email, role, language FROM users WHERE id = $1",
        [userId]
    );
    return rows[0] || null;
};

/**
 * Cambia el idioma de la cuenta. null lo deja "sin configurar", y entonces los
 * correos salen en el idioma por defecto de la plataforma.
 */
exports.updateLanguage = async (userId, language) => {
    const { rows } = await db.query(
        "UPDATE users SET language = $2, updated_at = now() WHERE id = $1 RETURNING id, email, role, language",
        [userId, language]
    );
    return rows[0] || null;
};
