/**
 * Repositorio de cuentas de usuario.
 *
 * Reune el SQL que antes estaba en user.controller.js y las consultas que
 * otros servicios hacian directo sobre users (correo de un usuario, RH de su
 * equipo, admins activos). Ahora esas preguntas se responden aca y se
 * exponen por el contrato del servicio (index.js).
 */

const db = require('../../../compartido/config/db');

async function existe(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return false;
    // rows.length y no rowCount: PGlite (la base de las pruebas) no expone
    // rowCount, y con esa guarda la prueba nunca ejercitaba el 404.
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [id]);
    return rows.length > 0;
}

async function estadoActual(userId) {
    const { rows } = await db.query('SELECT id, role, is_active FROM users WHERE id = $1', [userId]);
    return rows[0] || null;
}

/** UPDATE con solo los campos que cambian. */
async function actualizar(userId, cambios) {
    const campos = [];
    const params = [];
    for (const [columna, valor] of Object.entries(cambios)) {
        params.push(valor);
        campos.push(`${columna} = $${params.length}`);
    }
    params.push(userId);
    const { rows } = await db.query(
        `UPDATE users SET ${campos.join(', ')} WHERE id = $${params.length}
         RETURNING id, role, is_active`,
        params
    );
    return rows[0] || null;
}

/** Baja logica. Devuelve { estaba_activo } o null si no existe. */
async function desactivar(userId) {
    const { rows } = await db.query(
        `UPDATE users u SET is_active = false
           FROM (SELECT id, is_active FROM users WHERE id = $1) previo
          WHERE u.id = previo.id
      RETURNING previo.is_active AS estaba_activo`,
        [userId]
    );
    return rows[0] || null;
}

async function correoDe(userId) {
    const { rows } = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    return rows[0]?.email || null;
}

async function idPorCorreo(email) {
    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    return rows[0]?.id || null;
}

/** Datos de contacto para notificar: id, correo, idioma y nombre. */
async function contactoDe(userId) {
    const { rows } = await db.query(
        'SELECT id, email, language, full_name FROM users WHERE id = $1',
        [userId]
    );
    return rows[0] || null;
}

/**
 * RH activos del mismo equipo que el usuario. Si el equipo no tiene RH (el
 * estado por defecto: la migracion 025 siembra equipos pero no reparte a la
 * gente), todos los RH activos: es preferible a perder una alerta.
 */
async function responsablesRhDe(userId) {
    const { rows: delEquipo } = await db.query(
        `SELECT rh.id
           FROM users empleado
           JOIN users rh ON rh.team_id = empleado.team_id
          WHERE empleado.id = $1
            AND empleado.team_id IS NOT NULL
            AND rh.role = 'rh'
            AND rh.is_active = true
            AND rh.id <> empleado.id`,
        [userId]
    );
    if (delEquipo.length > 0) return delEquipo.map(r => r.id);

    const { rows: todos } = await db.query(
        `SELECT id FROM users WHERE role = 'rh' AND is_active = true AND id <> $1`,
        [userId]
    );
    return todos.map(r => r.id);
}

/** Ids de cuentas activas con un rol. */
async function activosConRol(rol) {
    const { rows } = await db.query('SELECT id FROM users WHERE role = $1 AND is_active = true', [rol]);
    return rows.map(r => r.id);
}

async function estaActivo(userId) {
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active = true', [userId]);
    return rows.length > 0;
}

module.exports = {
    existe,
    estadoActual,
    actualizar,
    desactivar,
    correoDe,
    idPorCorreo,
    contactoDe,
    responsablesRhDe,
    activosConRol,
    estaActivo
};
