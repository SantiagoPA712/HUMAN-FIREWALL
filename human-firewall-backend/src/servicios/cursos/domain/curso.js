/**
 * Curso (servicio de cursos).
 *
 * Capa Domain (seccion 11 del material): las reglas del curso como funciones
 * puras. crearCurso() cumple el papel de Product.create() del ejemplo: valida
 * los invariantes antes de que nada llegue a la base. No toca la base, ni
 * HTTP, ni otros servicios; la usa application/cursos.service.js.
 */

/** Estados de una asignacion (course_assignments.status). */
const ESTADOS_ASIGNACION = { ASIGNADO: 'assigned', EN_CURSO: 'in_progress', COMPLETADO: 'completed' };

/** Quienes ven todo el catalogo; el resto ve solo lo asignado. */
const ROLES_GESTORES = ['admin', 'instructor'];
const veTodoElCatalogo = (rol) => ROLES_GESTORES.includes(rol);

/**
 * Crea los datos de un curso validando sus invariantes (como Product.create()
 * del material): el titulo es obligatorio y no puede pasar de 255.
 */
function crearCurso({ title, description = null }, instructorId) {
    if (typeof title !== 'string' || !title.trim()) throw new ReglaDeCurso('El titulo es obligatorio', 'title');
    if (title.length > 255) throw new ReglaDeCurso('El titulo no puede superar 255 caracteres', 'title');
    return { title, description: description ?? null, instructorId };
}

/** Fecha limite opcional: vacia o null = sin fecha; texto invalido = error. */
function fechaLimite(dueDate) {
    if (dueDate === undefined || dueDate === null || dueDate === '') return null;
    const fecha = new Date(dueDate);
    if (Number.isNaN(fecha.getTime())) throw new ReglaDeCurso('Debe ser una fecha ISO 8601 valida.', 'due_date');
    return fecha;
}

/** Porcentaje de avance de un curso, redondeado. */
const porcentajeDeAvance = (completadas, total) => (total > 0 ? Math.round(completadas * 100 / total) : 0);

/** El curso termina cuando no queda ninguna leccion pendiente. */
const cursoTerminado = (leccionesPendientes) => leccionesPendientes === 0;

class ReglaDeCurso extends Error {
    constructor(mensaje, campo) {
        super(mensaje);
        this.name = 'ReglaDeCurso';
        this.campo = campo;
    }
}

module.exports = {
    ESTADOS_ASIGNACION,
    ROLES_GESTORES,
    veTodoElCatalogo,
    crearCurso,
    fechaLimite,
    porcentajeDeAvance,
    cursoTerminado,
    ReglaDeCurso
};
