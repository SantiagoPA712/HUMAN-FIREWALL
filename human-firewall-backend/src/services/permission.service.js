/**
 * Servicio de Permisos de Reportes y Auditoria.
 *
 * Administra el acceso a reportes y recursos criticos con historial inmutable
 * y control transaccional estricto.
 */

const db = require('../config/db');

const RECURSOS_VALIDOS = new Set(['performance', 'anomalies', 'organizational', 'dashboard']);
const ACCIONES_VALIDAS = new Set(['view', 'export', 'modify']);

/**
 * Valida que los campos de recurso y accion pertenezcan a los valores permitidos.
 */
function validarCampos(resource, action) {
    if (!resource || !RECURSOS_VALIDOS.has(resource)) {
        throw new Error(`Recurso invalido: "${resource}". Permitidos: ${[...RECURSOS_VALIDOS].join(', ')}`);
    }
    if (action && !ACCIONES_VALIDAS.has(action)) {
        throw new Error(`Accion invalida: "${action}". Permitidas: ${[...ACCIONES_VALIDAS].join(', ')}`);
    }
}

// Caché de permisos en memoria para optimizar la verificación de acceso
const permissionCache = new Map();

function getCacheKey(role, resource, action) {
    return `${role}:${resource}:${action}`;
}

/**
 * Invalida la caché de permisos para un rol específico o toda la caché.
 */
function invalidatePermissionCache(role = null) {
    if (role) {
        for (const key of permissionCache.keys()) {
            if (key.startsWith(`${role}:`)) {
                permissionCache.delete(key);
            }
        }
    } else {
        permissionCache.clear();
    }
}

/**
 * Consulta la lista de permisos configurados.
 */
async function listPermissions({ role, resource } = {}) {
    const params = [];
    const where = [];

    if (role) {
        params.push(role);
        where.push(`role = $${params.length}`);
    }
    if (resource) {
        params.push(resource);
        where.push(`resource = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await db.query(
        `SELECT id, role, resource, action, allowed, created_at, updated_at
           FROM report_permissions
         ${whereClause}
          ORDER BY role, resource, action`,
        params
    );
    return rows;
}

/**
 * Verifica si un rol tiene permiso para ejecutar una accion sobre un recurso (con cache).
 */
async function hasPermission(role, resource, action) {
    const key = getCacheKey(role, resource, action);
    if (permissionCache.has(key)) {
        return permissionCache.get(key);
    }

    const { rows } = await db.query(
        `SELECT allowed
           FROM report_permissions
          WHERE role = $1 AND resource = $2 AND action = $3`,
        [role, resource, action]
    );

    const allowed = rows.length > 0 ? (rows[0].allowed === true) : false;
    permissionCache.set(key, allowed);
    return allowed;
}

/**
 * Crea o actualiza un permiso e inserta la entrada en el historial en la MISMA transaccion.
 *
 * @param {object} params
 * @param {string} params.role
 * @param {string} params.resource
 * @param {string} params.action
 * @param {boolean} params.allowed
 * @param {number} params.changedBy - ID del usuario administrador que realiza el cambio
 */
async function savePermission({ role, resource, action, allowed = true, changedBy }) {
    validarCampos(resource, action);
    if (!role) throw new Error('El campo "role" es obligatorio');
    if (!changedBy) throw new Error('El campo "changedBy" es obligatorio para registrar la auditoria');

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        // 1. Obtener valor previo (si existe)
        const { rows: prevRows } = await client.query(
            `SELECT id, role, resource, action, allowed
               FROM report_permissions
              WHERE role = $1 AND resource = $2 AND action = $3
              FOR UPDATE`,
            [role, resource, action]
        );

        const previousValue = prevRows.length > 0 ? prevRows[0] : null;

        // 2. Insertar o actualizar permiso
        const { rows: newRows } = await client.query(
            `INSERT INTO report_permissions (role, resource, action, allowed, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (role, resource, action)
             DO UPDATE SET allowed = $4, updated_at = now()
             RETURNING id, role, resource, action, allowed, created_at, updated_at`,
            [role, resource, action, Boolean(allowed)]
        );

        const newValue = newRows[0];

        // 3. Insertar registro en historial inmutable dentro de la misma transaccion
        await client.query(
            `INSERT INTO report_permissions_history (changed_by, resource, action, previous_value, new_value, timestamp)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [
                changedBy,
                resource,
                action,
                previousValue ? JSON.stringify(previousValue) : null,
                JSON.stringify(newValue)
            ]
        );

        await client.query('COMMIT');
        invalidatePermissionCache(role);
        return newValue;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Elimina un permiso e inserta la entrada en el historial en la MISMA transaccion.
 */
async function deletePermission({ role, resource, action, changedBy }) {
    validarCampos(resource, action);
    if (!role) throw new Error('El campo "role" es obligatorio');
    if (!changedBy) throw new Error('El campo "changedBy" es obligatorio');

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows: prevRows } = await client.query(
            `SELECT id, role, resource, action, allowed
               FROM report_permissions
              WHERE role = $1 AND resource = $2 AND action = $3
              FOR UPDATE`,
            [role, resource, action]
        );

        if (prevRows.length === 0) {
            await client.query('ROLLBACK');
            return null; // Nada que eliminar
        }

        const previousValue = prevRows[0];

        await client.query(
            `DELETE FROM report_permissions
              WHERE role = $1 AND resource = $2 AND action = $3`,
            [role, resource, action]
        );

        // Registro de eliminacion en el historial
        await client.query(
            `INSERT INTO report_permissions_history (changed_by, resource, action, previous_value, new_value, timestamp)
             VALUES ($1, $2, $3, $4, NULL, now())`,
            [changedBy, resource, action, JSON.stringify(previousValue)]
        );

        await client.query('COMMIT');
        invalidatePermissionCache(role);
        return previousValue;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Obtiene el historial de cambios de permisos paginado y ordenado por timestamp descendente.
 */
async function getPermissionHistory({ page = 1, limit = 20, resource } = {}) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (p - 1) * l;

    const params = [];
    let whereClause = '';

    if (resource) {
        params.push(resource);
        whereClause = `WHERE h.resource = $${params.length}`;
    }

    const countRes = await db.query(
        `SELECT COUNT(*)::int AS total FROM report_permissions_history h ${whereClause}`,
        params
    );
    const total = countRes.rows[0]?.total || 0;

    const queryParams = [...params, l, offset];
    const { rows } = await db.query(
        `SELECT h.id,
                h.changed_by,
                u.email AS changed_by_email,
                h.resource,
                h.action,
                h.previous_value,
                h.new_value,
                h.timestamp
           FROM report_permissions_history h
      LEFT JOIN users u ON u.id = h.changed_by
        ${whereClause}
          ORDER BY h.timestamp DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        queryParams
    );

    return {
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l) || 1,
        data: rows
    };
}

/**
 * Registra un intento de acceso a reportes en la tabla permission_audit_log.
 */
async function logPermissionAudit({ userId, resource, action, result }) {
    await db.query(
        `INSERT INTO permission_audit_log (user_id, resource, action, result, timestamp)
         VALUES ($1, $2, $3, $4, now())`,
        [userId || null, resource, action, result]
    );
}

module.exports = {
    listPermissions,
    hasPermission,
    savePermission,
    deletePermission,
    getPermissionHistory,
    logPermissionAudit,
    invalidatePermissionCache,
    RECURSOS_VALIDOS,
    ACCIONES_VALIDAS
};
