const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Empleados, admin e instructor pueden ver sus cursos
router.get('/', verifyToken(), courseController.getCourses);
router.get('/:courseId', verifyToken(), courseController.getCourseDetails);

// Progreso y completado de lecciones (HU: asignación automática de puntos)
router.get('/:courseId/progress', verifyToken(), courseController.getCourseProgress);
router.post('/contents/:contentId/complete', verifyToken(), courseController.completeLesson);

// Solo Admin o Instructor pueden crear cursos y contenido
router.post('/', verifyToken(['admin', 'instructor']), courseController.createCourse);
router.post('/:courseId/contents', verifyToken(['admin', 'instructor']), courseController.addContent);

// RH o Admin pueden asignar cursos
router.post('/assign', verifyToken(['admin', 'instructor', 'rh']), courseController.assignCourse);

module.exports = router;
