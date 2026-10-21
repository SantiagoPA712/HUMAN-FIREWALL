/**
 * Cliente del servicio de seguridad, visto desde identidad.
 * Ver servicios/evaluaciones/infrastructure/client/cursos.cliente.js.
 */
const seguridad = () => require('../../../seguridad/index');

module.exports = {
    /** Registra una accion critica en data.logs (asincrono, nunca falla la accion). */
    registrarAccion: (datos) => seguridad().registrarAccion(datos),
    get ACCIONES() { return seguridad().ACCIONES; },
    get MODULOS() { return seguridad().MODULOS; }
};
