/**
 * Servicio de identidad — puerta de entrada publica.
 * Ver servicios/cursos/index.js para la explicacion de este archivo.
 */

const manifiesto = require('./manifiesto');
const usuarios = require('./infrastructure/persistence/usuarios.repositorio');

module.exports = {
    manifiesto,

    /** Contrato publico (OpenAPI) de la API HTTP del servicio. */
    contrato: () => require('./contract/openapi'),

    rutas: () => [
        { prefijo: '/api/auth', router: require('./controller/auth.routes') },
        { prefijo: '/api/users', router: require('./controller/user.routes') },
        { prefijo: '/api/sso', router: require('./controller/sso.routes') },
        { prefijo: '/api/invitations', router: require('./controller/invitations.routes') }
    ],

    /** Registra la estrategia de Google en passport (la usa /api/sso). */
    configurarAutenticacion: () => require('./infrastructure/passport'),

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
