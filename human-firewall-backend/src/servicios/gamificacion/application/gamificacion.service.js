/**
 * Consultas de gamificacion que pide el controller (ranking, estado del
 * usuario, catalogo, reglas).
 *
 * Capa Application / Service (seccion 11 del material): el controller ya no
 * llama al repositorio ni a otros servicios directamente; pasa por aca.
 */

const repo = require('../infrastructure/persistence/gamificacion.repositorio');
const identidad = require('../infrastructure/client/identidad.cliente');

module.exports = {
    usuarioExiste: (userId) => identidad.usuarioExiste(userId),
    // Ranking y estado se leen de la cache de puntos y nivel de la cuenta,
    // que vive en identidad (base de datos por servicio).
    ranking: (limite) => identidad.rankingPorPuntos(limite),
    estadoDe: (userId) => identidad.cacheDeGamificacion(userId),
    insigniasDe: (userId) => repo.insigniasDe(userId),
    insertarRecompensa: (datos) => repo.insertarRecompensa(datos),
    buscarRecompensa: (id) => repo.buscarRecompensa(id),
    reglasActivas: () => repo.reglasActivas(),
    catalogoPublico: () => repo.catalogoPublico()
};
