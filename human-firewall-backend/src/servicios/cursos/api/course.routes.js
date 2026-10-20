/**
 * Rutas del servicio de cursos, montadas en /api/courses.
 *
 * Orden de cada cadena: autenticacion -> rol -> validacion del DTO ->
 * controlador. Asi un 401/403 sale antes de mirar el cuerpo, y un 400 sale
 * antes de tocar la base.
 */

const express = require('express');
const router = express.Router();
const controller = require('./course.controller');
const esquemas = require('./esquemas');
const { verifyToken } = require('../../../compartido/middlewares/auth.middleware');
const { validar } = require('../../../compartido/http/validacion');

// Cualquier usuario autenticado: admin e instructor ven todo, el resto lo asignado.
router.get('/', verifyToken(), controller.getCourses);
router.get('/:courseId', verifyToken(), validar(esquemas.porCurso), controller.getCourseDetails);

// Progreso y completado de lecciones.
router.get('/:courseId/progress', verifyToken(), validar(esquemas.porCurso), controller.getCourseProgress);
router.post('/contents/:contentId/complete', verifyToken(), validar(esquemas.porContenido), controller.completeLesson);

// Solo admin o instructor crean cursos y contenido.
router.post('/', verifyToken(['admin', 'instructor']), validar(esquemas.crearCurso), controller.createCourse);
router.post('/:courseId/contents', verifyToken(['admin', 'instructor']), validar(esquemas.agregarContenido), controller.addContent);

// Admin, instructor o RH asignan cursos.
router.post('/assign', verifyToken(['admin', 'instructor', 'rh']), validar(esquemas.asignarCurso), controller.assignCourse);

module.exports = router;
