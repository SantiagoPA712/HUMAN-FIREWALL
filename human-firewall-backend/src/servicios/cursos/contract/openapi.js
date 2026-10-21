/**
 * Contrato publico (OpenAPI) del servicio de cursos.
 * Ver servicios/identidad/contract/openapi.js para el formato.
 */

const { operacion } = require('../../../compartido/contratos/operacion');
const { ref } = require('../../../compartido/contratos/esquemas-comunes');
const esquemas = require('../controller/dto');

const fecha = { type: 'string', format: 'date-time' };
const fechaONull = { type: ['string', 'null'], format: 'date-time' };

const schemas = {
    Curso: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            instructor_id: { type: ['integer', 'null'] },
            created_at: fecha,
            is_critical: { type: 'boolean', description: 'Si sus resultados se le avisan a RH' },
            status: { type: 'string', description: 'Solo en el listado de un empleado: estado de su asignacion' }
        }
    },
    Leccion: {
        type: 'object',
        required: ['id', 'course_id', 'content_type', 'body'],
        properties: {
            id: { type: 'integer' },
            course_id: { type: 'integer' },
            content_type: { type: 'string' },
            body: { type: 'string' },
            order_idx: { type: 'integer' },
            points_reward: { type: ['integer', 'null'] }
        }
    },
    CursoDetalle: {
        allOf: [
            ref('Curso'),
            { type: 'object', required: ['contents'], properties: { contents: { type: 'array', items: ref('Leccion') } } }
        ]
    },
    Asignacion: {
        type: 'object',
        required: ['id', 'course_id', 'user_id', 'status'],
        properties: {
            id: { type: 'integer' },
            course_id: { type: 'integer' },
            user_id: { type: 'integer' },
            status: { type: 'string', enum: ['assigned', 'in_progress', 'completed'] },
            assigned_at: fecha,
            completed_at: fechaONull,
            due_date: fechaONull,
            deadline_notified_at: fechaONull
        }
    },
    LeccionCompletada: {
        type: 'object',
        required: ['msg', 'ya_completada', 'puntos_estimados'],
        properties: {
            msg: { type: 'string' },
            ya_completada: { type: 'boolean' },
            puntos_estimados: {
                type: 'integer',
                description: 'Lo que se espera otorgar. Los puntos reales los asigna gamificacion al consumir lesson.completed.'
            },
            curso_completado: { type: 'boolean' },
            content_id: { type: 'integer' },
            course_id: { type: 'integer' },
            completed_at: fecha
        }
    },
    ProgresoDeCurso: {
        type: 'object',
        required: ['course_id', 'total_lecciones', 'completadas', 'porcentaje', 'ids_completados'],
        properties: {
            course_id: { type: 'integer' },
            total_lecciones: { type: 'integer' },
            completadas: { type: 'integer' },
            porcentaje: { type: 'integer', minimum: 0, maximum: 100 },
            ids_completados: { type: 'array', items: { type: 'integer' } }
        }
    }
};

const paths = {
    '/api/courses': {
        get: operacion({
            resumen: 'Cursos visibles para el usuario',
            descripcion: 'admin e instructor ven todo el catalogo; el resto, solo sus cursos asignados (con su status).',
            acceso: 'autenticado',
            respuestas: { 200: { descripcion: 'Cursos', esquema: { type: 'array', items: ref('Curso') } } }
        }),
        post: operacion({
            resumen: 'Crear un curso',
            acceso: ['admin', 'instructor'],
            dto: esquemas.crearCurso,
            respuestas: { 201: { descripcion: 'Curso creado', esquema: ref('Curso') } }
        })
    },
    '/api/courses/{courseId}': {
        get: operacion({
            resumen: 'Detalle de un curso con sus lecciones',
            acceso: 'autenticado',
            dto: esquemas.porCurso,
            respuestas: { 200: { descripcion: 'Curso y lecciones en orden', esquema: ref('CursoDetalle') } },
            errores: [404]
        })
    },
    '/api/courses/{courseId}/progress': {
        get: operacion({
            resumen: 'Progreso del usuario autenticado en un curso',
            acceso: 'autenticado',
            dto: esquemas.porCurso,
            respuestas: { 200: { descripcion: 'Lecciones completadas', esquema: ref('ProgresoDeCurso') } }
        })
    },
    '/api/courses/{courseId}/contents': {
        post: operacion({
            resumen: 'Agregar una leccion a un curso',
            acceso: ['admin', 'instructor'],
            dto: esquemas.agregarContenido,
            respuestas: { 201: { descripcion: 'Leccion creada', esquema: ref('Leccion') } }
        })
    },
    '/api/courses/contents/{contentId}/complete': {
        post: operacion({
            resumen: 'Marcar una leccion como completada',
            descripcion:
                'Publica lesson.completed y, si era la ultima del curso, course.completed. ' +
                'Responde 201 la primera vez y 200 si ya estaba completada (no vuelve a publicar).',
            acceso: 'autenticado',
            dto: esquemas.porContenido,
            respuestas: {
                201: { descripcion: 'Leccion completada ahora', esquema: ref('LeccionCompletada') },
                200: { descripcion: 'La leccion ya estaba completada', esquema: ref('LeccionCompletada') }
            },
            errores: [404]
        })
    },
    '/api/courses/assign': {
        post: operacion({
            resumen: 'Asignar un curso a un usuario',
            descripcion:
                'Publica course.assigned en la misma transaccion. El correo lo manda notificaciones ' +
                'despues, por la cola: si el SMTP esta caido, asignar sigue funcionando.',
            acceso: ['admin', 'instructor', 'rh'],
            dto: esquemas.asignarCurso,
            respuestas: { 201: { descripcion: 'Asignacion creada', esquema: ref('Asignacion') } }
        })
    }
};

module.exports = { paths, schemas };
