/**
 * Repositorio de exportaciones de reportes (servicio de reportes).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): la tabla
 * report_exports (estado de cada exportacion CSV/PDF).
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Registra una exportacion pedida (report_exports). */
async function insertarSolicitud(exportUid, userId, formato, filtros, estado) {
    const { rows } = await db.query(
        `INSERT INTO report_exports
            (export_uid, requested_by, report_type, format, filters, status)
         VALUES ($1, $2, 'performance', $3, $4, $5)
         RETURNING id, export_uid, status, created_at`,
        [exportUid, userId, formato, JSON.stringify(filtros), estado]
    );
    return rows;
}

/** La exportacion termino: archivo y cantidad de filas. */
async function marcarLista(exportUid, fileName, filas) {
    return db.query(
        `UPDATE report_exports
            SET status = 'ready', file_name = $2, row_count = $3, completed_at = now()
          WHERE export_uid = $1`,
        [exportUid, fileName, filas]
    );
}

/** La exportacion fallo, con el motivo. */
async function marcarFallida(exportUid, mensaje) {
    return db.query(
        `UPDATE report_exports
            SET status = 'failed', error = $2, completed_at = now()
          WHERE export_uid = $1`,
        [exportUid, mensaje]
    );
}

/** Nombre del equipo, para el encabezado del archivo. */
async function nombreDeEquipo(teamId) {
    const { rows } = await db.query('SELECT name FROM teams WHERE id = $1', [teamId]);
    return rows;
}

/** Titulo del curso, para el encabezado del archivo. */
async function tituloDeCurso(courseId) {
    const { rows } = await db.query('SELECT title FROM courses WHERE id = $1', [courseId]);
    return rows;
}

/** Estado de una exportacion. */
async function estadoDe(exportUid) {
    const { rows } = await db.query(
        'SELECT status FROM report_exports WHERE export_uid = $1',
        [exportUid]
    );
    return rows;
}

/** La exportacion empezo a generarse. */
async function marcarProcesando(exportUid) {
    return db.query(
        `UPDATE report_exports SET status = 'processing' WHERE export_uid = $1`,
        [exportUid]
    );
}

/** Exportacion por su uid publico. */
async function buscar(exportUid) {
    const { rows } = await db.query(
        `SELECT export_uid, format, status, row_count, created_at, completed_at
           FROM report_exports WHERE export_uid = $1`,
        [exportUid]
    );
    return rows;
}

/** Archivo, estado y formato de una exportacion. */
async function archivoDe(exportUid) {
    const { rows } = await db.query(
        `SELECT file_name, status, format FROM report_exports WHERE export_uid = $1`,
        [exportUid]
    );
    return rows;
}

module.exports = {
    insertarSolicitud,
    marcarLista,
    marcarFallida,
    nombreDeEquipo,
    tituloDeCurso,
    estadoDe,
    marcarProcesando,
    buscar,
    archivoDe
};
