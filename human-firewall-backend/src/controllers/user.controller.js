const db = require('../config/db');
const userService = require('../services/user.service');

/**
 * POST /api/users
 * Alta de usuario por un administrador.
 *
 * Se diferencia del registro publico (/api/auth/register) en dos cosas: aca se
 * puede elegir el rol y el equipo, alla siempre sale 'employee' sin equipo.
 */
exports.create = async (req, res) => {
    try {
        const errores = await userService.validar(req.body, { esAlta: true });
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Datos invalidos', errores });
        }

        const usuario = await userService.createUser(req.body);
        res.status(201).json({ msg: 'Usuario creado', usuario });

    } catch (error) {
        // 23505 = unique_violation. Antes salia como un 500 con el mensaje
        // crudo de Postgres, que no le dice nada a quien esta cargando gente.
        if (error.code === '23505') {
            return res.status(409).json({
                msg: 'Ya existe un usuario con ese correo',
                errores: [{ campo: 'email', detalle: 'Correo ya registrado.' }]
            });
        }
        res.status(500).json({ msg: error.message });
    }
};

/** GET /api/users */
exports.getAll = async (req, res) => {
    try {
        res.json(await userService.getUsers());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/** GET /api/users/teams — equipos disponibles, con cuantos integrantes tienen. */
exports.getTeams = async (req, res) => {
    try {
        res.json(await userService.getTeams());
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * PUT /api/users/:id
 * Cambia rol, equipo o estado.
 *
 * Se admite team_id: null explicito para sacar a alguien de su equipo, que es
 * distinto de "no mandar el campo" (dejarlo como esta).
 */
exports.updateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        const errores = await userService.validar(req.body, { esAlta: false });
        if (errores.length > 0) {
            return res.status(400).json({ msg: 'Datos invalidos', errores });
        }

        const { role, is_active, team_id } = req.body;
        const asignaciones = [];
        const params = [];

        if (role !== undefined) {
            params.push(role);
            asignaciones.push(`role = $${params.length}`);
        }
        if (is_active !== undefined) {
            params.push(is_active);
            asignaciones.push(`is_active = $${params.length}`);
        }
        // Se compara contra undefined y no con un if a secas: `team_id: null`
        // es una orden valida (sacarlo del equipo) y un `if (team_id)` la
        // descartaria por ser null un valor falsy.
        if (team_id !== undefined) {
            params.push(team_id === '' || team_id === null ? null : Number(team_id));
            asignaciones.push(`team_id = $${params.length}`);
        }

        if (asignaciones.length === 0) {
            return res.status(400).json({
                msg: 'No se envio ningun campo para actualizar (role, team_id o is_active)'
            });
        }

        params.push(id);
        const { rows } = await db.query(
            `UPDATE users SET ${asignaciones.join(', ')}, updated_at = now()
              WHERE id = $${params.length}
              RETURNING id, email, role, team_id, is_active`,
            params
        );

        if (rows.length === 0) return res.status(404).json({ msg: 'Usuario no encontrado' });

        res.status(200).json({ msg: 'Usuario actualizado', usuario: rows[0] });

    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

/**
 * DELETE /api/users/:id
 * Desactiva la cuenta. No borra: el historial de puntos, niveles y
 * recompensas referencia al usuario y debe seguir siendo consultable.
 */
exports.deactivateUser = async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ msg: 'Id de usuario invalido' });
        }

        // Un admin que se desactiva a si mismo se deja fuera del sistema y
        // puede que no quede ningun otro para revertirlo.
        if (Number(req.user.id) === id) {
            return res.status(400).json({ msg: 'No podes desactivar tu propia cuenta' });
        }

        const { rows } = await db.query(
            'UPDATE users SET is_active = false WHERE id = $1 RETURNING id, email',
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ msg: 'Usuario no encontrado' });

        res.status(200).json({ msg: 'Usuario desactivado', usuario: rows[0] });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};
