/**
 * Controlador HTTP de simulaciones.
 *
 * Capa de presentacion: sin SQL y sin reglas. El calculo del puntaje esta en
 * dominio/puntaje.js y la coordinacion en aplicacion/simulaciones.service.js.
 */

const simulaciones = require('../aplicacion/simulaciones.service');
const { responderError, ErrorHttp } = require('../../../compartido/http/errores');

/** GET /api/simulations — las que el usuario puede jugar (RN-01). */
exports.listSimulations = async (req, res) => {
    try {
        res.status(200).json(await simulaciones.listarDisponibles(req.user));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.createSimulation = async (req, res) => {
    try {
        res.status(201).json(await simulaciones.crearSimulacion(req.body || {}, req.user.id));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.addStep = async (req, res) => {
    try {
        res.status(201).json(await simulaciones.agregarPaso(req.params.simulationId, req.body || {}));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.addOption = async (req, res) => {
    try {
        res.status(201).json(await simulaciones.agregarOpcion(req.params.stepId, req.body || {}));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.getSimulationDetails = async (req, res) => {
    try {
        res.status(200).json(await simulaciones.obtenerDetalle(req.params.simulationId));
    } catch (error) {
        responderError(req, res, error);
    }
};

/** POST /api/simulations/submit-decision — responde puntos_estimados, no otorgados. */
exports.submitDecision = async (req, res) => {
    try {
        const { optionId } = req.body || {};
        if (!optionId) throw ErrorHttp.validacion([{ campo: 'optionId', detalle: 'Es obligatorio.' }], 'optionId es obligatorio');
        res.status(200).json(await simulaciones.registrarDecision(optionId, req.user.id));
    } catch (error) {
        responderError(req, res, error);
    }
};

/** POST /api/simulations/:simulationId/complete — el puntaje se calcula en el servidor. */
exports.completeSimulation = async (req, res) => {
    try {
        const simulationId = Number.parseInt(req.params.simulationId, 10);
        const { decisiones } = req.body || {};
        if (!Array.isArray(decisiones) || decisiones.length === 0) {
            throw ErrorHttp.validacion(
                [{ campo: 'decisiones', detalle: 'Debe ser un arreglo con al menos una opcion.' }],
                'decisiones debe ser un arreglo con las opciones elegidas'
            );
        }
        res.status(200).json(await simulaciones.completar(simulationId, req.user.id, decisiones));
    } catch (error) {
        responderError(req, res, error);
    }
};
