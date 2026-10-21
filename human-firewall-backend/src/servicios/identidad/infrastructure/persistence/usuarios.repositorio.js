/**
 * Repositorio de cuentas de usuario (esquema identidad).
 *
 * Capa Infrastructure / Persistence: el unico lugar del servicio de identidad
 * que escribe SQL sobre users e teams. No valida ni
 * decide nada; la capa de aplicacion lo usa y el dominio pone las reglas.
 *
 * Las funciones que participan de una transaccion reciben `tx`, el cliente
 * que abre la capa de aplicacion con conTransaccion(). Sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------

async function existe(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return false;
    // rows.length y no rowCount: PGlite (la base de las pruebas) no expone rowCount.
    const { rows } = await db.query('SELECT 1 FROM identidad.users WHERE id = $1', [id]);
    return rows.length > 0;
}

/** Fila completa por correo exacto (login y Google). */
async function buscarPorCorreo(email) {
    const { rows } = await db.query('SELECT * FROM identidad.users WHERE email = $1', [email]);
    return rows[0] || null;
}

/** { id, is_active } de la cuenta con ese correo, sin distinguir mayusculas. */
async function cuentaPorCorreo(email, tx) {
    const { rows } = await q(tx).query(
        'SELECT id, is_active FROM identidad.users WHERE lower(email) = $1',
        [email]
    );
    return rows[0] || null;
}

async function listar() {
    const { rows } = await db.query('SELECT id, email, role FROM identidad.users');
    return rows;
}

async function estadoActual(userId) {
    const { rows } = await db.query('SELECT id, role, is_active FROM identidad.users WHERE id = $1', [userId]);
    return rows[0] || null;
}

async function correoDe(userId) {
    if (!userId) return null;
    const { rows } = await db.query('SELECT email FROM identidad.users WHERE id = $1', [userId]);
    return rows[0]?.email || null;
}

async function idPorCorreo(email) {
    const { rows } = await db.query('SELECT id FROM identidad.users WHERE email = $1', [email]);
    return rows[0]?.id || null;
}

/** Datos de contacto para notificar: id, correo, idioma y nombre. */
async function contactoDe(userId) {
    const { rows } = await db.query(
        'SELECT id, email, language, full_name FROM identidad.users WHERE id = $1',
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
           FROM identidad.users empleado
           JOIN identidad.users rh ON rh.team_id = empleado.team_id
          WHERE empleado.id = $1
            AND empleado.team_id IS NOT NULL
            AND rh.role = 'rh'
            AND rh.is_active = true
            AND rh.id <> empleado.id`,
        [userId]
    );
    if (delEquipo.length > 0) return delEquipo.map(r => r.id);

    const { rows: todos } = await db.query(
        `SELECT id FROM identidad.users WHERE role = 'rh' AND is_active = true AND id <> $1`,
        [userId]
    );
    return todos.map(r => r.id);
}

async function activosConRol(rol) {
    const { rows } = await db.query('SELECT id FROM identidad.users WHERE role = $1 AND is_active = true', [rol]);
    return rows.map(r => r.id);
}

async function estaActivo(userId) {
    const { rows } = await db.query('SELECT 1 FROM identidad.users WHERE id = $1 AND is_active = true', [userId]);
    return rows.length > 0;
}

// ---------------------------------------------------------------------
// Perfil propio
// ---------------------------------------------------------------------

const COLUMNAS_PERFIL = `u.id, u.email, u.role, u.full_name, u.phone, u.language,
       t.name AS team_name, u.created_at, u.updated_at`;

/** Perfil con el nombre del equipo. `bloquear` toma la fila con FOR UPDATE. */
async function leerPerfil(userId, { bloquear = false } = {}, tx) {
    const { rows } = await q(tx).query(
        `SELECT ${COLUMNAS_PERFIL}
           FROM identidad.users u
           LEFT JOIN identidad.teams t ON t.id = u.team_id
          WHERE u.id = $1
          ${bloquear ? 'FOR UPDATE OF u' : ''}`,
        [userId]
    );
    return rows[0] || null;
}

/** Escribe solo las columnas de `cambios` y toca updated_at. */
async function actualizarPerfil(userId, cambios, tx) {
    const sets = [];
    const params = [userId];
    for (const [columna, valor] of Object.entries(cambios)) {
        params.push(valor);
        sets.push(`${columna} = $${params.length}`);
    }
    await q(tx).query(
        `UPDATE identidad.users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params
    );
}

// ---------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------

/** Alta de una cuenta con correo y contrasena. */
async function insertar({ email, passwordHash, role = 'employee', fullName = null, language = null, isActive = true }, tx) {
    const { rows } = await q(tx).query(
        `INSERT INTO identidad.users (email, password, role, full_name, language, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, role, full_name, language`,
        [email, passwordHash, role, fullName, language, isActive]
    );
    return rows[0];
}

/** Alta de una cuenta que entra por Google (sin contrasena). */
async function insertarConGoogle({ email, oauthId }) {
    const { rows } = await db.query(
        `INSERT INTO identidad.users (email, role, oauth_provider, oauth_id)
         VALUES ($1, 'employee', 'google', $2) RETURNING *`,
        [email, oauthId]
    );
    return rows[0];
}

async function vincularGoogle(userId, oauthId) {
    await db.query(
        "UPDATE identidad.users SET oauth_provider = 'google', oauth_id = $1 WHERE id = $2",
        [oauthId, userId]
    );
}

async function sumarIntentoFallido(userId) {
    await db.query(
        'UPDATE identidad.users SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE id = $1',
        [userId]
    );
}

async function reiniciarIntentos(userId) {
    await db.query('UPDATE identidad.users SET failed_attempts = 0 WHERE id = $1', [userId]);
}

async function actualizarContrasena(userId, passwordHash, tx) {
    await q(tx).query('UPDATE identidad.users SET password = $1 WHERE id = $2', [passwordHash, userId]);
}

/** UPDATE de rol y/o estado. Devuelve { id, role, is_active } o null. */
async function actualizar(userId, cambios) {
    const campos = [];
    const params = [];
    for (const [columna, valor] of Object.entries(cambios)) {
        params.push(valor);
        campos.push(`${columna} = $${params.length}`);
    }
    params.push(userId);
    const { rows } = await db.query(
        `UPDATE identidad.users SET ${campos.join(', ')} WHERE id = $${params.length}
         RETURNING id, role, is_active`,
        params
    );
    return rows[0] || null;
}

/** Baja logica. Devuelve { estaba_activo } o null si no existe. */
async function desactivar(userId) {
    const { rows } = await db.query(
        `UPDATE identidad.users u SET is_active = false
           FROM (SELECT id, is_active FROM identidad.users WHERE id = $1) previo
          WHERE u.id = previo.id
      RETURNING previo.is_active AS estaba_activo`,
        [userId]
    );
    return rows[0] || null;
}

module.exports = {
    existe,
    buscarPorCorreo,
    cuentaPorCorreo,
    listar,
    estadoActual,
    correoDe,
    idPorCorreo,
    contactoDe,
    responsablesRhDe,
    activosConRol,
    estaActivo,
    leerPerfil,
    actualizarPerfil,
    insertar,
    insertarConGoogle,
    vincularGoogle,
    sumarIntentoFallido,
    reiniciarIntentos,
    actualizarContrasena,
    actualizar,
    desactivar
};
