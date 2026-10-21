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
    ranking: (limite) => repo.ranking(limite),
    estadoDe: (userId) => repo.estadoDe(userId),
    insigniasDe: (userId) => repo.insigniasDe(userId),
    insertarRecompensa: (datos) => repo.insertarRecompensa(datos),
    buscarRecompensa: (id) => repo.buscarRecompensa(id),
    reglasActivas: () => repo.reglasActivas(),
    catalogoPublico: () => repo.catalogoPublico()
};
