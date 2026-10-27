/** Cliente del servicio de identidad, visto desde gamificacion. */
const identidad = () => require('../../../identidad/index');

module.exports = {
    /** true si existe una cuenta con ese id. */
    usuarioExiste: (userId) => identidad().usuarioExiste(userId),
    /** Ranking y estado leidos de la cache de la cuenta. */
    rankingPorPuntos: (limite) => identidad().rankingPorPuntos(limite),
    cacheDeGamificacion: (userId) => identidad().cacheDeGamificacion(userId),
    /** La cache de puntos y nivel vive en la cuenta: se actualiza por el contrato. */
    guardarCacheDePuntos: (userId, total) => identidad().guardarCacheDePuntos(userId, total),
    guardarCacheDeNivel: (userId, nivel) => identidad().guardarCacheDeNivel(userId, nivel)
};
