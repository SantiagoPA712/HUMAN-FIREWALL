/**
 * Repositorio de notificaciones de resultados (servicio de notificaciones).
 *
 * Capa Infrastructure / Persistence (seccion 11 del material): preferencias
 * por canal (notification_preferences) y entregas por canal
 * (notification_deliveries) de los avisos de resultado.
 * Las funciones que participan de una transaccion reciben `tx` (el cliente
 * que abre application/ con conTransaccion); sin `tx` usan el pool.
 */

const db = require('../../../../compartido/config/db');

const q = (tx) => tx || db;

/** Preferencias por canal (in_app, email) del usuario. */
async function canalesDe(userId) {
    const { rows } = await db.query(
        'SELECT channel, enabled FROM notificaciones.notification_preferences WHERE user_id = $1',
        [userId]
    );
    return rows;
}

/** UPSERT de la preferencia de un canal. */
async function guardarCanal(userId, canal, habilitado) {
    return db.query(
            `INSERT INTO notificaciones.notification_preferences (user_id, channel, enabled)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, channel)
             DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
            [userId, canal, habilitado]
        );
}

/** Registra la entrega de un aviso por un canal. No duplica ni pisa la fecha original si el bus reprocesa. */
/** Columna de fecha de cada estado de entrega. */
const COLUMNA_DE_FECHA = {
    generada:  'generated_at',
    entregada: 'delivered_at',
    fallida:   'failed_at',
    leida:     'read_at'
};

async function insertarEntrega(notificationId, canal, estado, error) {
    const columnaFecha = COLUMNA_DE_FECHA[estado];
    const { rows } = await db.query(
        `INSERT INTO notificaciones.notification_deliveries (notification_id, channel, status, error, ${columnaFecha})
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (notification_id, channel) DO NOTHING
         RETURNING id, channel, status`,
        [notificationId, canal, estado, error]
    );
    return rows;
}

/** Id del aviso con esa clave de deduplicacion. */
async function idPorDedupe(dedupeKey) {
    const { rows } = await db.query(
        'SELECT id FROM notificaciones.notifications WHERE dedupe_key = $1', [dedupeKey]
    );
    return rows;
}

/** Resultados notificados al usuario con el estado de cada canal. */
async function centroDe(userId, EVENTOS_DE_RESULTADO, soloNoLeidas, limit) {
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
           FROM notificaciones.notifications n
           JOIN notificaciones.notification_deliveries app
             ON app.notification_id = n.id AND app.channel = 'in_app'
           LEFT JOIN notificaciones.notification_deliveries d ON d.notification_id = n.id
          WHERE n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND ($3::boolean = false OR app.status <> 'leida')
          GROUP BY n.id, app.read_at, app.status
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT $4`,
        [userId, EVENTOS_DE_RESULTADO, soloNoLeidas, limit]
    );
    return rows;
}

/** Resultados sin leer en la aplicacion. */
async function contarResultadosNoLeidos(userId, EVENTOS_DE_RESULTADO) {
    return db.query(
        `SELECT COUNT(*)::int AS no_leidas
           FROM notificaciones.notifications n
           JOIN notificaciones.notification_deliveries app
             ON app.notification_id = n.id AND app.channel = 'in_app'
          WHERE n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND app.status <> 'leida'`,
        [userId, EVENTOS_DE_RESULTADO]
    );
}

/** Marca como leidos todos los avisos de resultado del usuario. */
async function marcarResultadosLeidos(userId, EVENTOS_DE_RESULTADO) {
    const { rows } = await db.query(
        `UPDATE notificaciones.notifications
            SET read_at = now()
          WHERE user_id = $1
            AND event_name = ANY($2::text[])
            AND read_at IS NULL
          RETURNING id`,
        [userId, EVENTOS_DE_RESULTADO]
    );
    return rows;
}

/** Pasa a 'leida' la entrega in-app de esos avisos. */
async function marcarEntregasLeidas(userId, EVENTOS_DE_RESULTADO) {
    const { rows } = await db.query(
        `UPDATE notificaciones.notification_deliveries d
            SET status = 'leida', read_at = now()
           FROM notificaciones.notifications n
          WHERE d.notification_id = n.id
            AND n.user_id = $1
            AND n.event_name = ANY($2::text[])
            AND d.channel = 'in_app'
            AND d.status <> 'leida'
          RETURNING d.id`,
        [userId, EVENTOS_DE_RESULTADO]
    );
    return rows;
}

module.exports = {
    canalesDe,
    guardarCanal,
    insertarEntrega,
    idPorDedupe,
    centroDe,
    contarResultadosNoLeidos,
    marcarResultadosLeidos,
    marcarEntregasLeidas
};
