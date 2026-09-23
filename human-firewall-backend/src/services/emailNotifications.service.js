/**
 * Notificaciones por correo electronico.
 *
 * HU: "Yo como sistema quiero enviar notificaciones por correo electronico de
 * forma confiable ante eventos relevantes de la plataforma (asignacion de
 * curso, fecha limite proxima, resultado de evaluacion, etc.)".
 *
 * ---------------------------------------------------------------------
 * El camino de un correo
 * ---------------------------------------------------------------------
 *
 *   accion (asignar curso)          handler del evento            worker de correo
 *   --publish()--> event_outbox --> encolar() ---------> email_jobs ---> sendMail()
 *        |                          - preferencias (CT 5)     |          - reintentos (CT 3)
 *        +-- responde ya            - direccion valida (CT 4) |          - un registro por
 *                                   - idioma + plantilla (CT 2)          intento fallido
 *
 * Criterio tecnico 1: la operacion de origen solo escribe una fila en el
 * outbox y responde. El handler solo escribe una fila en email_jobs. Recien
 * el worker habla con el proveedor, y lo hace fuera de cualquier request.
 *
 * ---------------------------------------------------------------------
 * Quien usa este modulo
 * ---------------------------------------------------------------------
 *   - Sus propios handlers: curso asignado, fecha limite proxima y cambio de
 *     contrasena. Esos eventos no los escuchaba nadie para avisar.
 *   - resultNotifications.service, para el canal de correo de los resultados
 *     de evaluaciones. Ese modulo decide QUE resultado se avisa y a QUIEN;
 *     este decide COMO sale el correo. Ninguno de los dos arma HTML: eso lo
 *     hace la plantilla (emailTemplates.service).
 */

const db = require('../config/db');
const eventBus = require('./eventBus');
const { EVENTOS } = require('../events/catalogo');
const plantillas = require('./emailTemplates.service');

// ---------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------

/** Tipos de correo. Son las filas de email_notification_types (migracion 034). */
const TIPOS = {
    COURSE_ASSIGNED:           'course_assigned',
    DEADLINE_APPROACHING:      'deadline_approaching',
    EVALUATION_RESULT:         'evaluation_result',
    CRITICAL_COURSE_ALERT:     'critical_course_alert',
    SECURITY_PASSWORD_CHANGED: 'security_password_changed'
};

function numeroDeEntorno(nombre, porDefecto) {
    const valor = Number(process.env[nombre]);
    return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

/**
 * Criterio tecnico 3: "reintentar hasta 3 veces con backoff exponencial antes
 * de marcar el envio como fallido".
 */
const MAX_REINTENTOS = 3;

/**
 * Base del backoff, en segundos. La espera antes del reintento n es
 * base * 2^(n-1): 30, 60 y 120 s con el valor por defecto. Sumados quedan
 * holgadamente dentro de los 5 minutos del criterio de aceptacion 1, y un
 * proveedor que se cayo un instante tiene tiempo de volver.
 */
const BACKOFF_BASE_SEGUNDOS = numeroDeEntorno('EMAIL_RETRY_BASE_SECONDS', 30);

/** Cada cuanto mira la cola el worker. Es la red de seguridad del despertar inmediato. */
const INTERVALO_WORKER_MS = numeroDeEntorno('EMAIL_WORKER_INTERVAL_SECONDS', 15) * 1000;

/** Con cuanta anticipacion se avisa que vence un curso. */
const VENTANA_VENCIMIENTO_HORAS = numeroDeEntorno('EMAIL_DEADLINE_WINDOW_HOURS', 48);

/** Cada cuanto se buscan fechas limite proximas. */
const INTERVALO_VENCIMIENTOS_MS = numeroDeEntorno('EMAIL_DEADLINE_SCAN_MINUTES', 15) * 60 * 1000;

/** Un job en 'processing' por mas de esto quedo huerfano de un proceso caido. */
const MINUTOS_JOB_HUERFANO = 10;

/** Contra que se arman los enlaces del correo (criterio de aceptacion 1). */
function urlBase() {
    return String(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------

let transporte = null;
let transporteResuelto = false;

/**
 * Transporte SMTP, o null si no hay SMTP_HOST.
 *
 * Sin SMTP el job queda en 'skipped': es el modo por defecto del proyecto en
 * desarrollo y no es un fallo. El contenido ya renderizado queda en la fila,
 * asi que igual se puede ver que se habria mandado.
 */
function obtenerTransporte() {
    if (transporteResuelto) return transporte;
    transporteResuelto = true;

    if (!process.env.SMTP_HOST) return (transporte = null);

    try {
        const nodemailer = require('nodemailer');
        transporte = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: String(process.env.SMTP_SECURE) === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
            // Sin estos topes un servidor que no contesta deja al worker
            // colgado minutos, y el timeout no llegaria nunca a ser un error
            // transitorio que se pueda reintentar.
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 15000
        });
    } catch (err) {
        console.warn(`[email] no se pudo crear el transporte: ${err.message}`);
        transporte = null;
    }

    return transporte;
}

/** Reemplaza el transporte. Lo usan las pruebas para simular al proveedor. */
function usarTransporte(nuevo) {
    transporte = nuevo;
    transporteResuelto = true;
}

// ---------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------

/**
 * Criterio tecnico 4: la direccion se valida ANTES de intentar el envio.
 *
 * No pretende ser RFC 5322: descarta lo que seguro no es un correo (vacio,
 * sin arroba, sin dominio, con espacios). Lo que pase este filtro y el
 * proveedor rechace cae como error permanente en el worker.
 */
function esCorreoValido(email) {
    if (typeof email !== 'string') return false;
    const valor = email.trim();
    return valor.length > 0 && valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

/**
 * Un error es transitorio si reintentar puede servir.
 *
 * El criterio tecnico 3 nombra dos casos: timeout y "error 5xx del
 * proveedor". Ademas se reintentan los codigos SMTP de la familia 4xx que
 * significan "intentalo mas tarde" (421 servicio no disponible, 45x buzon
 * ocupado o sin espacio temporal). Todo lo demas -- destinatario rechazado,
 * credenciales invalidas, mensaje mal formado -- va a fallar igual la
 * proxima vez, y reintentarlo solo demora el diagnostico.
 */
const CODIGOS_DE_RED = new Set([
    'ETIMEDOUT', 'ETIMEOUT', 'ECONNECTION', 'ESOCKET',
    'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EDNS'
]);

function esErrorTransitorio(err) {
    if (!err) return false;
    if (CODIGOS_DE_RED.has(err.code)) return true;

    const estado = Number(err.responseCode ?? err.statusCode ?? err.status);
    if (estado >= 500 && estado <= 599) return true;
    return [421, 450, 451, 452].includes(estado);
}

/** Detalle tecnico del error, para el log y para email_job_attempts. */
function detalleTecnico(err) {
    const partes = [];
    if (err?.code) partes.push(`code=${err.code}`);
    const estado = err?.responseCode ?? err?.statusCode ?? err?.status;
    if (estado) partes.push(`status=${estado}`);
    if (err?.command) partes.push(`command=${err.command}`);
    partes.push(err?.response || err?.message || String(err));
    return partes.join(' | ').slice(0, 1000);
}

// ---------------------------------------------------------------------
// Tipos y preferencias (criterio de aceptacion 2, criterio tecnico 5)
// ---------------------------------------------------------------------

async function obtenerTipo(tipo) {
    const { rows } = await db.query(
        'SELECT code, is_critical, description FROM email_notification_types WHERE code = $1',
        [tipo]
    );
    return rows[0] || null;
}

/**
 * Si el usuario quiere recibir un correo opcional de este tipo.
 *
 * Se respetan las dos preferencias: el canal de correo entero (033, la que ya
 * existia en el centro de notificaciones) y el tipo puntual (034). Sin fila,
 * las dos estan habilitadas.
 */
async function quiereRecibir(userId, tipo) {
    const { rows } = await db.query(
        `SELECT
            COALESCE((SELECT enabled FROM notification_preferences
                       WHERE user_id = $1 AND channel = 'email'), true) AS canal,
            COALESCE((SELECT enabled FROM email_preferences
                       WHERE user_id = $1 AND notification_type = $2), true) AS tipo`,
        [userId, tipo]
    );
    return rows[0].canal && rows[0].tipo;
}

/** Preferencias de correo de un usuario, con los valores por defecto resueltos. */
async function obtenerPreferencias(userId) {
    const { rows: tipos } = await db.query(
        `SELECT t.code, t.is_critical, t.description,
                COALESCE(p.enabled, true) AS enabled
           FROM email_notification_types t
           LEFT JOIN email_preferences p
                  ON p.notification_type = t.code AND p.user_id = $1
          ORDER BY t.is_critical DESC, t.code`,
        [userId]
    );

    const { rows: [usuario] } = await db.query(
        `SELECT u.language,
                COALESCE((SELECT enabled FROM notification_preferences
                           WHERE user_id = u.id AND channel = 'email'), true) AS canal_email
           FROM users u WHERE u.id = $1`,
        [userId]
    );

    return {
        user_id: userId,
        idioma: usuario?.language || null,
        idioma_efectivo: plantillas.resolverIdioma(usuario?.language),
        idioma_por_defecto: plantillas.idiomaPorDefecto(),
        canal_email: usuario ? usuario.canal_email : true,
        tipos: tipos.map(t => ({
            tipo: t.code,
            descripcion: t.description,
            critico: t.is_critical,
            // Un critico se muestra siempre habilitado: aunque hubiera una
            // fila vieja que diga lo contrario, no se respeta al enviar.
            habilitado: t.is_critical ? true : t.enabled
        }))
    };
}

/**
 * Cambia que tipos de correo recibe un usuario.
 *
 * @param {object} cambios  { tipos: { course_assigned: false, ... } }
 * @throws {Error} con codigo 400 y detalle por campo si algo no es valido
 */
async function actualizarPreferencias(userId, cambios = {}) {
    const pedidos = cambios.tipos;
    const errores = [];

    if (!pedidos || typeof pedidos !== 'object' || Array.isArray(pedidos)) {
        errores.push({ campo: 'tipos', detalle: 'Debe ser un objeto { tipo: true|false }.' });
    } else {
        const { rows: catalogo } = await db.query(
            'SELECT code, is_critical FROM email_notification_types'
        );
        const porCodigo = new Map(catalogo.map(t => [t.code, t]));

        for (const [tipo, valor] of Object.entries(pedidos)) {
            const info = porCodigo.get(tipo);
            if (!info) {
                errores.push({ campo: `tipos.${tipo}`, detalle: 'Tipo de notificacion desconocido.' });
            } else if (typeof valor !== 'boolean') {
                errores.push({ campo: `tipos.${tipo}`, detalle: 'Debe ser true o false.' });
            } else if (info.is_critical && valor === false) {
                errores.push({
                    campo: `tipos.${tipo}`,
                    detalle: 'Es una notificacion critica de seguridad y no se puede desactivar.'
                });
            }
        }
    }

    if (errores.length > 0) {
        const error = new Error('Preferencias invalidas');
        error.codigo = 400;
        error.errores = errores;
        throw error;
    }

    for (const [tipo, valor] of Object.entries(pedidos)) {
        await db.query(
            `INSERT INTO email_preferences (user_id, notification_type, enabled)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, notification_type)
             DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
            [userId, tipo, valor]
        );
    }

    return obtenerPreferencias(userId);
}

// ---------------------------------------------------------------------
// Encolado
// ---------------------------------------------------------------------

/** Campos de fecha que se formatean segun el idioma del correo. */
const CAMPOS_FECHA = ['fechaLimite', 'fecha'];

function formatearFecha(valor, idioma) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return String(valor);

    return new Intl.DateTimeFormat(idioma === 'en' ? 'en-US' : 'es-CO', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: process.env.APP_TIMEZONE || 'America/Bogota'
    }).format(fecha);
}

/** "ana.perez@empresa.com" -> "ana.perez". No hay columna de nombre en users. */
function nombreVisible(email) {
    return String(email || '').split('@')[0] || 'usuario';
}

/**
 * Variables que recibe la plantilla. Las fechas se formatean en el idioma del
 * correo y la ruta relativa se convierte en un enlace absoluto: en un correo
 * "/performance" no lleva a ningun lado.
 */
function prepararVariables(datos, usuario, idioma) {
    const variables = { nombre: nombreVisible(usuario.email), ...datos };

    for (const campo of CAMPOS_FECHA) {
        if (variables[campo]) variables[campo] = formatearFecha(variables[campo], idioma);
    }

    if (datos.ruta) {
        const ruta = String(datos.ruta).startsWith('/') ? datos.ruta : `/${datos.ruta}`;
        variables.enlace = `${urlBase()}${ruta}`;
    }

    return variables;
}

let workerActivo = false;

/** Despierta al worker sin esperarlo. Solo si esta corriendo: las pruebas drenan a mano. */
function despertarWorker() {
    if (!workerActivo) return;
    setImmediate(() => {
        procesarPendientes().catch(err =>
            console.error('[email] error procesando la cola:', err.message)
        );
    });
}

/**
 * Encola un correo. NO lo envia.
 *
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.tipo            uno de TIPOS
 * @param {object} p.datos           variables de la plantilla; `ruta` se vuelve {{enlace}}
 * @param {string} p.dedupeKey       identifica el hecho: reprocesar no duplica el correo
 * @param {number} [p.notificationId] aviso de la bandeja al que corresponde
 *
 * @returns {Promise<{estado: 'encolado'|'duplicado'|'omitido'|'no_entregable'|'sin_usuario', jobId?: number}>}
 *
 * Nunca devuelve un error por una decision del usuario ni por una direccion
 * invalida: esos casos NO son fallos del modulo de origen (criterios tecnicos
 * 4 y 5). Si lanza es por algo que si merece reintento del bus, como la base
 * caida o una plantilla que no existe.
 */
async function encolar({ userId, tipo, datos = {}, dedupeKey, notificationId = null }) {
    if (!dedupeKey) throw new Error('encolar() necesita dedupeKey');

    const info = await obtenerTipo(tipo);
    if (!info) throw new Error(`tipo de correo desconocido: ${tipo}`);

    // Criterio tecnico 5: la preferencia se mira ANTES de encolar, y omitir no
    // es un error ni deja registro de fallo. Los criticos no la consultan.
    if (!info.is_critical && !(await quiereRecibir(userId, tipo))) {
        return { estado: 'omitido' };
    }

    const { rows: [usuario] } = await db.query(
        'SELECT id, email, language FROM users WHERE id = $1',
        [userId]
    );
    if (!usuario) {
        console.warn(`[email] ${tipo}: el usuario ${userId} no existe, no hay a quien escribirle`);
        return { estado: 'sin_usuario' };
    }

    const idiomaPedido = plantillas.resolverIdioma(usuario.language);

    // Criterio tecnico 4: sin direccion valida se descarta sin reintentar y
    // queda registrado como no entregable. Se registra igual que un job, para
    // que soporte lo encuentre donde busca los demas correos.
    if (!esCorreoValido(usuario.email)) {
        const { rows } = await db.query(
            `INSERT INTO email_jobs
                 (user_id, notification_type, dedupe_key, notification_id, to_email,
                  language, status, max_attempts, last_error, finished_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'undeliverable', 0, $7, now())
             ON CONFLICT (dedupe_key) DO NOTHING
             RETURNING id`,
            [userId, tipo, dedupeKey, notificationId, usuario.email || null, idiomaPedido,
             'el destinatario no tiene un correo valido registrado']
        );
        console.warn(
            `[email] ${tipo} -> usuario ${userId}: no entregable, correo invalido ` +
            `(${JSON.stringify(usuario.email)}). Se descarta sin reintentar.`
        );
        return { estado: 'no_entregable', jobId: rows[0]?.id };
    }

    // Criterio tecnico 2 y de aceptacion 3: plantilla por tipo e idioma. Si el
    // idioma no tuviera plantilla, obtenerPlantilla cae al de la plataforma, y
    // el job registra el idioma con el que realmente salio.
    const plantilla = await plantillas.obtenerPlantilla(tipo, idiomaPedido);
    const contenido = plantillas.renderizar(
        plantilla, prepararVariables(datos, usuario, plantilla.language)
    );

    const { rows } = await db.query(
        `INSERT INTO email_jobs
             (user_id, notification_type, dedupe_key, notification_id, to_email, language,
              template_id, template_version, subject, body_html, body_text, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id`,
        [userId, tipo, dedupeKey, notificationId, usuario.email.trim(), plantilla.language,
         plantilla.id, plantilla.version, contenido.subject, contenido.html, contenido.text,
         MAX_REINTENTOS]
    );

    if (rows.length === 0) return { estado: 'duplicado' };

    despertarWorker();
    return { estado: 'encolado', jobId: rows[0].id };
}

// ---------------------------------------------------------------------
// Worker (criterio tecnico 3)
// ---------------------------------------------------------------------

/**
 * Refleja como termino el correo en la entrega por canal de la HU de
 * resultados (notification_deliveries), si el job pertenece a un aviso.
 *
 * Es UPSERT porque el worker puede terminar antes de que el modulo de
 * resultados alcance a registrar la entrega como 'generada'. Si el usuario ya
 * la habia marcado como leida no se pisa.
 */
async function reflejarEnEntrega(job, estado, error = null) {
    if (!job.notification_id) return;

    const columna = estado === 'entregada' ? 'delivered_at' : 'failed_at';
    await db.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status, error, ${columna})
         VALUES ($1, 'email', $2, $3, now())
         ON CONFLICT (notification_id, channel) DO UPDATE
            SET status = EXCLUDED.status,
                error = EXCLUDED.error,
                ${columna} = EXCLUDED.${columna}
          WHERE notification_deliveries.status <> 'leida'`,
        [job.notification_id, estado, error]
    );
}

async function registrarIntento(job, resultado, err = null) {
    await db.query(
        `INSERT INTO email_job_attempts (job_id, attempt_no, outcome, error_code, error_detail)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (job_id, attempt_no) DO NOTHING`,
        [job.id, job.attempts, resultado,
         err ? String(err.code || err.responseCode || err.statusCode || '').slice(0, 50) || null : null,
         err ? detalleTecnico(err) : null]
    );
}

/**
 * Toma el proximo job vencido y lo marca como 'processing'.
 *
 * FOR UPDATE SKIP LOCKED, igual que el outbox: con varias instancias del
 * servidor, dos workers nunca toman el mismo correo.
 */
async function tomarSiguiente() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id FROM email_jobs
              WHERE status = 'pending' AND next_attempt_at <= now()
              ORDER BY next_attempt_at, id
              FOR UPDATE SKIP LOCKED
              LIMIT 1`
        );

        if (rows.length === 0) {
            await client.query('COMMIT');
            return null;
        }

        // next_attempt_at pasa a ser "cuando se tomo": es lo que usa
        // recuperarHuerfanos para saber cuanto lleva en 'processing'.
        const { rows: [job] } = await client.query(
            `UPDATE email_jobs
                SET status = 'processing', attempts = attempts + 1, next_attempt_at = now()
              WHERE id = $1
              RETURNING id, user_id, notification_type, notification_id, to_email,
                        subject, body_html, body_text, attempts, max_attempts`,
            [rows[0].id]
        );

        await client.query('COMMIT');
        return job;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Intenta enviar un job ya tomado.
 *
 * @returns {Promise<'sent'|'retry'|'failed'|'skipped'>}
 */
async function enviar(job) {
    const emisor = obtenerTransporte();

    if (!emisor) {
        await db.query(
            `UPDATE email_jobs SET status = 'skipped', finished_at = now() WHERE id = $1`,
            [job.id]
        );
        console.log(`[email] sin SMTP_HOST: job ${job.id} (${job.notification_type}) -> ${job.to_email}: "${job.subject}"`);
        return 'skipped';
    }

    try {
        await emisor.sendMail({
            from: process.env.MAIL_FROM || 'Human Firewall <no-reply@humanfirewall.local>',
            to: job.to_email,
            subject: job.subject,
            html: job.body_html,
            text: job.body_text
        });

        await registrarIntento(job, 'sent');
        await db.query(
            `UPDATE email_jobs
                SET status = 'sent', sent_at = now(), finished_at = now(), last_error = NULL
              WHERE id = $1`,
            [job.id]
        );
        await reflejarEnEntrega(job, 'entregada');
        return 'sent';

    } catch (err) {
        const transitorio = esErrorTransitorio(err);
        const agotado = !transitorio || job.attempts >= job.max_attempts;
        const detalle = detalleTecnico(err);

        await registrarIntento(job, transitorio ? 'transient_error' : 'permanent_error', err);

        if (agotado) {
            await db.query(
                `UPDATE email_jobs
                    SET status = 'failed', last_error = $2, finished_at = now()
                  WHERE id = $1`,
                [job.id, detalle]
            );
            await reflejarEnEntrega(job, 'fallida', detalle.slice(0, 500));
        } else {
            const espera = BACKOFF_BASE_SEGUNDOS * Math.pow(2, job.attempts - 1);
            await db.query(
                `UPDATE email_jobs
                    SET status = 'pending', last_error = $2,
                        next_attempt_at = now() + ($3 || ' seconds')::interval
                  WHERE id = $1`,
                [job.id, detalle, String(espera)]
            );
        }

        console.warn(
            `[email] job ${job.id} (${job.notification_type} -> ${job.to_email}) ` +
            `intento ${job.attempts}/${job.max_attempts} fallo: ${detalle}` +
            (!transitorio ? ' -> error permanente, no se reintenta'
                : agotado ? ' -> reintentos agotados, marcado como fallido'
                : ` -> reintento en ${BACKOFF_BASE_SEGUNDOS * Math.pow(2, job.attempts - 1)}s`)
        );

        return agotado ? 'failed' : 'retry';
    }
}

/** Devuelve a la cola los jobs que un proceso caido dejo en 'processing'. */
async function recuperarHuerfanos() {
    const { rows } = await db.query(
        `UPDATE email_jobs
            SET status = 'pending'
          WHERE status = 'processing'
            AND next_attempt_at < now() - ($1 || ' minutes')::interval
          RETURNING id`,
        [String(MINUTOS_JOB_HUERFANO)]
    );
    if (rows.length > 0) {
        console.warn(`[email] ${rows.length} job(s) huerfano(s) devueltos a la cola`);
    }
    return rows.length;
}

let procesando = false;

/**
 * Drena los jobs vencidos.
 *
 * @returns {Promise<{procesados: number, enviados: number, reintentos: number, fallidos: number, omitidos: number}>}
 */
async function procesarPendientes(maxPorTanda = 50) {
    const resumen = { procesados: 0, enviados: 0, reintentos: 0, fallidos: 0, omitidos: 0 };
    if (procesando) return resumen;   // el timer y el despertar no se pisan
    procesando = true;

    try {
        await recuperarHuerfanos();

        while (resumen.procesados < maxPorTanda) {
            const job = await tomarSiguiente();
            if (!job) break;

            const resultado = await enviar(job);
            resumen.procesados++;
            if (resultado === 'sent') resumen.enviados++;
            else if (resultado === 'retry') resumen.reintentos++;
            else if (resultado === 'failed') resumen.fallidos++;
            else resumen.omitidos++;
        }
    } finally {
        procesando = false;
    }

    return resumen;
}

// ---------------------------------------------------------------------
// Fecha limite proxima
// ---------------------------------------------------------------------

/**
 * Busca asignaciones que vencen dentro de la ventana y publica un evento por
 * cada una.
 *
 * Nadie "hace" que se acerque una fecha: es el paso del tiempo. Por eso este
 * evento no lo publica un controlador sino este reloj. La marca
 * deadline_notified_at se escribe en la MISMA transaccion que el evento, asi
 * que una asignacion avisa una sola vez aunque haya varias instancias.
 *
 * @returns {Promise<number>} cuantos avisos se publicaron
 */
async function buscarVencimientosProximos(ahora = new Date(), maxPorTanda = 100) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, user_id, course_id, due_date
               FROM course_assignments
              WHERE due_date IS NOT NULL
                AND deadline_notified_at IS NULL
                AND COALESCE(status, 'assigned') <> 'completed'
                AND due_date > $1::timestamptz
                AND due_date <= $1::timestamptz + ($2 || ' hours')::interval
              ORDER BY due_date
              FOR UPDATE SKIP LOCKED
              LIMIT $3`,
            [ahora.toISOString(), String(VENTANA_VENCIMIENTO_HORAS), maxPorTanda]
        );

        for (const a of rows) {
            await eventBus.publish(EVENTOS.COURSE_DEADLINE_APPROACHING, {
                userId: a.user_id,
                courseId: a.course_id,
                assignmentId: a.id,
                dueDate: new Date(a.due_date).toISOString()
            }, client);
        }

        if (rows.length > 0) {
            await client.query(
                `UPDATE course_assignments SET deadline_notified_at = now() WHERE id = ANY($1::int[])`,
                [rows.map(a => a.id)]
            );
        }

        await client.query('COMMIT');
        return rows.length;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------

async function tituloDeCurso(courseId) {
    const { rows } = await db.query('SELECT title FROM courses WHERE id = $1', [courseId]);
    return rows[0]?.title || `curso ${courseId}`;
}

async function alAsignarCurso({ userId, courseId, assignmentId, dueDate }) {
    if (!userId || !assignmentId) return null;
    return encolar({
        userId,
        tipo: TIPOS.COURSE_ASSIGNED,
        dedupeKey: `course_assigned:${assignmentId}`,
        datos: {
            curso: await tituloDeCurso(courseId),
            fechaLimite: dueDate || null,
            ruta: `/dashboard?curso=${courseId}`
        }
    });
}

async function alAcercarseLaFechaLimite({ userId, courseId, assignmentId, dueDate }) {
    if (!userId || !assignmentId) return null;
    return encolar({
        userId,
        tipo: TIPOS.DEADLINE_APPROACHING,
        // Con la fecha en la clave: si RH extiende el plazo, el nuevo
        // vencimiento es otro hecho y merece su propio aviso.
        dedupeKey: `deadline:${assignmentId}:${dueDate}`,
        datos: {
            curso: await tituloDeCurso(courseId),
            fechaLimite: dueDate,
            ruta: `/dashboard?curso=${courseId}`
        }
    });
}

async function alCambiarContrasena({ userId, changedAt }) {
    if (!userId) return null;
    return encolar({
        userId,
        tipo: TIPOS.SECURITY_PASSWORD_CHANGED,
        dedupeKey: `password_changed:${userId}:${changedAt}`,
        datos: { fecha: changedAt, ruta: '/forgot-password' }
    });
}

// ---------------------------------------------------------------------
// Diagnostico
// ---------------------------------------------------------------------

/** Estado de la cola de correos. Alimenta GET /api/notifications/correo/estado. */
async function estadoDeLaCola() {
    const { rows } = await db.query(
        'SELECT status, COUNT(*)::int AS total FROM email_jobs GROUP BY status'
    );
    const porEstado = { pending: 0, processing: 0, sent: 0, failed: 0, undeliverable: 0, skipped: 0 };
    for (const r of rows) porEstado[r.status] = r.total;

    const { rows: problemas } = await db.query(
        `SELECT j.id, j.notification_type, j.user_id, j.to_email, j.status,
                j.attempts, j.max_attempts, j.last_error, j.created_at, j.finished_at,
                COALESCE(
                    json_agg(json_build_object(
                        'intento', a.attempt_no, 'resultado', a.outcome,
                        'codigo', a.error_code, 'detalle', a.error_detail, 'en', a.attempted_at
                    ) ORDER BY a.attempt_no) FILTER (WHERE a.id IS NOT NULL),
                    '[]'
                ) AS intentos
           FROM email_jobs j
           LEFT JOIN email_job_attempts a ON a.job_id = j.id
          WHERE j.status IN ('failed', 'undeliverable')
          GROUP BY j.id
          ORDER BY j.id DESC
          LIMIT 20`
    );

    return { por_estado: porEstado, ultimos_con_problemas: problemas };
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

let timerWorker = null;
let timerVencimientos = null;

/** Arranca el worker de la cola y el reloj de fechas limite. Se llama desde conectarTodo(). */
function iniciarWorker() {
    if (timerWorker) return;
    workerActivo = true;

    timerWorker = setInterval(
        () => procesarPendientes().catch(e => console.error('[email] worker:', e.message)),
        INTERVALO_WORKER_MS
    );
    timerVencimientos = setInterval(
        () => buscarVencimientosProximos().catch(e => console.error('[email] vencimientos:', e.message)),
        INTERVALO_VENCIMIENTOS_MS
    );
    if (timerWorker.unref) timerWorker.unref();
    if (timerVencimientos.unref) timerVencimientos.unref();

    console.log(
        `[email] worker cada ${INTERVALO_WORKER_MS / 1000} s, ` +
        `vencimientos cada ${INTERVALO_VENCIMIENTOS_MS / 60000} min ` +
        `(ventana ${VENTANA_VENCIMIENTO_HORAS} h)` +
        (process.env.SMTP_HOST ? '' : ' -- sin SMTP_HOST: los correos quedan en skipped')
    );
}

function detenerWorker() {
    workerActivo = false;
    if (timerWorker) { clearInterval(timerWorker); timerWorker = null; }
    if (timerVencimientos) { clearInterval(timerVencimientos); timerVencimientos = null; }
}

function registrarHandlers() {
    eventBus.subscribe(EVENTOS.COURSE_ASSIGNED, alAsignarCurso);
    eventBus.subscribe(EVENTOS.COURSE_DEADLINE_APPROACHING, alAcercarseLaFechaLimite);
    eventBus.subscribe(EVENTOS.USER_PASSWORD_CHANGED, alCambiarContrasena);
    console.log('[emailNotifications.service] handlers registrados');
}

module.exports = {
    TIPOS,
    MAX_REINTENTOS,
    BACKOFF_BASE_SEGUNDOS,
    VENTANA_VENCIMIENTO_HORAS,
    esCorreoValido,
    esErrorTransitorio,
    usarTransporte,
    quiereRecibir,
    obtenerPreferencias,
    actualizarPreferencias,
    encolar,
    procesarPendientes,
    buscarVencimientosProximos,
    alAsignarCurso,
    alAcercarseLaFechaLimite,
    alCambiarContrasena,
    estadoDeLaCola,
    iniciarWorker,
    detenerWorker,
    registrarHandlers
};
