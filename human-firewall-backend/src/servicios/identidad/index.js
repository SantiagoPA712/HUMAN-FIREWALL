/**
 * Servicio de identidad — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const usuarios = require('./infraestructura/usuarios.repositorio');

module.exports = {
    manifiesto,

    rutas: () => [
        { prefijo: '/api/auth', router: require('./api/auth.routes') },
        { prefijo: '/api/users', router: require('./api/user.routes') },
        { prefijo: '/api/sso', router: require('./api/sso.routes') },
        { prefijo: '/api/invitations', router: require('./api/invitations.routes') }
    ],

    /** Registra la estrategia de Google en passport (la usa /api/sso). */
    configurarAutenticacion: () => require('./infraestructura/passport'),

    registrarHandlers() {},
    iniciarProcesos() {},
    detenerProcesos() {},

    // --- Consultas para otros servicios ---

    usuarioExiste: (...args) => usuarios.existe(...args),
    correoDe: (...args) => usuarios.correoDe(...args),
    idPorCorreo: (...args) => usuarios.idPorCorreo(...args),
    /** { id, email, language, full_name } para notificar, o null. */
    obtenerContacto: (...args) => usuarios.contactoDe(...args),
    /** Ids de RH a avisar por un empleado (los de su equipo, o todos). */
    responsablesRhDe: (...args) => usuarios.responsablesRhDe(...args),
    /** Ids de las cuentas activas con un rol. */
    activosConRol: (...args) => usuarios.activosConRol(...args)
};
