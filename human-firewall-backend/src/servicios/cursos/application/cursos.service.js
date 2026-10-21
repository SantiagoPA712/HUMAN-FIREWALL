/**
 * Casos de uso del servicio de cursos.
 *
 * Capa de aplicacion: coordina. Decide que pasos tiene cada caso de uso, en
 * que orden, que va dentro de una transaccion y que evento se publica. El SQL
 * vive en infraestructura/cursos.repositorio.js y el HTTP en api/.
 *
 * Antes toda esta logica estaba dentro de course.controller.js, mezclada con
 * req/res y con 14 consultas escritas a mano.
 */

const db = require('../../../compartido/config/db');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { ErrorHttp } = require('../../../compartido/http/errores');
const entorno = require('../../../compartido/config/entorno');
const repo = require('../infrastructure/persistence/cursos.repositorio');

const ROLES_GESTORES = ['admin', 'instructor'];

// ---------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------

async function crearCurso({ title, description }, instructorId) {
    return repo.insertarCurso({ title, description, instructorId });
}

async function agregarContenido(courseId, { content_type, body, order_idx, points_reward }) {
    return repo.insertarContenido({
        courseId,
        contentType: content_type,
        body,
        orderIdx: order_idx || 0,
        pointsReward: points_reward || 10
    });
}

/** Admin e instructor ven todo el catalogo; el resto, solo lo asignado. */
async function listarVisiblesPara({ id, role }) {
    return ROLES_GESTORES.includes(role) ? repo.listarTodos() : repo.listarAsignadosA(id);
}

async function obtenerDetalle(courseId) {
    const curso = await repo.buscarPorId(courseId);
    if (!curso) throw ErrorHttp.noEncontrado('Curso no encontrado');
    return { ...curso, contents: await repo.listarContenidos(courseId) };
}

// ---------------------------------------------------------------------
// Asignacion
// ---------------------------------------------------------------------

/**
 * Asigna un curso y publica course.assigned en la MISMA transaccion que el
 * INSERT: el evento existe si y solo si la asignacion existe. El correo no se
 * manda aca; lo manda notificaciones al consumir el evento.
 */
async function asignarCurso({ course_id, user_id, due_date }) {
    const fechaLimite = due_date ? new Date(due_date) : null;

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const asignacion = await repo.insertarAsignacion(
            { courseId: course_id, userId: user_id, dueDate: fechaLimite }, client
        );

        await eventBus.publish(EVENTOS.COURSE_ASSIGNED, {
            userId: asignacion.user_id,
            courseId: asignacion.course_id,
            assignmentId: asignacion.id,
            dueDate: fechaLimite ? fechaLimite.toISOString() : null
        }, client);

        await client.query('COMMIT');
        return asignacion;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------
// Progreso
// ---------------------------------------------------------------------

/**
 * Marca una leccion como completada y publica lesson.completed. Si era la
 * ultima del curso, cierra la asignacion y publica course.completed.
 *
 * Los puntos NO se otorgan aca (los otorga gamificacion al consumir el
 * evento), por eso se devuelve puntos_estimados y no puntos_otorgados.
 */
async function completarLeccion(contentId, userId) {
    const contenido = await repo.buscarContenido(contentId);
    if (!contenido) throw ErrorHttp.noEncontrado('Leccion no encontrada');

    const registro = await repo.registrarLeccionCompletada(userId, contentId);
    if (!registro) {
        return {
            nueva: false,
            respuesta: { msg: 'Esta leccion ya estaba completada', ya_completada: true, puntos_estimados: 0 }
        };
    }

    await eventBus.publish(EVENTOS.LESSON_COMPLETED, { userId, contentId });

    const courseId = contenido.course_id;
    let cursoCompletado = false;

    if (await repo.contarLeccionesPendientes(courseId, userId) === 0) {
        // Solo se emite si la asignacion paso a completada en esta llamada,
        // para no disparar el evento cada vez que se reabre el curso.
        if (await repo.cerrarAsignacion(courseId, userId)) {
            cursoCompletado = true;
            await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId, courseId });
        }
    }

    return {
        nueva: true,
        respuesta: {
            curso_completado: cursoCompletado,
            msg: 'Leccion completada',
            ya_completada: false,
            content_id: contentId,
            course_id: courseId,
            puntos_estimados: contenido.points_reward,
            completed_at: registro.completed_at
        }
    };
}

async function obtenerProgreso(courseId, userId) {
    const p = await repo.obtenerProgreso(courseId, userId);
    return {
        course_id: courseId,
        total_lecciones: p.total_lecciones,
        completadas: p.completadas,
        porcentaje: p.total_lecciones > 0 ? Math.round(p.completadas * 100 / p.total_lecciones) : 0,
        ids_completados: p.ids_completados
    };
}

// ---------------------------------------------------------------------
// Fechas limite proximas (proceso de fondo del servicio)
// ---------------------------------------------------------------------
//
// Vivia en notificaciones, pero lo que hace es leer y marcar asignaciones:
// datos de este servicio. Ahora cursos publica course.deadline_approaching y
// notificaciones solo lo consume para mandar el correo. Los nombres de las
// variables de entorno se conservan para no romper ningun .env existente.

const VENTANA_VENCIMIENTO_HORAS = entorno.numero('EMAIL_DEADLINE_WINDOW_HOURS', 48);
const INTERVALO_VENCIMIENTOS_MS = entorno.numero('EMAIL_DEADLINE_SCAN_MINUTES', 15) * 60 * 1000;
let timerVencimientos = null;

/**
 * Publica un course.deadline_approaching por cada asignacion que vence dentro
 * de la ventana. La marca deadline_notified_at se escribe en la MISMA
 * transaccion que el evento: cada asignacion avisa una sola vez.
 *
 * @returns {Promise<number>} cuantos avisos se publicaron
 */
async function buscarVencimientosProximos(ahora = new Date(), maxPorTanda = 100) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const asignaciones = await repo.bloquearAsignacionesPorVencer(
            { desde: ahora, ventanaHoras: VENTANA_VENCIMIENTO_HORAS, limite: maxPorTanda }, client
        );

        for (const a of asignaciones) {
            await eventBus.publish(EVENTOS.COURSE_DEADLINE_APPROACHING, {
                userId: a.user_id,
                courseId: a.course_id,
                assignmentId: a.id,
                dueDate: new Date(a.due_date).toISOString()
            }, client);
        }

        if (asignaciones.length > 0) {
            await repo.marcarVencimientoAvisado(asignaciones.map(a => a.id), client);
        }

        await client.query('COMMIT');
        return asignaciones.length;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function iniciarRelojDeVencimientos() {
    if (timerVencimientos) return;
    timerVencimientos = setInterval(
        () => buscarVencimientosProximos().catch(e => console.error('[cursos] vencimientos:', e.message)),
        INTERVALO_VENCIMIENTOS_MS
    );
    if (timerVencimientos.unref) timerVencimientos.unref();
    console.log(
        `[cursos] vencimientos cada ${INTERVALO_VENCIMIENTOS_MS / 60000} min ` +
        `(ventana ${VENTANA_VENCIMIENTO_HORAS} h)`
    );
}

function detenerRelojDeVencimientos() {
    if (timerVencimientos) { clearInterval(timerVencimientos); timerVencimientos = null; }
}

// ---------------------------------------------------------------------
// Consultas para otros servicios (expuestas por index.js)
// ---------------------------------------------------------------------

/** { id, title, is_critical } de un curso, o null. */
async function obtenerTitulo(courseId) {
    if (!courseId) return null;
    const curso = await repo.buscarPorId(Number(courseId));
    return curso ? { id: curso.id, title: curso.title, is_critical: curso.is_critical === true } : null;
}

async function obtenerTitulos(ids) {
    const unicos = [...new Set(ids.filter(Boolean).map(Number))];
    return repo.titulosDe(unicos);
}

/** { id, course_id, points_reward } de una leccion, o null si no existe. */
async function obtenerLeccion(contentId) {
    return repo.buscarContenido(contentId);
}

async function marcarCritico(courseId, critico) {
    return repo.actualizarCriticidad(courseId, critico);
}

module.exports = {
    VENTANA_VENCIMIENTO_HORAS,
    crearCurso,
    agregarContenido,
    listarVisiblesPara,
    obtenerDetalle,
    asignarCurso,
    completarLeccion,
    obtenerProgreso,
    buscarVencimientosProximos,
    iniciarRelojDeVencimientos,
    detenerRelojDeVencimientos,
    obtenerTitulo,
    obtenerTitulos,
    obtenerLeccion,
    marcarCritico,
    idsDeCursosAsignados: repo.idsDeCursosAsignados,
    contarLeccionesCompletadas: repo.contarLeccionesCompletadas,
    contarCursosCompletados: repo.contarCursosCompletados,
    listarConCriticidad: repo.listarConCriticidad
};
