/** Ficha del servicio de cursos. Ver identidad/manifiesto.js para el formato. */
module.exports = {
    nombre: 'cursos',
    responsabilidad:
        'Catalogo de cursos y lecciones, asignacion de cursos a usuarios, ' +
        'progreso por leccion, cierre del curso al completar la ultima leccion y aviso de ' +
        'fechas limite proximas.',
    prefijos: ['/api/courses'],
    tablas: ['courses', 'course_contents', 'course_assignments', 'lesson_progress'],
    publica: ['course.assigned', 'lesson.completed', 'course.completed', 'course.deadline_approaching'],
    consume: [],
    dependeDe: [],
    lecturasCompartidas: [],
    escriturasCompartidas: [],
    procesos: ['Reloj de fechas limite proximas (publica course.deadline_approaching)']
};
