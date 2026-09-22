const db = require('../config/db');
const userService = require('../services/user.service');
const dataLogs = require('../services/dataLogs.service');

// Mismos valores que el CHECK de users.role (migracion 032).
const ROLES_VALIDOS = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

exports.create = async (req, res) => {
    try {
        const { role } = req.body || {};
        if (role && !ROLES_VALIDOS.includes(role)) {
            return res.status(400).json({
                msg: 'Parametros invalidos',
                errores: [{ campo: 'role', detalle: `Rol invalido. Validos: ${ROLES_VALIDOS.join(', ')}.` }]
            });
        }

        const creado = await userService.createUser(req.body);

        // Creacion de un recurso sensible (criterio tecnico 1 de la HU de
        // logs). Se pasa el body tal cual a proposito: trae la contrasena, y
        // el enmascarado del servicio la deja en "[REDACTED]" (criterio 5).
        dataLogs.registrar({
            req,
            accion: dataLogs.ACCIONES.CREATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: creado?.id,
            despues: { ...req.body, role: creado?.role || req.body.role || 'employee' }
        });

        res.status(201).json({ msg: "Usuario creado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const users = await userService.getUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PUT /api/users/:id  { role?, is_active? }
 *
 * Cambios con la HU de logs de auditoria:
 *   - el rol se valida ANTES del UPDATE. Antes un rol inexistente llegaba al
 *     CHECK de la base y volvia un 500 con el error crudo de Postgres;
 *   - se lee el estado anterior, porque el log de un cambio de rol sin el
 *     rol que tenia antes no sirve para investigar nada;
 *   - un id que no existe devuelve 404 en lugar de "Usuario actualizado".
 */
exports.updateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        const { role, is_active } = req.body || {};
        const errores = [];

        if (role !== undefined && !ROLES_VALIDOS.includes(role)) {
            errores.push({ campo: 'role', detalle: `Rol invalido. Validos: ${ROLES_VALIDOS.join(', ')}.` });
        }
        if (is_active !== undefined && typeof is_active !== 'boolean') {
            errores.push({ campo: 'is_active', detalle: 'Debe ser true o false.' });
        }
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Parametros invalidos', errores });
        }

        const { rows: actuales } = await db.query(
            'SELECT id, role, is_active FROM users WHERE id = $1', [id]
        );
        if (actuales.length === 0) return res.status(404).json({ msg: 'Usuario no encontrado' });
        const antes = actuales[0];

        const campos = [];
        const params = [];
        if (role !== undefined && role !== antes.role) {
            params.push(role);
            campos.push(`role = $${params.length}`);
        }
        if (is_active !== undefined && is_active !== antes.is_active) {
            params.push(is_active);
            campos.push(`is_active = $${params.length}`);
        }

        // Nada que cambiar: no se escribe ni se registra un "cambio" vacio.
        if (campos.length === 0) {
            return res.status(200).json({ msg: "Usuario actualizado" });
        }

        params.push(id);
        const { rows: [despues] } = await db.query(
            `UPDATE users SET ${campos.join(', ')} WHERE id = $${params.length}
             RETURNING id, role, is_active`,
            params
        );

        // Un cambio de rol es su propio tipo de accion (criterio tecnico 1
        // lo nombra aparte): es lo primero que se busca ante una escalada de
        // privilegios. Si en la misma llamada tambien cambio is_active, va en
        // la misma fila.
        const cambioDeRol = despues.role !== antes.role;
        dataLogs.registrar({
            req,
            accion: cambioDeRol ? dataLogs.ACCIONES.ROLE_CHANGE : dataLogs.ACCIONES.UPDATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: id,
            antes: { role: antes.role, is_active: antes.is_active },
            despues: { role: despues.role, is_active: despues.is_active }
        });

        res.status(200).json({ msg: "Usuario actualizado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * DELETE /api/users/:id — baja logica (is_active = false).
 * Se registra como "deactivate" y no como "delete": el usuario sigue en la
 * base, y quien lea el log tiene que saber que se puede revertir.
 */
exports.deactivateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        const { rows } = await db.query(
            `UPDATE users u SET is_active = false
               FROM (SELECT id, is_active FROM users WHERE id = $1) previo
              WHERE u.id = previo.id
          RETURNING previo.is_active AS estaba_activo`,
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: 'Usuario no encontrado' });

        dataLogs.registrar({
            req,
            accion: dataLogs.ACCIONES.DEACTIVATE,
            modulo: dataLogs.MODULOS.USERS,
            recurso: 'user',
            recursoId: id,
            antes: { is_active: rows[0].estaba_activo },
            despues: { is_active: false }
        });

        res.status(200).json({ msg: "Usuario desactivado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
