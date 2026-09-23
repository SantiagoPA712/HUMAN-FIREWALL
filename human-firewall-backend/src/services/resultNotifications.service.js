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
const emailNotifications = require('./emailNotifications.service');

/** Los dos canales del criterio tecnico 3. */
const CANALES = ['in_app', 'email'];

/** Estados de entrega del criterio tecnico 5. */
const ESTADOS = ['generada', 'entregada', 'fallida', 'leida'];

/** Largo de notifications.title (migracion 009). */
const LARGO_TITULO = 150;

/**
 * Recorta un titulo para que entre en notifications.title.
 *
 * FALLO CORREGIDO: los titulos se armaban interpolando datos sin acotar.
 * `courses.title` admite 255 caracteres y `users.email` otros 255, contra los
 * 150 de `notifications.title`. Un curso con un titulo largo pero
 * perfectamente valido hacia fallar el INSERT, y entonces el usuario no se
 * enteraba de su resultado: el evento agotaba sus cinco reintentos y moria.
 *
 * Se recorta el titulo y no se amplia la columna porque la columna es de la
 * migracion 009, ya mergeada, y el titulo es un resumen: el dato completo
 * viaja en el cuerpo, que es TEXT y no tiene limite.
 */
function recortarTitulo(texto) {
    const t = String(texto);
    return t.length <= LARGO_TITULO ? t : `${t.slice(0, LARGO_TITULO - 1)}…`;
}

/**
 * Parte de la clave de deduplicacion que identifica UN intento.
 *
 * Prefiere `attemptId` -- el id de la fila de quiz_attempts, que asigna la
 * secuencia de la tabla y por lo tanto es unico aunque dos envios entren a la
 * vez. `attemptNo` solo se usa como respaldo, para un productor que todavia no
 * mande el id: sale de un COUNT(*) sin lock y puede repetirse.
 *
 * Los prefijos 'i' y 'n' evitan que las dos formas colisionen entre si.
 */
function claveDeIntento(p) {
    return p.attemptId != null ? `i${p.attemptId}` : `n${p.attemptNo}`;
}

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
 * Datos del correo de un resultado (HU de notificaciones por correo).
 *
 * Aca NO se arma el correo: solo se dice que tipo es y que datos lleva. El
 * asunto, el HTML y el idioma los pone la plantilla de emailNotifications
 * (criterio tecnico 2 de esa HU: ningun modulo de negocio construye HTML).
 */
function datosDeCorreo(evaluacion, puntaje, aprobado, ruta) {
    return {
        tipo: emailNotifications.TIPOS.EVALUATION_RESULT,
        datos: { evaluacion, puntaje: puntaje ?? null, aprobado, ruta }
    };
}

/**
 * Arma el aviso del dueno del resultado.
 *
 * @returns {Promise<{title, body, payload, dedupeKey, courseId, aprobado} | null>}
 */
async function avisoDelDueno(evento, p) {
    if (evento === EVENTOS.QUIZ_APPROVED) {
        const nombre = await nombreDeDesafio(p.quizRef);
        return {
            title: recortarTitulo(`Aprobaste: ${nombre}`),
            body: `Superaste "${nombre}" con ${p.score} puntos de puntaje. ` +
                  `Los puntos ya quedaron sumados a tu historial.`,
            payload: { resultado: 'aprobado', quizRef: p.quizRef, score: p.score },
            clave: `quiz.approved:${p.userId}:${p.quizRef}`,
            // El curso viene del evento: si esta marcado como critico, RH
            // recibe copia tanto de las aprobaciones como de las reprobaciones.
            courseId: p.courseId || null,
            aprobado: true,
            correo: datosDeCorreo(nombre, p.score, true, '/performance')
        };
    }

    if (evento === EVENTOS.QUIZ_FAILED) {
        const nombre = await nombreDeDesafio(p.quizRef);
        // Criterio de aceptacion 1: "si reprobe, debo ver tambien las opciones
        // disponibles para reintentar".
        return {
            title: recortarTitulo(`No superaste: ${nombre}`),
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
            // La clave usa el ID de la fila del intento, no su numero.
            //
            // FALLO CORREGIDO: se usaba `attemptNo`, que el productor calcula
            // con COUNT(*) + 1 sin lock. Dos envios simultaneos del mismo
            // desafio pueden obtener el mismo numero, y entonces los dos
            // eventos traen la misma clave: el segundo aviso se deduplica
            // contra el primero y el usuario pierde uno de sus resultados.
            // El id sale de la secuencia de la tabla y es unico siempre.
            clave: `quiz.failed:${p.userId}:${p.quizRef}:${claveDeIntento(p)}`,
            courseId: p.courseId || null,
            aprobado: false,
            correo: datosDeCorreo(nombre, p.score, false, '/challenges')
        };
    }

    if (evento === EVENTOS.COURSE_COMPLETED) {
        const curso = await tituloDeCurso(p.courseId);
        return {
            title: recortarTitulo(`Completaste el curso: ${curso?.title || p.courseId}`),
            body: `Terminaste todas las lecciones de "${curso?.title || p.courseId}". ` +
                  `Podes ver tu avance en Mi Desempeno: /performance`,
            payload: { resultado: 'curso_completado', courseId: p.courseId },
            clave: `course.completed:${p.userId}:${p.courseId}`,
            courseId: p.courseId,
            aprobado: true,
            correo: datosDeCorreo(curso?.title || `curso ${p.courseId}`, null, true, '/performance')
        };
    }

    if (evento === EVENTOS.SIMULATION_COMPLETED) {
        const titulo = await tituloDeSimulacion(p.simulationId);

        if (p.aprobada) {
            return {
                title: recortarTitulo(`Completaste la simulacion: ${titulo}`),
                body: `Terminaste "${titulo}" con ${p.score}% (${p.aciertos} de ${p.pasos} decisiones correctas).`,
                payload: {
                    resultado: 'aprobada', simulationId: p.simulationId,
                    score: p.score, aciertos: p.aciertos, pasos: p.pasos
                },
                clave: `simulation.completed:${p.userId}:${p.simulationId}:${claveDeIntento(p)}`,
                courseId: p.courseId || null,
                aprobado: true,
                correo: datosDeCorreo(titulo, `${p.score}%`, true, '/performance')
            };
        }

        return {
            title: recortarTitulo(`No superaste la simulacion: ${titulo}`),
            body: `Terminaste "${titulo}" con ${p.score}% (${p.aciertos} de ${p.pasos} decisiones correctas).\n` +
                  `Podes volver a intentarla desde la simulacion: /simulation/play/${p.simulationId}\n` +
                  `En Mi Desempeno tenes las lecciones de refuerzo relacionadas: /performance`,
            payload: {
                resultado: 'reprobada', simulationId: p.simulationId,
                score: p.score, aciertos: p.aciertos, pasos: p.pasos,
                reintentar_en: `/simulation/play/${p.simulationId}`,
                reforzar_en: '/performance'
            },
            clave: `simulation.completed:${p.userId}:${p.simulationId}:${claveDeIntento(p)}`,
            courseId: p.courseId || null,
            aprobado: false,
            correo: datosDeCorreo(titulo, `${p.score}%`, false, `/simulation/play/${p.simulationId}`)
        };
    }

    return null;
}

/** Aviso para RH sobre lo que hizo alguien de su equipo. */
async function avisoParaRh(aviso, empleado, curso) {
    const detalle = aviso.aprobado ? 'completo' : 'no supero';

    return {
        title: recortarTitulo(`Curso critico: ${empleado.email} ${detalle} "${curso.title}"`),
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
        clave: `${aviso.clave}:rh`,
        correo: {
            tipo: emailNotifications.TIPOS.CRITICAL_COURSE_ALERT,
            datos: {
                empleado: empleado.email,
                curso: curso.title,
                aprobado: aviso.aprobado,
                puntaje: aviso.correo?.datos?.puntaje ?? null,
                ruta: '/reports'
            }
        }
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
 * Completa las entregas que le falten a un aviso que YA existia.
 *
 * FALLO CORREGIDO: crear el aviso y registrar sus entregas son dos escrituras
 * separadas. Si la primera pasaba y la segunda fallaba, el worker reintentaba
 * el evento, pero en el reintento `crearSinEnviar` devolvia null (la clave ya
 * estaba tomada) y se salia antes de registrar nada. El aviso quedaba sin
 * entregas para siempre, sin salir en el centro y sin rastro para soporte,
 * que es justo lo contrario de lo que pide el criterio tecnico 5.
 *
 * Las entregas que faltan se registran; las que ya estan no se tocan, porque
 * `registrarEntrega` usa ON CONFLICT DO NOTHING.
 *
 * El correo NO se reenvia. Si no hay fila de email no sabemos si el envio
 * anterior salio, y mandar dos correos por un mismo resultado es peor que
 * dejar constancia de que se genero: queda en 'generada', que es lo unico que
 * consta de verdad.
 */
async function reconciliarEntregas(dedupeKey, canales) {
    const { rows } = await db.query(
        'SELECT id FROM notifications WHERE dedupe_key = $1', [dedupeKey]
    );
    const existente = rows[0];
    if (!existente) return;

    if (canales.in_app) await registrarEntrega(existente.id, 'in_app', 'entregada');
    if (canales.email) await registrarEntrega(existente.id, 'email', 'generada');
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
    const dedupeKey = `res:${aviso.clave}:${userId}`;

    const notificacion = await notificationsService.crearSinEnviar(
        eventName,
        { title: aviso.title, body: aviso.body, payload: aviso.payload, dedupeKey },
        userId
    );

    // Criterio tecnico 4: el mismo evento reprocesado no genera una segunda
    // notificacion. La clave de deduplicacion identifica el HECHO (evento +
    // referencia + intento + destinatario), no el intento de procesarlo.
    if (!notificacion) {
        await reconciliarEntregas(dedupeKey, canales);
        return null;
    }

    // In-app: guardar el aviso ES entregarlo, asi que los dos instantes
    // coinciden y se registra directamente como entregada.
    if (canales.in_app) {
        await registrarEntrega(notificacion.id, 'in_app', 'entregada');
    }

    if (canales.email && aviso.correo) {
        // HU de notificaciones por correo: el correo ya no se manda aca, en
        // linea y sin reintentos. Se encola como job y el worker de
        // emailNotifications lo envia con plantilla, en el idioma del usuario
        // y con hasta 3 reintentos. Cuando termina, el propio worker pasa esta
        // entrega a 'entregada' o 'fallida'; hasta entonces queda 'generada',
        // que es exactamente lo que paso.
        const correo = await emailNotifications.encolar({
            userId,
            tipo: aviso.correo.tipo,
            datos: aviso.correo.datos,
            dedupeKey,
            notificationId: notificacion.id
        });

        if (correo.estado === 'no_entregable') {
            await registrarEntrega(notificacion.id, 'email', 'fallida',
                'el destinatario no tiene un correo valido registrado');
        } else if (correo.estado !== 'omitido') {
            // 'omitido' es un tipo de correo que el usuario apago: no hubo
            // entrega por este canal y no corresponde registrar ninguna.
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
    // FALLO CORREGIDO: el centro listaba y contaba con `notifications.read_at`,
    // que es el campo global y viejo de la migracion 009. Dos consecuencias:
    //
    //   1. Un usuario que apagaba el canal in_app igual veia los avisos aca.
    //      El aviso SE CREA siempre -- es el registro del hecho, y RH lo
    //      necesita aunque el empleado no quiera verlo -- pero sin entrega
    //      in_app no fue entregado por este canal y no corresponde mostrarlo.
    //   2. El contador de "sin leer" era uno solo para los dos canales, asi
    //      que la independencia por canal que promete el criterio 3 existia en
    //      notification_deliveries pero no en lo que ve el usuario.
    //
    // Ahora el centro ES la vista del canal in_app: el JOIN (no LEFT) contra
    // su entrega decide que se lista, y el estado de lectura sale de ahi.
    const { rows } = await db.query(
        `SELECT n.id, n.event_name, n.title, n.body, n.payload, n.created_at,
                app.read_at AS leida_en_app,
                app.status  AS estado_en_app,
                COALESCE(
                    json_agg(
                        json_build_object('canal', d.channel, 'estado', d.status,
                                          'entregada_en', d.delivered_at, 'leida_en', d.read_at)
                        ORDER BY d.channel
                    ) FILTER (WHERE d.id IS NOT NULL),
                    '[]'
                ) AS canales
           FROM notifications n
           JOIN notification_deliveries app
             ON app.notification_id = n.id AND app.channel = 'in_app'
           LEFT JOIN notification_deliveries d ON d.notification_id = n.id
          WHERE n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND ($3::boolean = false OR app.status <> 'leida')
          GROUP BY n.id, app.read_at, app.status
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT $4`,
        [userId, EVENTOS_DE_RESULTADO, soloNoLeidas, limit]
    );

    const { rows: [contador] } = await db.query(
        `SELECT COUNT(*)::int AS no_leidas
           FROM notifications n
           JOIN notification_deliveries app
             ON app.notification_id = n.id AND app.channel = 'in_app'
          WHERE n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND app.status <> 'leida'`,
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
 * Marca solo los avisos de ESTE centro, no la bandeja entera.
 *
 * FALLO CORREGIDO: marcaba todas las notificaciones del usuario, incluidas las
 * de nivel, recompensa y reportes, que no son de esta historia y que el usuario
 * ni siquiera esta viendo cuando aprieta el boton. Un boton del centro de
 * resultados no tiene por que tocar avisos de otros modulos.
 *
 * Se escriben los DOS estados, y la diferencia entre ellos es deliberada:
 *
 *   - `notifications.read_at` es el campo global de la migracion 009 y NO
 *     representa la lectura por canal: es el unico estado que entiende la
 *     bandeja general (/api/notifications), que no modela canales. Se escribe
 *     para que las dos vistas no se contradigan sobre estos mismos avisos.
 *   - `notification_deliveries` es donde vive la lectura por canal del
 *     criterio 3. Solo se marca la entrega in_app: la de correo queda como
 *     estaba, porque nadie leyo el correo.
 *
 * El conteo que se devuelve es el de este centro, o sea el del canal in_app.
 */
async function marcarTodasLeidas(userId) {
    const { rows } = await db.query(
        `UPDATE notifications
            SET read_at = now()
          WHERE user_id = $1
            AND event_name = ANY($2::text[])
            AND read_at IS NULL
          RETURNING id`,
        [userId, EVENTOS_DE_RESULTADO]
    );

    const { rows: entregas } = await db.query(
        `UPDATE notification_deliveries d
            SET status = 'leida', read_at = now()
           FROM notifications n
          WHERE d.notification_id = n.id
            AND n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND d.channel = 'in_app'
            AND d.status <> 'leida'
          RETURNING d.id`,
        [userId, EVENTOS_DE_RESULTADO]
    );

    return {
        marcadas: entregas.length,
        avisos_marcados_en_bandeja: rows.length
    };
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
