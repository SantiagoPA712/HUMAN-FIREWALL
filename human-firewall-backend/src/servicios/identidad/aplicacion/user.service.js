/**
 * Casos de uso de cuentas: alta por un admin, listado y perfil propio.
 */

const db = require('../../../compartido/config/db');
const { hashPassword } = require('../../../compartido/utils/hash');
const { cambiosDePerfil } = require('../dominio/usuario');

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
 * Lo que el empleado ve de su propia cuenta (criterio de aceptacion 1). El
 * rol, el equipo y la fecha de alta se muestran pero no se editan: ver
 * CAMPOS_EDITABLES_PERFIL en dominio/usuario.js.
 */
const COLUMNAS_PERFIL = `u.id, u.email, u.role, u.full_name, u.phone, u.language,
       t.name AS team_name, u.created_at, u.updated_at`;

async function leerPerfil(cliente, userId, { bloquear = false } = {}) {
    const { rows } = await cliente.query(
        `SELECT ${COLUMNAS_PERFIL}
           FROM users u
           LEFT JOIN teams t ON t.id = u.team_id
          WHERE u.id = $1
          ${bloquear ? 'FOR UPDATE OF u' : ''}`,
        [userId]
    );
    return rows[0] || null;
}

exports.getProfile = (userId) => leerPerfil(db, userId);

/**
 * Actualiza los campos editables del perfil propio (HU de perfil editable).
 *
 * Recibe los valores ya validados y normalizados por el dominio. Lee la fila
 * con FOR UPDATE, compara y escribe solo lo que cambio, todo en una
 * transaccion (criterio tecnico 10): si el UPDATE falla no queda nada a
 * medias, y dos guardados simultaneos no comparan contra el mismo "antes".
 *
 * Si nada cambio no se escribe (criterio de aceptacion 5): ni UPDATE ni
 * updated_at nuevo.
 *
 * @returns {Promise<null | { antes, perfil, cambios }>} null si el usuario no existe
 */
exports.updateProfile = async (userId, valores) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const antes = await leerPerfil(client, userId, { bloquear: true });
        if (!antes) {
            await client.query('ROLLBACK');
            return null;
        }

        const cambios = cambiosDePerfil(antes, valores);
        if (Object.keys(cambios).length === 0) {
            await client.query('ROLLBACK');
            return { antes, perfil: antes, cambios };
        }

        const sets = [];
        const params = [userId];
        for (const [columna, valor] of Object.entries(cambios)) {
            params.push(valor);
            sets.push(`${columna} = $${params.length}`);
        }
        await client.query(
            `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
            params
        );
        const perfil = await leerPerfil(client, userId);

        await client.query('COMMIT');
        return { antes, perfil, cambios };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};
