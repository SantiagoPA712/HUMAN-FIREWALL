/**
 * Servicio de notificaciones.
 *
 * Es el ejemplo mas claro de lo que gana la arquitectura basada en eventos:
 * este archivo se agrego DESPUES, y no hubo que tocar una sola linea de
 * auth.service, levels.service ni rewards.service para que empezara a avisar.
 * Se suscribe a lo que ya se publicaba y listo.
 *
 * Escucha:
 *   user.registered -> correo de bienvenida
 *   level_up        -> aviso de nivel nuevo
 *   reward_granted  -> aviso de recompensa obtenida
 *
 * Todo lo que manda queda tambien guardado en la tabla notifications, asi que
 * el usuario lo ve dentro de la aplicacion aunque no haya SMTP configurado
 * (que es el caso por defecto del proyecto).
 */

const config = require('../config/configuracion');
const identidad = require('../infrastructure/client/identidad.cliente');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const repo = require('../infrastructure/persistence/notificaciones.repositorio');

// nodemailer ya es dependencia del proyecto. Se carga perezosamente para que
// el modulo se pueda importar en las pruebas sin arrastrar la libreria.
let transporte = null;
let transporteResuelto = false;

/**
 * Devuelve el transporte de correo, o null si no hay SMTP configurado.
 *
 * Sin configuracion NO se lanza error: el aviso igual queda en la bandeja de
 * la aplicacion. Un proyecto de clase corriendo en localhost no tiene por que
 * fallar al registrar un usuario porque nadie definio un servidor de correo.
 */
function obtenerTransporte() {
    if (transporteResuelto) return transporte;
    transporteResuelto = true;

    if (!config.smtp.host) {
        console.log('[notifications] sin SMTP_HOST: los avisos quedan solo en la aplicacion');
        return (transporte = null);
    }

    try {
        const nodemailer = require('nodemailer');
        transporte = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: config.smtp.user
                ? { user: config.smtp.user, pass: config.smtp.pass }
                : undefined
        });
    } catch (err) {
        console.warn(`[notifications] no se pudo crear el transporte: ${err.message}`);
        transporte = null;
    }

    return transporte;
}

/** Correo del destinatario. */
async function obtenerCorreo(userId) {
    return identidad.correoDe(userId);
}

/**
 * Plantillas por evento.
 *
 * Cada una recibe el payload del evento y devuelve el aviso, o null si ese
 * caso concreto no merece notificacion. La dedupeKey es lo que hace seguro el
 * reintento del worker: identifica el HECHO, no el intento.
 */
const PLANTILLAS = {
    [EVENTOS.USER_REGISTERED]: ({ userId, email, provider }) => ({
        title: 'Bienvenido a Human Firewall',
        body: `Tu cuenta (${email}) quedo activa. Empeza por el primer curso ` +
              `asignado y suma tus primeros puntos.`,
        // Un usuario se registra una sola vez: el id basta como clave.
        dedupeKey: `welcome:${userId}`,
        payload: { provider }
    }),

    [EVENTOS.LEVEL_UP]: ({ userId, nivel, nombre, puntos }) => ({
        title: `Subiste al nivel ${nivel}: ${nombre}`,
        body: `Llegaste a ${puntos} puntos y alcanzaste el nivel "${nombre}". ` +
              `Segui asi para desbloquear el siguiente.`,
        // Por NIVEL, no por evento: si el worker reintenta, o si el nivel se
        // recalcula, el usuario no recibe el mismo aviso dos veces.
        dedupeKey: `level:${userId}:${nivel}`,
        payload: { nivel, nombre, puntos }
    }),

    [EVENTOS.REWARD_GRANTED]: ({ userId, rewardId, rewardName, userRewardId }) => ({
        title: `Nueva recompensa: ${rewardName}`,
        body: `Desbloqueaste "${rewardName}". Podes verla en tu perfil.`,
        // Se usa userRewardId y no rewardId: hay recompensas repetibles, y
        // cada vez que se vuelve a ganar merece su propio aviso.
        dedupeKey: `reward:${userId}:${userRewardId}`,
        payload: { rewardId, rewardName }
    })
};

/**
 * Guarda el aviso SIN mandar ningun correo.
 *
 * Existe por el criterio tecnico 3 de la HU de notificacion de resultados: el
 * correo se manda solo si el destinatario tiene ese canal habilitado, y
 * notificar() lo manda siempre que haya SMTP configurado. Quien necesita
 * decidir por canal crea el aviso con esta funcion y despues, si corresponde,
 * llama a reenviarCorreo().
 *
 * No cambia el comportamiento de nadie: notificar() sigue haciendo lo mismo de
 * siempre para los avisos de registro, nivel y recompensa.
 *
 * @returns {Promise<object|null>} la notificacion creada, o null si ya existia
 */
async function crearSinEnviar(eventName, aviso, userId) {
    const rows = await repo.insertar(userId, eventName, aviso);

    return rows[0] || null;
}

/**
 * Guarda el aviso y, si hay SMTP, lo manda por correo.
 *
 * @returns {Promise<object|null>} la notificacion creada, o null si ya existia
 */
async function notificar(eventName, aviso, userId) {
    // ON CONFLICT sobre dedupe_key: si el worker reintenta este evento porque
    // otro handler fallo, aca no se inserta nada y no sale un segundo correo.
    const rows = await repo.insertar(userId, eventName, aviso);

    if (rows.length === 0) return null;   // ya se habia notificado este hecho

    const notificacion = rows[0];
    const emisor = obtenerTransporte();

    if (!emisor) {
        console.log(`[notifications] ${eventName} -> usuario ${userId}: ${aviso.title}`);
        return notificacion;
    }

    // El envio va en su propio try. Si el correo falla NO se relanza el error:
    // relanzarlo haria que el worker reintentara el evento entero, y como la
    // fila ya esta insertada, el reintento no volveria a intentar el envio de
    // todas formas. Se deja registrado el fallo y se sigue. Un servidor SMTP
    // caido no puede bloquear la asignacion de puntos ni el registro.
    try {
        const destinatario = await obtenerCorreo(userId);
        if (!destinatario) throw new Error(`el usuario ${userId} no tiene correo`);

        await emisor.sendMail({
            from: config.remitente,
            to: destinatario,
            subject: aviso.title,
            text: aviso.body
        });

        await repo.marcarCorreoEnviado(notificacion);
    } catch (err) {
        await repo.marcarCorreoFallido(err, notificacion);
        console.warn(`[notifications] no se pudo enviar el correo ${notificacion.id}: ${err.message}`);
    }

    return notificacion;
}

/**
 * Reintenta el envio por correo de un aviso YA creado.
 *
 * Existe por el criterio tecnico 4 de la HU de reportes automaticos, que exige
 * reintentar el envio hasta tres veces con backoff. notificar() no sirve para
 * eso: en el segundo intento el ON CONFLICT sobre dedupe_key no inserta nada y
 * devuelve null, asi que el correo nunca se volveria a mandar.
 *
 * No cambia el comportamiento de nadie mas: es una funcion nueva, y quien no
 * la llama sigue viendo el mismo servicio de antes.
 *
 * @param {object} ref
 * @param {number} [ref.id]         id de la notificacion
 * @param {string} [ref.dedupeKey]  o su clave de deduplicacion
 * @returns {Promise<'sent'|'failed'|'skipped'|'not_found'>} estado del correo
 */
async function reenviarCorreo({ id = null, dedupeKey = null } = {}) {
    const rows = await repo.buscarParaReenvio(id, dedupeKey);

    const notificacion = rows[0];
    if (!notificacion) return 'not_found';

    // Ya salio: reintentarlo mandaria el mismo correo dos veces.
    if (notificacion.email_status === 'sent') return 'sent';

    // Sin SMTP no hay nada que reintentar, y tampoco nada que reportar como
    // fallo: el aviso ya esta en la bandeja de la aplicacion, que es el modo
    // por defecto del proyecto.
    const emisor = obtenerTransporte();
    if (!emisor) return 'skipped';

    try {
        const destinatario = await obtenerCorreo(notificacion.user_id);
        if (!destinatario) throw new Error(`el usuario ${notificacion.user_id} no tiene correo`);

        await emisor.sendMail({
            from: config.remitente,
            to: destinatario,
            subject: notificacion.title,
            text: notificacion.body
        });

        await repo.marcarCorreoReenviado(notificacion);
        return 'sent';

    } catch (err) {
        await repo.marcarCorreoFallido(err, notificacion);
        console.warn(`[notifications] reintento fallido del correo ${notificacion.id}: ${err.message}`);
        return 'failed';
    }
}

/** Handler generico: arma el aviso con la plantilla del evento y lo manda. */
async function manejar(eventName, payload) {
    const plantilla = PLANTILLAS[eventName];
    if (!plantilla) return null;
    if (!payload || !payload.userId) return null;

    const aviso = plantilla(payload);
    if (!aviso) return null;

    return notificar(eventName, aviso, payload.userId);
}

/** Bandeja de un usuario. */
async function obtenerBandeja(userId, { soloNoLeidas = false, limit = 30 } = {}) {
    const rows = await repo.bandejaDe(userId, soloNoLeidas, limit);

    const contador = await repo.contarNoLeidas(userId);

    return {
        user_id: userId,
        no_leidas: contador[0].no_leidas,
        notificaciones: rows
    };
}

/** Marca una notificacion como leida. Solo el dueno puede hacerlo. */
async function marcarLeida(userId, notificationId) {
    const rows = await repo.marcarLeida(notificationId, userId);
    return rows[0] || null;
}

/** Conecta el servicio al bus. Se llama una vez desde events/suscriptores.js. */
function registrarHandlers() {
    for (const evento of Object.keys(PLANTILLAS)) {
        eventBus.subscribe(evento, payload => manejar(evento, payload));
    }
    console.log('[notifications.service] handlers registrados');
}

module.exports = {
    PLANTILLAS,
    notificar,
    crearSinEnviar,
    reenviarCorreo,
    manejar,
    obtenerBandeja,
    marcarLeida,
    registrarHandlers
};
