/**
 * Notificacion de resultados de evaluaciones y simulaciones.
 *
 * HU: "quiero notificar automaticamente los resultados relevantes (evaluacion
 * aprobada/reprobada, simulacion completada, curso finalizado) tanto al
 * usuario como a RH cuando corresponda".
 *
 * ---------------------------------------------------------------------
 * Este modulo NO evalua nada (criterio tecnico 1)
 * ---------------------------------------------------------------------
 * El puntaje, si aprobo y cuantos aciertos tuvo ya vienen calculados dentro
 * del evento que publica el modulo de origen. Aca solo se arma el texto y se
 * decide a quien le llega.
 *
 * Lo unico que se consulta a la base son ETIQUETAS -- el nombre del desafio,
 * el titulo del curso o de la simulacion -- porque el evento viaja con el id,
 * no con el nombre, y un aviso que diga "reprobaste el 903" no le sirve a
 * nadie. Leer un titulo no es recalcular un resultado.
 *
 * ---------------------------------------------------------------------
 * Por que un servicio aparte y no mas plantillas en notifications.service
 * ---------------------------------------------------------------------
 * Los avisos de bienvenida, nivel y recompensa son de una sola linea: quien
 * hizo la accion recibe el mensaje. Estos tienen tres reglas que aquellos no:
 * destinatarios que dependen de si el curso es critico, canales por persona, y
 * un registro de entrega por canal. Meter todo eso en el servicio generico lo
 * convertiria en el lugar donde vive la logica de negocio de una historia.
 *
 * notifications.service sigue siendo quien habla con la base de avisos y con
 * el servidor de correo; este modulo decide QUE se dice y A QUIEN.
 */

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
const notificationsService = require('./notifications.service');

/** Los dos canales del criterio tecnico 3. */
const CANALES = ['in_app', 'email'];

/** Estados de entrega del criterio tecnico 5. */
const ESTADOS = ['generada', 'entregada', 'fallida', 'leida'];

// ---------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------

/** Nombre legible de un desafio, por su id de texto. */
async function nombreDeDesafio(quizRef) {
    const { rows } = await db.query('SELECT name FROM challenges WHERE id = $1', [String(quizRef)]);
    return rows[0]?.name || `evaluacion ${quizRef}`;
}

async function tituloDeCurso(courseId) {
    if (!courseId) return null;
    const { rows } = await db.query('SELECT title, is_critical FROM courses WHERE id = $1', [courseId]);
    return rows[0] || null;
}

async function tituloDeSimulacion(simulationId) {
    const { rows } = await db.query('SELECT title FROM simulations WHERE id = $1', [simulationId]);
    return rows[0]?.title || `simulacion ${simulationId}`;
}

// ---------------------------------------------------------------------
// Destinatarios (criterio tecnico 2)
// ---------------------------------------------------------------------

/**
 * RH que debe enterarse de lo que hizo este empleado.
 *
 * El enunciado habla del "RH/supervisor asociado", pero en el modelo no existe
 * una relacion de supervision: lo mas cercano es el equipo (users.team_id, de
 * la migracion 025). Asi que le llega a RH del mismo equipo.
 *
 * El respaldo importa: si el equipo del empleado no tiene ningun RH asignado
 * -- que es el estado por defecto, porque la 025 siembra los equipos pero no
 * reparte a la gente -- el aviso iria a la nada. En ese caso va a todos los
 * RH activos, que es preferible a perder una alerta de un curso critico.
 *
 * La resolucion corre entera en el backend: el cliente nunca recibe ni envia
 * la lista de destinatarios (criterio tecnico 2).
 */
async function destinatariosRh(userId) {
    const { rows: delEquipo } = await db.query(
        `SELECT rh.id
           FROM users empleado
           JOIN users rh ON rh.team_id = empleado.team_id
          WHERE empleado.id = $1
            AND empleado.team_id IS NOT NULL
            AND rh.role = 'rh'
            AND rh.is_active = true
            AND rh.id <> empleado.id`,
        [userId]
    );

    if (delEquipo.length > 0) return delEquipo.map(r => r.id);

    const { rows: todos } = await db.query(
        `SELECT id FROM users WHERE role = 'rh' AND is_active = true AND id <> $1`,
        [userId]
    );
    return todos.map(r => r.id);
}

// ---------------------------------------------------------------------
// Canales (criterio tecnico 3)
// ---------------------------------------------------------------------

/**
 * Canales habilitados de un destinatario.
 *
 * Sin fila en notification_preferences el canal esta habilitado: la tabla
 * guarda lo que alguien cambio, no el estado de todo el padron.
 */
async function canalesDe(userId) {
    const { rows } = await db.query(
        'SELECT channel, enabled FROM notification_preferences WHERE user_id = $1',
        [userId]
    );

    const canales = { in_app: true, email: true };
    for (const r of rows) canales[r.channel] = r.enabled;
    return canales;
}

/** Preferencias de un usuario, con los valores por defecto ya resueltos. */
async function obtenerPreferencias(userId) {
    const canales = await canalesDe(userId);
    return {
        user_id: userId,
        canales,
        nota: 'Sin configuracion previa, ambos canales estan habilitados.'
    };
}

/**
 * Cambia los canales de un usuario. Solo escribe los que vinieron.
 *
 * @param {object} cambios  { in_app?: boolean, email?: boolean }
 */
async function actualizarPreferencias(userId, cambios = {}) {
    const errores = [];

    for (const canal of CANALES) {
        if (cambios[canal] === undefined) continue;
        if (typeof cambios[canal] !== 'boolean') {
            errores.push({ campo: canal, detalle: 'Debe ser true o false.' });
        }
    }

    if (errores.length > 0) {
        const error = new Error('Preferencias invalidas');
        error.errores = errores;
        error.codigo = 400;
        throw error;
    }

    for (const canal of CANALES) {
        if (cambios[canal] === undefined) continue;
        await db.query(
            `INSERT INTO notification_preferences (user_id, channel, enabled)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, channel)
             DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
            [userId, canal, cambios[canal]]
        );
    }

    return obtenerPreferencias(userId);
}

// ---------------------------------------------------------------------
// Cursos criticos (criterio de aceptacion 2)
// ---------------------------------------------------------------------

async function listarCursos() {
    const { rows } = await db.query(
        'SELECT id, title, is_critical FROM courses ORDER BY title'
    );
    return rows;
}

async function marcarCursoCritico(courseId, critico) {
    const { rows } = await db.query(
        'UPDATE courses SET is_critical = $2 WHERE id = $1 RETURNING id, title, is_critical',
        [courseId, critico]
    );
    return rows[0] || null;
}

// ---------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------
//
// Cada una recibe el payload YA CALCULADO por el modulo de origen y devuelve
// el aviso. Ninguna vuelve a decidir si el intento se aprobo: eso viene dado.

/**
 * Arma el aviso del dueno del resultado.
 *
 * @returns {Promise<{title, body, payload, dedupeKey, courseId, aprobado} | null>}
 */
async function avisoDelDueno(evento, p) {
    if (evento === EVENTOS.QUIZ_APPROVED) {
        const nombre = await nombreDeDesafio(p.quizRef);
        return {
            title: `Aprobaste: ${nombre}`,
            body: `Superaste "${nombre}" con ${p.score} puntos de puntaje. ` +
                  `Los puntos ya quedaron sumados a tu historial.`,
            payload: { resultado: 'aprobado', quizRef: p.quizRef, score: p.score },
            clave: `quiz.approved:${p.userId}:${p.quizRef}`,
            courseId: null,
            aprobado: true
        };
    }

    if (evento === EVENTOS.QUIZ_FAILED) {
        const nombre = await nombreDeDesafio(p.quizRef);
        // Criterio de aceptacion 1: "si reprobe, debo ver tambien las opciones
        // disponibles para reintentar".
        return {
            title: `No superaste: ${nombre}`,
            body: `Obtuviste ${p.score} de puntaje en "${nombre}" (intento ${p.attemptNo}).\n` +
                  `Podes reintentarlo cuando quieras desde Desafios y Retos: /challenges\n` +
                  `Si preferis reforzar antes, en Mi Desempeno tenes las lecciones sugeridas: /performance`,
            payload: {
                resultado: 'reprobado',
                quizRef: p.quizRef,
                score: p.score,
                intento: p.attemptNo,
                reintentar_en: '/challenges',
                reforzar_en: '/performance'
            },
            clave: `quiz.failed:${p.userId}:${p.quizRef}:${p.attemptNo}`,
            courseId: p.courseId || null,
            aprobado: false
        };
    }

    if (evento === EVENTOS.COURSE_COMPLETED) {
        const curso = await tituloDeCurso(p.courseId);
        return {
            title: `Completaste el curso: ${curso?.title || p.courseId}`,
            body: `Terminaste todas las lecciones de "${curso?.title || p.courseId}". ` +
                  `Podes ver tu avance en Mi Desempeno: /performance`,
            payload: { resultado: 'curso_completado', courseId: p.courseId },
            clave: `course.completed:${p.userId}:${p.courseId}`,
            courseId: p.courseId,
            aprobado: true
        };
    }

    if (evento === EVENTOS.SIMULATION_COMPLETED) {
        const titulo = await tituloDeSimulacion(p.simulationId);

        if (p.aprobada) {
            return {
                title: `Completaste la simulacion: ${titulo}`,
                body: `Terminaste "${titulo}" con ${p.score}% (${p.aciertos} de ${p.pasos} decisiones correctas).`,
                payload: {
                    resultado: 'aprobada', simulationId: p.simulationId,
                    score: p.score, aciertos: p.aciertos, pasos: p.pasos
                },
                clave: `simulation.completed:${p.userId}:${p.simulationId}:${p.attemptNo}`,
                courseId: p.courseId || null,
                aprobado: true
            };
        }

        return {
            title: `No superaste la simulacion: ${titulo}`,
            body: `Terminaste "${titulo}" con ${p.score}% (${p.aciertos} de ${p.pasos} decisiones correctas).\n` +
                  `Podes volver a intentarla desde la simulacion: /simulation/play/${p.simulationId}\n` +
                  `En Mi Desempeno tenes las lecciones de refuerzo relacionadas: /performance`,
            payload: {
                resultado: 'reprobada', simulationId: p.simulationId,
                score: p.score, aciertos: p.aciertos, pasos: p.pasos,
                reintentar_en: `/simulation/play/${p.simulationId}`,
                reforzar_en: '/performance'
            },
            clave: `simulation.completed:${p.userId}:${p.simulationId}:${p.attemptNo}`,
            courseId: p.courseId || null,
            aprobado: false
        };
    }

    return null;
}

/** Aviso para RH sobre lo que hizo alguien de su equipo. */
async function avisoParaRh(aviso, empleado, curso) {
    const detalle = aviso.aprobado ? 'completo' : 'no supero';

    return {
        title: `Curso critico: ${empleado.email} ${detalle} "${curso.title}"`,
        body: `${empleado.email} ${detalle} contenido del curso critico "${curso.title}".\n` +
              `Detalle del resultado: ${aviso.title}\n` +
              `Podes ver su desempeno completo en el reporte de RH: /reports`,
        // El payload se arma campo por campo y NO se copia el del empleado.
        //
        // Ese trae `reintentar_en` y `reforzar_en`, que son acciones del dueno
        // del resultado: la pantalla las pinta como botones, y a RH le
        // aparecian un "Reintentar" y un "Ver refuerzos" que no puede usar
        // -- no va a rehacer el desafio de otra persona.
        payload: {
            resultado: aviso.payload?.resultado,
            score: aviso.payload?.score,
            empleado_id: empleado.id,
            empleado_email: empleado.email,
            curso_id: curso.id,
            curso_critico: true,
            ver_desempeno_en: '/reports'
        },
        clave: `${aviso.clave}:rh`
    };
}

// ---------------------------------------------------------------------
// Entrega (criterios tecnicos 3, 4 y 5)
// ---------------------------------------------------------------------

/**
 * Registra el estado de una entrega por canal.
 *
 * ON CONFLICT DO NOTHING sobre (notification_id, channel): si el bus reprocesa
 * el evento, la entrega no se duplica ni se pisa la fecha original.
 */
async function registrarEntrega(notificationId, canal, estado, error = null) {
    const columnaFecha = {
        generada:  'generated_at',
        entregada: 'delivered_at',
        fallida:   'failed_at',
        leida:     'read_at'
    }[estado];

    const { rows } = await db.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status, error, ${columnaFecha})
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (notification_id, channel) DO NOTHING
         RETURNING id, channel, status`,
        [notificationId, canal, estado, error]
    );

    return rows[0] || null;
}

/**
 * Entrega un aviso a una persona por los canales que tenga habilitados.
 *
 * El aviso se guarda una sola vez (es el registro del hecho); los canales
 * deciden por donde sale y quedan registrados uno por uno.
 *
 * @returns {Promise<object|null>} la notificacion creada, o null si ya existia
 */
async function entregar(eventName, aviso, userId) {
    const canales = await canalesDe(userId);

    const notificacion = await notificationsService.crearSinEnviar(
        eventName,
        { title: aviso.title, body: aviso.body, payload: aviso.payload, dedupeKey: `res:${aviso.clave}:${userId}` },
        userId
    );

    // Criterio tecnico 4: el mismo evento reprocesado no genera una segunda
    // notificacion. La clave de deduplicacion identifica el HECHO (evento +
    // referencia + intento + destinatario), no el intento de procesarlo.
    if (!notificacion) return null;

    // In-app: guardar el aviso ES entregarlo, asi que los dos instantes
    // coinciden y se registra directamente como entregada.
    if (canales.in_app) {
        await registrarEntrega(notificacion.id, 'in_app', 'entregada');
    }

    if (canales.email) {
        // reenviarCorreo hace el envio sobre el aviso ya creado y devuelve como
        // termino: 'sent', 'failed' o 'skipped' (sin SMTP configurado, que es
        // el modo por defecto del proyecto).
        const resultado = await notificationsService.reenviarCorreo({ id: notificacion.id });

        if (resultado === 'sent') {
            await registrarEntrega(notificacion.id, 'email', 'entregada');
        } else if (resultado === 'failed') {
            await registrarEntrega(notificacion.id, 'email', 'fallida', 'el envio por correo fallo');
        } else {
            // Sin transporte configurado no hubo entrega ni fallo: queda
            // generada, que es exactamente lo que paso.
            await registrarEntrega(notificacion.id, 'email', 'generada');
        }
    }

    return notificacion;
}

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

/**
 * Consume un evento de resultado y genera los avisos que correspondan.
 *
 * @returns {Promise<{dueno: object|null, rh: number}>}
 */
async function manejar(evento, payload) {
    if (!payload || !payload.userId) return { dueno: null, rh: 0 };

    const aviso = await avisoDelDueno(evento, payload);
    if (!aviso) return { dueno: null, rh: 0 };

    // Criterio de aceptacion 1: el dueno del resultado siempre se entera.
    const dueno = await entregar(evento, aviso, payload.userId);

    // Criterio de aceptacion 2 / tecnico 2: RH solo entra si el curso esta
    // marcado como critico.
    const curso = await tituloDeCurso(aviso.courseId);
    if (!curso || !curso.is_critical) return { dueno, rh: 0 };

    const { rows: empleados } = await db.query(
        'SELECT id, email FROM users WHERE id = $1', [payload.userId]
    );
    const empleado = empleados[0];
    if (!empleado) return { dueno, rh: 0 };

    const rhs = await destinatariosRh(payload.userId);
    const avisoRh = await avisoParaRh(aviso, empleado, { ...curso, id: aviso.courseId });

    let entregados = 0;
    for (const rhId of rhs) {
        const creada = await entregar(evento, avisoRh, rhId);
        if (creada) entregados++;
    }

    if (entregados > 0) {
        console.log(
            `[resultados] curso critico "${curso.title}": aviso a ${entregados} RH ` +
            `por el resultado de ${empleado.email}`
        );
    }

    return { dueno, rh: entregados };
}

// ---------------------------------------------------------------------
// Centro de notificaciones (criterio de aceptacion 3)
// ---------------------------------------------------------------------

/** Eventos que esta historia notifica. */
const EVENTOS_DE_RESULTADO = [
    EVENTOS.QUIZ_APPROVED,
    EVENTOS.QUIZ_FAILED,
    EVENTOS.COURSE_COMPLETED,
    EVENTOS.SIMULATION_COMPLETED
];

/**
 * Listado cronologico de los resultados notificados a un usuario, con el
 * estado de cada canal.
 *
 * Se lee de la bandeja general pero acotado a los eventos de resultado, y se
 * le agrega el detalle por canal que vive en notification_deliveries: el
 * criterio 3 pide que el estado de lectura se gestione de forma independiente
 * por canal, y eso no cabe en la columna read_at del aviso.
 */
async function obtenerCentro(userId, { soloNoLeidas = false, limit = 50 } = {}) {
    const { rows } = await db.query(
        `SELECT n.id, n.event_name, n.title, n.body, n.payload, n.read_at, n.created_at,
                COALESCE(
                    json_agg(
                        json_build_object('canal', d.channel, 'estado', d.status,
                                          'entregada_en', d.delivered_at, 'leida_en', d.read_at)
                        ORDER BY d.channel
                    ) FILTER (WHERE d.id IS NOT NULL),
                    '[]'
                ) AS canales
           FROM notifications n
           LEFT JOIN notification_deliveries d ON d.notification_id = n.id
          WHERE n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND ($3::boolean = false OR n.read_at IS NULL)
          GROUP BY n.id
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT $4`,
        [userId, EVENTOS_DE_RESULTADO, soloNoLeidas, limit]
    );

    const { rows: [contador] } = await db.query(
        `SELECT COUNT(*)::int AS no_leidas
           FROM notifications
          WHERE user_id = $1 AND event_name = ANY($2::text[]) AND read_at IS NULL`,
        [userId, EVENTOS_DE_RESULTADO]
    );

    return {
        user_id: userId,
        no_leidas: contador.no_leidas,
        resultados: rows
    };
}

/**
 * Marca como leidas todas las notificaciones del usuario (criterio de
 * aceptacion 3: "debo poder marcar todas como leidas de una vez").
 *
 * Marca la bandeja entera, no solo los resultados: un boton que dice "marcar
 * todas" y deja algunas sin marcar miente.
 *
 * El estado por canal se actualiza tambien, que es lo que pide el criterio 3.
 */
async function marcarTodasLeidas(userId) {
    const { rows } = await db.query(
        `UPDATE notifications
            SET read_at = now()
          WHERE user_id = $1 AND read_at IS NULL
          RETURNING id`,
        [userId]
    );

    const ids = rows.map(r => r.id);

    if (ids.length > 0) {
        await db.query(
            `UPDATE notification_deliveries
                SET status = 'leida', read_at = now()
              WHERE notification_id = ANY($1::bigint[])
                AND channel = 'in_app'
                AND status <> 'leida'`,
            [ids]
        );
    }

    return { marcadas: ids.length };
}

/** Conecta el servicio al bus. */
function registrarHandlers() {
    for (const evento of EVENTOS_DE_RESULTADO) {
        eventBus.subscribe(evento, payload => manejar(evento, payload));
    }
    console.log('[resultNotifications.service] handlers registrados');
}

module.exports = {
    CANALES,
    ESTADOS,
    EVENTOS_DE_RESULTADO,
    destinatariosRh,
    canalesDe,
    obtenerPreferencias,
    actualizarPreferencias,
    listarCursos,
    marcarCursoCritico,
    avisoDelDueno,
    registrarEntrega,
    entregar,
    manejar,
    obtenerCentro,
    marcarTodasLeidas,
    registrarHandlers
};
