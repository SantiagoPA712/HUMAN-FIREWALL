/**
 * Cliente del servicio de seguridad, visto desde identidad.
 * Ver servicios/evaluaciones/infraestructura/clientes/cursos.cliente.js.
 */
const seguridad = () => require('../../../seguridad');

module.exports = {
    /** Registra una accion critica en data.logs (asincrono, nunca falla la accion). */
    registrarAccion: (datos) => seguridad().registrarAccion(datos),
    get ACCIONES() { return seguridad().ACCIONES; },
    get MODULOS() { return seguridad().MODULOS; }
};
