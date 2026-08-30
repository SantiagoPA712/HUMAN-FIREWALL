const db = require('../config/db');
const { hashPassword } = require('../utils/hash');

/** Roles validos. Coincide con el CHECK de la migracion 005. */
const ROLES = ['employee', 'instructor', 'rh', 'admin'];

/**
 * Valida los datos de alta o edicion de un usuario.
 *
 * Devuelve una lista de errores con el campo concreto, igual que el modulo de
 * reportes: un 500 con "violates foreign key constraint" no le dice a RH que
 * el equipo que eligio no existe.
 *
 * @param {object}  datos
 * @param {boolean} esAlta  en el alta el correo y la clave son obligatorios
 */
async function validar(datos, { esAlta = true } = {}) {
    const errores = [];

    if (esAlta) {
        if (!datos.email) {
            errores.push({ campo: 'email', detalle: 'El correo es obligatorio.' });
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) {
            errores.push({ campo: 'email', detalle: `"${datos.email}" no es un correo valido.` });
        }

        // Misma exigencia que el registro publico (auth.controller): no tiene
        // sentido que una cuenta creada por un admin sea mas debil.
        if (!datos.password) {
            errores.push({ campo: 'password', detalle: 'La contrasena es obligatoria.' });
        } else if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(datos.password)) {
            errores.push({
                campo: 'password',
                detalle: 'Minimo 8 caracteres, con al menos una mayuscula y un numero.'
            });
        }
    }

    if (datos.role !== undefined && !ROLES.includes(datos.role)) {
        errores.push({
            campo: 'role',
            detalle: `Rol invalido: "${datos.role}". Validos: ${ROLES.join(', ')}.`
        });
    }

    // team_id acepta null explicito para desasignar a alguien de su equipo.
    if (datos.team_id !== undefined && datos.team_id !== null && datos.team_id !== '') {
        const id = Number(datos.team_id);
        if (!Number.isInteger(id) || id <= 0) {
            errores.push({ campo: 'team_id', detalle: `Debe ser un entero positivo, se recibio "${datos.team_id}".` });
        } else {
            const { rows } = await db.query('SELECT 1 FROM teams WHERE id = $1', [id]);
            if (rows.length === 0) {
                errores.push({ campo: 'team_id', detalle: `No existe ningun equipo con id ${id}.` });
            }
        }
    }

    return errores;
}

/**
 * Alta de usuario.
 *
 * team_id se agrego aca junto con la HU de reportes: la migracion 025 creo la
 * columna, pero sin esto la unica forma de asignarle equipo a alguien era un
 * UPDATE a mano en la base, y el filtro por equipo del reporte quedaba
 * inusable en la practica.
 */
exports.createUser = async (data) => {
    const hashed = await hashPassword(data.password);

    const equipo = data.team_id === undefined || data.team_id === '' || data.team_id === null
        ? null
        : Number(data.team_id);

    const result = await db.query(
        `INSERT INTO users (email, password, role, team_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, team_id, is_active, created_at`,
        [data.email, hashed, data.role || 'employee', equipo]
    );

    return result.rows[0];
};

/**
 * Listado de usuarios.
 *
 * Antes devolvia solo id, email y role. Sin el equipo ni el estado, una
 * pantalla de administracion no puede mostrar a quien le falta asignacion, que
 * es exactamente lo que RH necesita ver.
 */
exports.getUsers = async () => {
    const { rows } = await db.query(
        `SELECT u.id, u.email, u.role, u.is_active,
                u.team_id, t.name AS equipo,
                u.total_points, u.level, u.created_at
           FROM users u
           LEFT JOIN teams t ON t.id = u.team_id
          ORDER BY u.id`
    );
    return rows;
};

/** Equipos disponibles, para poblar el selector del alta. */
exports.getTeams = async () => {
    const { rows } = await db.query(
        `SELECT t.id, t.name, t.description,
                COUNT(u.id)::int AS integrantes
           FROM teams t
           LEFT JOIN users u ON u.team_id = t.id AND u.is_active = true
          WHERE t.is_active = true
          GROUP BY t.id, t.name, t.description
          ORDER BY t.name`
    );
    return rows;
};

exports.validar = validar;
exports.ROLES = ROLES;
