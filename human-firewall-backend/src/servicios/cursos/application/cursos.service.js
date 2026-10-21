/**
 * Casos de uso del servicio de cursos.
 *
 * Capa Application / Service: coordina. Decide que pasos tiene cada caso de
 * uso, en que orden, que va dentro de una transaccion y que evento se
 * publica. Las reglas estan en domain/curso.js, el SQL en
 * infrastructure/persistence/cursos.repositorio.js y el HTTP en controller/.
 */

const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const { ErrorHttp } = require('../../../compartido/http/errores');
const { conTransaccion } = require('../../../compartido/config/transaccion');
const config = require('../config/configuracion');
const curso = require('../domain/curso');
const repo = require('../infrastructure/persistence/cursos.repositorio');

/** Convierte una regla de dominio rota en un 400 con el campo. */
function enDominio(fn) {
    try {
        return fn();
    } catch (e) {
        if (e instanceof curso.ReglaDeCurso) {
            throw ErrorHttp.validacion([{ campo: e.campo, detalle: e.message }], e.message);
        }
        throw e;
    }
}

// ---------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------

async function crearCurso(datos, instructorId) {
    return repo.insertarCurso(enDominio(() => curso.crearCurso(datos, instructorId)));
}

async function agregarContenido(courseId, { content_type, body, order_idx, points_reward }) {
    return repo.insertarContenido({
        courseId,
        contentType: content_type,
        body,
        orderIdx: order_idx || 0,
        pointsReward: points_reward || config.puntosPorDefectoDeLeccion
    });
}

/** Admin e instructor ven todo el catalogo; el resto, solo lo asignado. */
async function listarVisiblesPara({ id, role }) {
    return curso.veTodoElCatalogo(role) ? repo.listarTodos() : repo.listarAsignadosA(id);
}

async function obtenerDetalle(courseId) {
    const encontrado = await repo.buscarPorId(courseId);
    if (!encontrado) throw ErrorHttp.noEncontrado('Curso no encontrado');
    return { ...encontrado, contents: await repo.listarContenidos(courseId) };
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
    const limite = enDominio(() => curso.fechaLimite(due_date));

    return conTransaccion(async (tx) => {
        const asignacion = await repo.insertarAsignacion(
            { courseId: course_id, userId: user_id, dueDate: limite }, tx
        );

        await eventBus.publish(EVENTOS.COURSE_ASSIGNED, {
            userId: asignacion.user_id,
            courseId: asignacion.course_id,
            assignmentId: asignacion.id,
            dueDate: limite ? limite.toISOString() : null
        }, tx);

        return asignacion;
    });
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

    if (curso.cursoTerminado(await repo.contarLeccionesPendientes(courseId, userId))) {
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
        porcentaje: curso.porcentajeDeAvance(p.completadas, p.total_lecciones),
        ids_completados: p.ids_completados
    };
}

// ---------------------------------------------------------------------
// Fechas limite proximas (proceso de fondo del servicio)
// ---------------------------------------------------------------------
//
// Cursos es el dueno de las asignaciones: publica course.deadline_approaching
// y notificaciones solo lo consume para mandar el correo.

let timerVencimientos = null;

/**
 * Publica un course.deadline_approaching por cada asignacion que vence dentro
 * de la ventana. La marca deadline_notified_at se escribe en la MISMA
 * transaccion que el evento: cada asignacion avisa una sola vez.
 *
 * @returns {Promise<number>} cuantos avisos se publicaron
 */
async function buscarVencimientosProximos(ahora = new Date(), maxPorTanda = 100) {
    return conTransaccion(async (tx) => {
        const asignaciones = await repo.bloquearAsignacionesPorVencer(
            { desde: ahora, ventanaHoras: config.horasDeVentanaVencimiento, limite: maxPorTanda }, tx
        );

        for (const a of asignaciones) {
            await eventBus.publish(EVENTOS.COURSE_DEADLINE_APPROACHING, {
                userId: a.user_id,
                courseId: a.course_id,
                assignmentId: a.id,
                dueDate: new Date(a.due_date).toISOString()
            }, tx);
        }

        if (asignaciones.length > 0) {
            await repo.marcarVencimientoAvisado(asignaciones.map(a => a.id), tx);
        }
        return asignaciones.length;
    });
}

function iniciarRelojDeVencimientos() {
    if (timerVencimientos) return;
    const minutos = config.minutosEntreBusquedasDeVencimiento;
    timerVencimientos = setInterval(
        () => buscarVencimientosProximos().catch(e => console.error('[cursos] vencimientos:', e.message)),
        minutos * 60 * 1000
    );
    if (timerVencimientos.unref) timerVencimientos.unref();
    console.log(`[cursos] vencimientos cada ${minutos} min (ventana ${config.horasDeVentanaVencimiento} h)`);
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
    const encontrado = await repo.buscarPorId(Number(courseId));
    return encontrado ? { id: encontrado.id, title: encontrado.title, is_critical: encontrado.is_critical === true } : null;
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
    idsDeCursosAsignados: (userId) => repo.idsDeCursosAsignados(userId),
    contarLeccionesCompletadas: (userId) => repo.contarLeccionesCompletadas(userId),
    contarCursosCompletados: (userId) => repo.contarCursosCompletados(userId),
    listarConCriticidad: () => repo.listarConCriticidad()
};
