/**
 * Cliente del servicio de gamificacion, visto desde evaluaciones.
 * Ver cursos.cliente.js para el por que de este archivo.
 */
const gamificacion = () => require('../../../gamificacion');

module.exports = {
    /**
     * Consulta (no comando): si un movimiento con esta clave de idempotencia
     * ya se otorgo. Evaluaciones la usa para poder decirle al usuario en la
     * misma respuesta que esa decision ya habia sumado puntos.
     */
    yaOtorgado: (clave) => gamificacion().yaOtorgado(clave)
};
