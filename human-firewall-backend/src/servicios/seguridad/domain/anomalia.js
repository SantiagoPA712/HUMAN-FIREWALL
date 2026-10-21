/**
 * Anomalias (servicio de seguridad).
 *
 * Capa Domain (seccion 11 del material): Reglas de las anomalias: estados validos de revision.
 * Funciones puras: no tocan la base, ni HTTP, ni otros servicios, asi que se
 * pueden probar solas. La capa application/ las usa.
 */

/** Estados validos (criterio tecnico 5). */
const ESTADOS = ['pending', 'reviewed', 'dismissed'];

module.exports = { ESTADOS };
