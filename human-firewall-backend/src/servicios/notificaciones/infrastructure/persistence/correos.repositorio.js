/**
 * Repositorio de la cola de correos (servicio de notificaciones).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): email_jobs,
 * su historial de intentos, el catalogo de tipos, las preferencias de correo
 * y el reflejo en notification_deliveries.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('./conexion');

const q = (tx) => tx || db;

/**
 * Bloquea el siguiente job pendiente (FOR UPDATE SKIP LOCKED: dos workers no
 * toman el mismo). Devuelve { id } o null.
 */
async function bloquearSiguientePendiente(tx) {
    const { rows } = await q(tx).query(
        `SELECT id FROM notificaciones.email_jobs
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY next_attempt_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
    );
    return rows[0] || null;
}

/**
 * Pasa el job a 'processing' y suma un intento. next_attempt_at pasa a ser
 * "cuando se tomo": es lo que usa recuperarHuerfanos para saber cuanto lleva
 * en 'processing'.
 */
async function marcarProcesando(id, tx) {
    const { rows } = await q(tx).query(
        `UPDATE notificaciones.email_jobs
            SET status = 'processing', attempts = attempts + 1, next_attempt_at = now()
          WHERE id = $1
          RETURNING id, user_id, notification_type, notification_id, to_email,
                    subject, body_html, body_text, attempts, max_attempts`,
        [id]
    );
    return rows[0];
}
/** Tipo de correo del catalogo (email_notification_types). */
async function tipoDeCorreo(tipo) {
    const { rows } = await db.query(
        'SELECT code, is_critical, description FROM notificaciones.email_notification_types WHERE code = $1',
        [tipo]
    );
    return rows;
}

/** Si el usuario acepta correos: canal general (notification_preferences) y tipo puntual (email_preferences). Sin fila, habilitado. */
async function preferenciaDeCorreo(userId, tipo) {
    const { rows } = await db.query(
        `SELECT
            COALESCE((SELECT enabled FROM notificaciones.notification_preferences
                       WHERE user_id = $1 AND channel = 'email'), true) AS canal,
            COALESCE((SELECT enabled FROM notificaciones.email_preferences
                       WHERE user_id = $1 AND notification_type = $2), true) AS tipo`,
        [userId, tipo]
    );
    return rows;
}

/** Tipos configurables con la preferencia del usuario resuelta (sin fila = habilitado). */
async function preferenciasPorTipo(userId) {
    const { rows } = await db.query(
        `SELECT t.code, t.is_critical, t.description,
                COALESCE(p.enabled, true) AS enabled
           FROM notificaciones.email_notification_types t
           LEFT JOIN notificaciones.email_preferences p
                  ON p.notification_type = t.code AND p.user_id = $1
          WHERE t.user_configurable
          ORDER BY t.is_critical DESC, t.code`,
        [userId]
    );
    return rows;
}

/** Preferencia del canal de correo en general. */
async function canalDeCorreo(userId) {
    return db.query(
        `SELECT enabled FROM notificaciones.notification_preferences WHERE user_id = $1 AND channel = 'email'`,
        [userId]
    );
}

/** Tipos de correo que el usuario puede activar o desactivar. */
async function tiposConfigurables() {
    const { rows } = await db.query(
            'SELECT code, is_critical FROM notificaciones.email_notification_types WHERE user_configurable'
        );
    return rows;
}

/** UPSERT de la preferencia de un tipo de correo. */
async function guardarPreferencia(userId, tipo, valor) {
    return db.query(
            `INSERT INTO notificaciones.email_preferences (user_id, notification_type, enabled)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, notification_type)
             DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
            [userId, tipo, valor]
        );
}

/** Registra un job 'undeliverable' (destinatario sin correo valido). Idempotente por dedupe_key. */
async function encolarNoEntregable(userId, tipo, dedupeKey, notificationId, usuario, idiomaPedido) {
    const { rows } = await db.query(
            `INSERT INTO notificaciones.email_jobs
                 (user_id, notification_type, dedupe_key, notification_id, to_email,
                  language, status, max_attempts, last_error, finished_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'undeliverable', 0, $7, now())
             ON CONFLICT (dedupe_key) DO NOTHING
             RETURNING id`,
            [userId, tipo, dedupeKey, notificationId, usuario.email || null, idiomaPedido,
             'el destinatario no tiene un correo valido registrado']
        );
    return rows;
}

/** Encola un correo ya renderizado. Idempotente por dedupe_key. */
async function encolar(userId, tipo, dedupeKey, notificationId, usuario, plantilla, contenido, MAX_INTENTOS) {
    const { rows } = await db.query(
        `INSERT INTO notificaciones.email_jobs
             (user_id, notification_type, dedupe_key, notification_id, to_email, language,
              template_id, template_version, subject, body_html, body_text, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING id`,
        [userId, tipo, dedupeKey, notificationId, usuario.email.trim(), plantilla.language,
         plantilla.id, plantilla.version, contenido.subject, contenido.html, contenido.text,
         MAX_INTENTOS]
    );
    return rows;
}

/** Refleja el resultado del correo en notification_deliveries (no pisa una 'leida'). */
async function reflejarEntrega(job, estado, error) {
    // La columna de fecha depende del resultado; no viene del usuario.
    const columna = estado === 'entregada' ? 'delivered_at' : 'failed_at';
    return db.query(
        `INSERT INTO notificaciones.notification_deliveries (notification_id, channel, status, error, ${columna})
         VALUES ($1, 'email', $2, $3, now())
         ON CONFLICT (notification_id, channel) DO UPDATE
            SET status = EXCLUDED.status,
                error = EXCLUDED.error,
                ${columna} = EXCLUDED.${columna}
          WHERE notification_deliveries.status <> 'leida'`,
        [job.notification_id, estado, error]
    );
}

/** Historial de intentos de un job (uno por numero de intento). */
async function registrarIntento(job, resultado, codigo, detalle) {
    return db.query(
        `INSERT INTO notificaciones.email_job_attempts (job_id, attempt_no, outcome, error_code, error_detail)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (job_id, attempt_no) DO NOTHING`,
        [job.id, job.attempts, resultado, codigo, detalle]
    );
}

/** Job sin SMTP configurado: queda en 'skipped'. */
async function marcarOmitido(job) {
    return db.query(
            `UPDATE notificaciones.email_jobs SET status = 'skipped', finished_at = now() WHERE id = $1`,
            [job.id]
        );
}

/** Job enviado. */
async function marcarEnviado(job) {
    return db.query(
            `UPDATE notificaciones.email_jobs
                SET status = 'sent', sent_at = now(), finished_at = now(), last_error = NULL
              WHERE id = $1`,
            [job.id]
        );
}

/** Job fallido definitivo. */
async function marcarFallido(job, detalle) {
    return db.query(
                `UPDATE notificaciones.email_jobs
                    SET status = 'failed', last_error = $2, finished_at = now()
                  WHERE id = $1`,
                [job.id, detalle]
            );
}

/** Vuelve a 'pending' con backoff (segundos de espera). */
async function reprogramar(job, detalle, espera) {
    return db.query(
                `UPDATE notificaciones.email_jobs
                    SET status = 'pending', last_error = $2,
                        next_attempt_at = now() + ($3 || ' seconds')::interval
                  WHERE id = $1`,
                [job.id, detalle, String(espera)]
            );
}

/** Devuelve a 'pending' los jobs que quedaron en 'processing' mas de N minutos. */
async function devolverHuerfanos(MINUTOS_JOB_HUERFANO) {
    const { rows } = await db.query(
        `UPDATE notificaciones.email_jobs
            SET status = 'pending'
          WHERE status = 'processing'
            AND next_attempt_at < now() - ($1 || ' minutes')::interval
          RETURNING id`,
        [String(MINUTOS_JOB_HUERFANO)]
    );
    return rows;
}

/** Cantidad de jobs por estado. */
async function contarPorEstado() {
    const { rows } = await db.query(
        'SELECT status, COUNT(*)::int AS total FROM notificaciones.email_jobs GROUP BY status'
    );
    return rows;
}

/** Jobs fallidos o con reintentos, con su historial de intentos. */
async function jobsConProblemas() {
    const { rows } = await db.query(
        `SELECT j.id, j.notification_type, j.user_id, j.to_email, j.status,
                j.attempts, j.max_attempts, j.last_error, j.created_at, j.finished_at,
                COALESCE(
                    json_agg(json_build_object(
                        'intento', a.attempt_no, 'resultado', a.outcome,
                        'codigo', a.error_code, 'detalle', a.error_detail, 'en', a.attempted_at
                    ) ORDER BY a.attempt_no) FILTER (WHERE a.id IS NOT NULL),
                    '[]'
                ) AS intentos
           FROM notificaciones.email_jobs j
           LEFT JOIN notificaciones.email_job_attempts a ON a.job_id = j.id
          WHERE j.status IN ('failed', 'undeliverable')
          GROUP BY j.id
          ORDER BY j.id DESC
          LIMIT 20`
    );
    return rows;
}

module.exports = {
    bloquearSiguientePendiente,
    marcarProcesando,
    tipoDeCorreo,
    preferenciaDeCorreo,
    preferenciasPorTipo,
    canalDeCorreo,
    tiposConfigurables,
    guardarPreferencia,
    encolarNoEntregable,
    encolar,
    reflejarEntrega,
    registrarIntento,
    marcarOmitido,
    marcarEnviado,
    marcarFallido,
    reprogramar,
    devolverHuerfanos,
    contarPorEstado,
    jobsConProblemas
};
