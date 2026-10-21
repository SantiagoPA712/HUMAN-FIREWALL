/**
 * Reglas del dominio de invitaciones. Funciones y constantes puras.
 */

const { IDIOMAS, cumplePolitica } = require('./usuario');

/** Roles que se pueden invitar. Mismos valores que el CHECK de la migracion 035. */
const ROLES_INVITABLES = ['employee', 'instructor', 'rh'];

/** Estados de la base -> lo que ve el panel. */
const ESTADOS = {
    pending:   'pendiente',
    accepted:  'aceptada',
    expired:   'expirada',
    cancelled: 'cancelada'
};

/** Estado de la base a partir del nombre que usa el panel, o null. */
const estadoDesdeNombre = (nombre) =>
    Object.entries(ESTADOS).find(([, es]) => es === nombre)?.[0] || null;

/** Solo se reenvia o cancela lo que no se acepto ni se cancelo. */
const sePuedeReenviarOCancelar = (status) => ['pending', 'expired'].includes(status);

/**
 * Motivos por los que un enlace no sirve. El cuerpo NO repite el correo ni el
 * rol: con un token adivinado o robado no se aprende nada de la invitacion.
 */
const RECHAZOS = {
    invalida:  { codigo: 404, msg: 'El enlace de invitacion no es valido.' },
    usada:     { codigo: 410, msg: 'Esta invitacion ya fue utilizada. Si ya tenes cuenta, inicia sesion.' },
    cancelada: { codigo: 410, msg: 'Esta invitacion fue cancelada por un administrador.' },
    expirada:  { codigo: 410, msg: 'Esta invitacion vencio. Podes pedir que te envien una nueva.' }
};

/** Un token con forma imposible ni se busca. */
const tokenConFormaValida = (token) => typeof token === 'string' && token.length >= 20 && token.length <= 200;

/**
 * Estado de una invitacion encontrada por su token.
 * @returns {{ valida: true } | { valida: false, motivo: string }}
 */
function evaluar(inv, ahora = new Date()) {
    if (!inv) return { valida: false, motivo: 'invalida' };
    if (inv.status === 'accepted') return { valida: false, motivo: 'usada' };
    if (inv.status === 'cancelled') return { valida: false, motivo: 'cancelada' };
    if (inv.status === 'expired' || new Date(inv.expires_at) <= ahora) return { valida: false, motivo: 'expirada' };
    return { valida: true };
}

const normalizarEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const idiomaValido = (language) =>
    language === undefined || language === null || language === '' || IDIOMAS.includes(language);

/** Errores por campo de una invitacion nueva (correo ya normalizado). */
function validarInvitacion({ correo, role, language }, esCorreoValido) {
    const errores = [];
    if (!esCorreoValido(correo)) errores.push({ campo: 'email', detalle: 'Correo invalido.' });
    if (!ROLES_INVITABLES.includes(role)) {
        errores.push({ campo: 'role', detalle: `Rol invalido. Se puede invitar a: ${ROLES_INVITABLES.join(', ')}.` });
    }
    if (!idiomaValido(language)) {
        errores.push({ campo: 'language', detalle: `Idioma invalido. Validos: ${IDIOMAS.join(', ')}.` });
    }
    return errores;
}

/** Errores por campo del formulario de aceptacion. */
function validarAceptacion({ nombre, password, language }) {
    const errores = [];
    if (nombre.length < 2 || nombre.length > 150) {
        errores.push({ campo: 'full_name', detalle: 'Ingresa tu nombre completo (entre 2 y 150 caracteres).' });
    }
    if (!cumplePolitica(password)) {
        errores.push({
            campo: 'password',
            detalle: 'La contrasena debe tener minimo 8 caracteres, al menos una mayuscula y un numero.'
        });
    }
    if (!idiomaValido(language)) {
        errores.push({ campo: 'language', detalle: `Idioma invalido. Validos: ${IDIOMAS.join(', ')}.` });
    }
    return errores;
}

module.exports = {
    ROLES_INVITABLES,
    ESTADOS,
    RECHAZOS,
    estadoDesdeNombre,
    sePuedeReenviarOCancelar,
    tokenConFormaValida,
    evaluar,
    normalizarEmail,
    validarInvitacion,
    validarAceptacion
};
