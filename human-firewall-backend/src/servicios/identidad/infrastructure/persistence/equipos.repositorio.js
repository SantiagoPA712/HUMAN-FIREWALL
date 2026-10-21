/**
 * Repositorio de equipos (areas) del servicio de identidad.
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): la tabla
 * identidad.teams. Reportes los pide por el contrato de identidad.
 */

const db = require('../../../../compartido/config/db');

/** { id, name, is_active } o null. */
async function buscar(id) {
    const { rows } = await db.query('SELECT id, name, is_active FROM identidad.teams WHERE id = $1', [id]);
    return rows[0] || null;
}

/** Equipos activos ordenados por nombre. */
async function activos() {
    const { rows } = await db.query('SELECT id, name FROM identidad.teams WHERE is_active = true ORDER BY name');
    return rows;
}

module.exports = { buscar, activos };
