/**
 * Controlador HTTP de cursos.
 *
 * Capa de presentacion: traduce HTTP a una llamada de la capa de aplicacion
 * y el resultado (o el error) a una respuesta. No escribe SQL ni decide
 * reglas; antes este archivo tenia 14 consultas, ahora no importa la base.
 *
 * La validacion de forma (campos obligatorios, tipos) ya ocurrio en el
 * middleware validar() de la ruta. Ver api/esquemas.js.
 */

const cursos = require('../aplicacion/cursos.service');
const { responderError, ErrorHttp } = require('../../../compartido/http/errores');

exports.createCourse = async (req, res) => {
    try {
        res.status(201).json(await cursos.crearCurso(req.body || {}, req.user.id));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.addContent = async (req, res) => {
    try {
        res.status(201).json(await cursos.agregarContenido(req.params.courseId, req.body || {}));
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * POST /api/courses/assign   Body: { course_id, user_id, due_date? }
 *
 * Publica course.assigned en la misma transaccion que la asignacion. El
 * correo NO sale aca: si el SMTP esta caido, asignar sigue funcionando.
 */
exports.assignCourse = async (req, res) => {
    try {
        const { due_date } = req.body || {};
        if (due_date !== undefined && due_date !== null && due_date !== ''
            && Number.isNaN(new Date(due_date).getTime())) {
            throw ErrorHttp.validacion([{ campo: 'due_date', detalle: 'Debe ser una fecha ISO 8601 valida.' }]);
        }
        res.status(201).json(await cursos.asignarCurso(req.body || {}));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.getCourses = async (req, res) => {
    try {
        res.status(200).json(await cursos.listarVisiblesPara(req.user));
    } catch (error) {
        responderError(req, res, error);
    }
};

exports.getCourseDetails = async (req, res) => {
    try {
        res.status(200).json(await cursos.obtenerDetalle(req.params.courseId));
    } catch (error) {
        responderError(req, res, error);
    }
};

/**
 * POST /api/courses/contents/:contentId/complete
 * 201 si la leccion se completo ahora; 200 si ya estaba completada.
 */
exports.completeLesson = async (req, res) => {
    try {
        const contentId = Number.parseInt(req.params.contentId, 10);
        if (!Number.isInteger(contentId) || contentId <= 0) {
            throw ErrorHttp.validacion([{ campo: 'contentId', detalle: 'Debe ser un entero positivo.' }], 'contentId invalido');
        }
        const { nueva, respuesta } = await cursos.completarLeccion(contentId, req.user.id);
        res.status(nueva ? 201 : 200).json(respuesta);
    } catch (error) {
        responderError(req, res, error);
    }
};

/** GET /api/courses/:courseId/progress — progreso del usuario autenticado. */
exports.getCourseProgress = async (req, res) => {
    try {
        const courseId = Number.parseInt(req.params.courseId, 10);
        res.status(200).json(await cursos.obtenerProgreso(courseId, req.user.id));
    } catch (error) {
        responderError(req, res, error);
    }
};
