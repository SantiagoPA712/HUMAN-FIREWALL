/** Cliente del servicio de seguridad, visto desde gamificacion. */
const seguridad = () => require('../../../seguridad/index');

module.exports = {
    /** Registra una accion critica en data.logs (asincrono, nunca falla la accion). */
    registrarAccion: (datos) => seguridad().registrarAccion(datos),
    /** Constantes de data.logs: ACCIONES y MODULOS. */
    get ACCIONES() { return seguridad().ACCIONES; },
    get MODULOS() { return seguridad().MODULOS; },
    /** Deja constancia de un ajuste manual en audit_log (panel de seguridad). */
    auditarAjusteManual: (datos) => seguridad().auditarAjusteManual(datos)
};
