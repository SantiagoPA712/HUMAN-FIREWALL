/** Cliente del servicio de evaluaciones, visto desde notificaciones. */
const evaluaciones = () => require('../../../evaluaciones');

module.exports = {
    nombreDeDesafio: (quizRef) => evaluaciones().nombreDeDesafio(quizRef),
    tituloDeSimulacion: (id) => evaluaciones().tituloDeSimulacion(id)
};
