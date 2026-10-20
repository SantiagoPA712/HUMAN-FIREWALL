/**
 * DTO del servicio de identidad. Ver compartido/http/validacion.js.
 *
 * Las invitaciones ya validaban su cuerpo dentro del servicio (con mensajes
 * por campo que la pantalla muestra); sus esquemas se publican en el
 * contrato pero no se enganchan como middleware, para no validar dos veces
 * con mensajes distintos.
 */

const { paramsId } = require('../../../compartido/http/validacion');
const { ROLES, IDIOMAS } = require('../dominio/usuario');

const correo = { type: 'string', format: 'email', maxLength: 254, examples: ['ana@empresa.com'] };
const contrasena = {
    type: 'string',
    minLength: 8,
    description: 'Minimo 8 caracteres, una mayuscula y un numero',
    examples: ['ClaveSegura1']
};

const login = {
    body: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', minLength: 1, examples: ['ana@empresa.com'] }, password: { type: 'string', minLength: 1 } }
    }
};

const registro = {
    body: { type: 'object', required: ['email', 'password'], properties: { email: correo, password: contrasena } }
};

const olvideContrasena = {
    body: { type: 'object', required: ['email'], properties: { email: { type: 'string', minLength: 1 } } }
};

const restablecerContrasena = {
    body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: { token: { type: 'string', minLength: 1 }, newPassword: contrasena }
    }
};

const crearUsuario = {
    body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
            email: correo,
            password: { type: 'string', minLength: 1 },
            role: { type: 'string', enum: ROLES, default: 'employee' }
        }
    }
};

const actualizarUsuario = {
    params: paramsId('id'),
    body: {
        type: 'object',
        properties: {
            role: { type: 'string', enum: ROLES },
            is_active: { type: 'boolean' }
        }
    }
};

const porId = { params: paramsId('id') };

const actualizarPerfil = {
    body: {
        type: 'object',
        required: ['language'],
        properties: {
            language: { type: ['string', 'null'], enum: [...IDIOMAS, null], description: 'null vuelve al idioma por defecto' }
        }
    }
};

// --- Solo documentacion (los valida el servicio de invitaciones) ---

const invitar = {
    body: {
        type: 'object',
        required: ['email', 'role'],
        properties: {
            email: correo,
            role: { type: 'string', enum: ['employee', 'instructor', 'rh'], description: 'Roles invitables' },
            language: { type: 'string', enum: IDIOMAS }
        }
    }
};

const tokenDeInvitacion = {
    body: { type: 'object', required: ['token'], properties: { token: { type: 'string', minLength: 1 } } }
};

const aceptarInvitacion = {
    body: {
        type: 'object',
        required: ['token', 'password', 'full_name'],
        properties: {
            token: { type: 'string', minLength: 1 },
            password: contrasena,
            full_name: { type: 'string', minLength: 2, maxLength: 150 },
            language: { type: 'string', enum: IDIOMAS }
        }
    }
};

const filtroDeInvitaciones = {
    query: {
        type: 'object',
        properties: { estado: { type: 'string', enum: ['pendiente', 'aceptada', 'expirada', 'cancelada'] } }
    }
};

module.exports = {
    login,
    registro,
    olvideContrasena,
    restablecerContrasena,
    crearUsuario,
    actualizarUsuario,
    porId,
    actualizarPerfil,
    invitar,
    tokenDeInvitacion,
    aceptarInvitacion,
    filtroDeInvitaciones
};
