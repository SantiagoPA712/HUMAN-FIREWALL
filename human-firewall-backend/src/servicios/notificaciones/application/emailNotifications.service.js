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
 *   - La invitacion de la HU de invitaciones (user.invited), que va a una
 *     direccion sin cuenta: por eso encolar() acepta un destinatario suelto.
 *   - resultNotifications.service, para el canal de correo de los resultados
 *     de evaluaciones. Ese modulo decide QUE resultado se avisa y a QUIEN;
 *     este decide COMO sale el correo. Ninguno de los dos arma HTML: eso lo
 *     hace la plantilla (emailTemplates.service).
 */

const config = require('../config/configuracion');
const { conTransaccion } = require('../infrastructure/persistence/conexion');
const identidad = require('../infrastructure/client/identidad.cliente');
const cursos = require('../infrastructure/client/cursos.cliente');
const { esCorreoValido } = require('../../../compartido/utils/correo');
const eventBus = require('../../../compartido/eventos/eventBus');
const { EVENTOS } = require('../../../compartido/eventos/catalogo');
const plantillas = require('./emailTemplates.service');
const { CODIGOS_DE_RED, esErrorTransitorio } = require('../domain/entrega');
const repo = require('../infrastructure/persistence/correos.repositorio');

// ---------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------

/** Tipos de correo. Son las filas de email_notification_types (migracion 034). */
const TIPOS = {
    COURSE_ASSIGNED:           'course_assigned',
    DEADLINE_APPROACHING:      'deadline_approaching',
    EVALUATION_RESULT:         'evaluation_result',
    CRITICAL_COURSE_ALERT:     'critical_course_alert',
    SECURITY_PASSWORD_CHANGED: 'security_password_changed',
    // HU de invitaciones (migracion 035). Va a alguien que todavia no tiene
    // cuenta, asi que no figura en las preferencias de nadie.
    USER_INVITATION:           'user_invitation'
};

/**
 * Criterio tecnico 3: "reintentar hasta 3 veces con backoff exponencial antes
 * de marcar el envio como fallido".
 */
const MAX_REINTENTOS = 3;

/**
 * Intentos totales de un job: el primero mas los reintentos. Es lo que se
 * guarda en email_jobs.max_attempts, y el worker corta al llegar a ese numero.
 *
 * FALLO CORREGIDO: el job se encolaba con max_attempts = MAX_REINTENTOS. La
 * columna cuenta intentos TOTALES, asi que con el proveedor caido se hacian
 * 1 intento + 2 reintentos y el correo se daba por fallido un reintento antes
 * de lo que pide el criterio tecnico 3. Si el proveedor volvia justo para el
 * tercer reintento, el usuario se quedaba sin su notificacion.
 */
const MAX_INTENTOS = MAX_REINTENTOS + 1;

/**
 * Base del backoff, en segundos. La espera antes del reintento n es
 * base * 2^(n-1): 30, 60 y 120 s con el valor por defecto. Sumados quedan
 * holgadamente dentro de los 5 minutos del criterio de aceptacion 1, y un
 * proveedor que se cayo un instante tiene tiempo de volver.
 */
const BACKOFF_BASE_SEGUNDOS = config.segundosBaseDeReintento;

/** Cada cuanto mira la cola el worker. Es la red de seguridad del despertar inmediato. */
const INTERVALO_WORKER_MS = config.segundosEntreCorridasDelWorker * 1000;

// La ventana y la frecuencia de las fechas limite proximas
// (EMAIL_DEADLINE_WINDOW_HOURS, EMAIL_DEADLINE_SCAN_MINUTES) ahora las usa el
// servicio de cursos, que es el dueno de las asignaciones y publica
// course.deadline_approaching. Este servicio solo consume ese evento.

/** Un job en 'processing' por mas de esto quedo huerfano de un proceso caido. */
const MINUTOS_JOB_HUERFANO = 10;

/** Contra que se arman los enlaces del correo (criterio de aceptacion 1). */
function urlBase() {
    return config.urlBase;
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

    if (!config.smtp.host) return (transporte = null);

    try {
        const nodemailer = require('nodemailer');
        transporte = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: config.smtp.user
                ? { user: config.smtp.user, pass: config.smtp.pass }
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

// esCorreoValido se movio a compartido/utils/correo.js (tambien la usa identidad).

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
    const rows = await repo.tipoDeCorreo(tipo);
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
    const rows = await repo.preferenciaDeCorreo(userId, tipo);
    return rows[0].canal && rows[0].tipo;
}

/** Preferencias de correo de un usuario, con los valores por defecto resueltos. */
async function obtenerPreferencias(userId) {
    const tipos = await repo.preferenciasPorTipo(userId);

    // El idioma es un dato de la cuenta (identidad); el canal es de este servicio.
    const contacto = await identidad.obtenerContacto(userId);
    const { rows: [canal] } = await repo.canalDeCorreo(userId);
    const usuario = contacto
        ? { language: contacto.language, canal_email: canal ? canal.enabled : true }
        : null;

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
        const catalogo = await repo.tiposConfigurables();
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
        await repo.guardarPreferencia(userId, tipo, valor);
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
        timeZone: config.zonaHoraria
    }).format(fecha);
}

/**
 * Como se nombra a quien recibe el correo. El nombre completo si lo cargo
 * (users.full_name, migracion 035); si no, la parte local del correo:
 * "ana.perez@empresa.com" -> "ana.perez".
 */
function nombreVisible(usuario) {
    if (usuario.full_name) return usuario.full_name;
    return String(usuario.email || '').split('@')[0] || 'usuario';
}

/**
 * Nombre legible de un rol en el idioma del correo. Es presentacion, igual
 * que el formato de las fechas: el modulo que encola manda el codigo
 * ('rh') y el correo dice "Recursos Humanos" o "Human Resources".
 */
const ETIQUETAS_ROL = {
    es: { employee: 'Empleado', instructor: 'Instructor', rh: 'Recursos Humanos',
          admin: 'Administrador', security: 'Seguridad', manager: 'Gerencia' },
    en: { employee: 'Employee', instructor: 'Instructor', rh: 'Human Resources',
          admin: 'Administrator', security: 'Security', manager: 'Management' }
};

/**
 * Variables que recibe la plantilla. Las fechas se formatean en el idioma del
 * correo y la ruta relativa se convierte en un enlace absoluto: en un correo
 * "/performance" no lleva a ningun lado.
 */
function prepararVariables(datos, usuario, idioma) {
    const variables = { nombre: nombreVisible(usuario), ...datos };

    if (datos.rol) variables.rol = ETIQUETAS_ROL[idioma]?.[datos.rol] || datos.rol;

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
 * @param {number} [p.userId]        destinatario con cuenta
 * @param {object} [p.destinatario]  { email, language? } para quien todavia no
 *                                   tiene cuenta (invitaciones). Sin cuenta no
 *                                   hay preferencias que consultar.
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
async function encolar({ userId = null, destinatario = null, tipo, datos = {}, dedupeKey, notificationId = null }) {
    if (!dedupeKey) throw new Error('encolar() necesita dedupeKey');
    if (!userId && !destinatario) throw new Error('encolar() necesita userId o destinatario');

    const info = await obtenerTipo(tipo);
    if (!info) throw new Error(`tipo de correo desconocido: ${tipo}`);

    // Criterio tecnico 5: la preferencia se mira ANTES de encolar, y omitir no
    // es un error ni deja registro de fallo. Los criticos no la consultan, y
    // quien no tiene cuenta no tiene preferencias.
    if (userId && !info.is_critical && !(await quiereRecibir(userId, tipo))) {
        return { estado: 'omitido' };
    }

    let usuario;
    if (userId) {
        usuario = await identidad.obtenerContacto(userId);
        if (!usuario) {
            console.warn(`[email] ${tipo}: el usuario ${userId} no existe, no hay a quien escribirle`);
            return { estado: 'sin_usuario' };
        }
    } else {
        usuario = { id: null, email: destinatario.email, language: destinatario.language || null };
    }

    const idiomaPedido = plantillas.resolverIdioma(usuario.language);

    // Criterio tecnico 4: sin direccion valida se descarta sin reintentar y
    // queda registrado como no entregable. Se registra igual que un job, para
    // que soporte lo encuentre donde busca los demas correos.
    if (!esCorreoValido(usuario.email)) {
        const rows = await repo.encolarNoEntregable(userId, tipo, dedupeKey, notificationId, usuario, idiomaPedido);
        console.warn(
            `[email] ${tipo} -> ${userId ? `usuario ${userId}` : 'destinatario sin cuenta'}: no entregable, correo invalido ` +
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

    const rows = await repo.encolar(userId, tipo, dedupeKey, notificationId, usuario, plantilla, contenido, MAX_INTENTOS);

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

    await repo.reflejarEntrega(job, estado, error);
}

async function registrarIntento(job, resultado, err = null) {
    const codigo = err ? String(err.code || err.responseCode || err.statusCode || '').slice(0, 50) || null : null;
    const detalle = err ? detalleTecnico(err) : null;
    await repo.registrarIntento(job, resultado, codigo, detalle);
}

/**
 * Toma el proximo job vencido y lo marca como 'processing'.
 *
 * FOR UPDATE SKIP LOCKED, igual que el outbox: con varias instancias del
 * servidor, dos workers nunca toman el mismo correo.
 */
async function tomarSiguiente() {
    return conTransaccion(async (tx) => {
        const siguiente = await repo.bloquearSiguientePendiente(tx);
        if (!siguiente) return null;
        return repo.marcarProcesando(siguiente.id, tx);
    });
}

/**
 * Intenta enviar un job ya tomado.
 *
 * @returns {Promise<'sent'|'retry'|'failed'|'skipped'>}
 */
async function enviar(job) {
    const emisor = obtenerTransporte();

    if (!emisor) {
        await repo.marcarOmitido(job);
        console.log(`[email] sin SMTP_HOST: job ${job.id} (${job.notification_type}) -> ${job.to_email}: "${job.subject}"`);
        return 'skipped';
    }

    try {
        await emisor.sendMail({
            from: config.remitente,
            to: job.to_email,
            subject: job.subject,
            html: job.body_html,
            text: job.body_text
        });

        await registrarIntento(job, 'sent');
        await repo.marcarEnviado(job);
        await reflejarEnEntrega(job, 'entregada');
        return 'sent';

    } catch (err) {
        const transitorio = esErrorTransitorio(err);
        const agotado = !transitorio || job.attempts >= job.max_attempts;
        const detalle = detalleTecnico(err);

        await registrarIntento(job, transitorio ? 'transient_error' : 'permanent_error', err);

        if (agotado) {
            await repo.marcarFallido(job, detalle);
            await reflejarEnEntrega(job, 'fallida', detalle.slice(0, 500));
        } else {
            const espera = BACKOFF_BASE_SEGUNDOS * Math.pow(2, job.attempts - 1);
            await repo.reprogramar(job, detalle, espera);
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
    const rows = await repo.devolverHuerfanos(MINUTOS_JOB_HUERFANO);
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
// Handlers
// ---------------------------------------------------------------------

async function tituloDeCurso(courseId) {
    return (await cursos.obtenerTitulo(courseId))?.title || `curso ${courseId}`;
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

/**
 * Correo de invitacion (HU de invitaciones). El token viaja en el evento
 * porque es la unica forma de armar el enlace: en user_invitations solo esta
 * su hash. Cada envio (el original y cada reenvio) es un correo distinto.
 */
async function alInvitar({ invitationId, email, role, language, token, expiresAt, invitedByEmail, sendNo }) {
    if (!invitationId || !token) return null;
    return encolar({
        destinatario: { email, language },
        tipo: TIPOS.USER_INVITATION,
        dedupeKey: `invitation:${invitationId}:${sendNo}`,
        datos: {
            invitador: invitedByEmail || 'El equipo de Human Firewall',
            rol: role,
            fechaLimite: expiresAt,
            ruta: `/invitacion?token=${encodeURIComponent(token)}`
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
    const rows = await repo.contarPorEstado();
    const porEstado = { pending: 0, processing: 0, sent: 0, failed: 0, undeliverable: 0, skipped: 0 };
    for (const r of rows) porEstado[r.status] = r.total;

    const problemas = await repo.jobsConProblemas();

    return { por_estado: porEstado, ultimos_con_problemas: problemas };
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

let timerWorker = null;

/** Arranca el worker de la cola. Se llama desde conectarTodo(). */
function iniciarWorker() {
    if (timerWorker) return;
    workerActivo = true;

    timerWorker = setInterval(
        () => procesarPendientes().catch(e => console.error('[email] worker:', e.message)),
        INTERVALO_WORKER_MS
    );
    if (timerWorker.unref) timerWorker.unref();

    console.log(
        `[email] worker cada ${INTERVALO_WORKER_MS / 1000} s` +
        (config.smtp.host ? '' : ' -- sin SMTP_HOST: los correos quedan en skipped')
    );
}

function detenerWorker() {
    workerActivo = false;
    if (timerWorker) { clearInterval(timerWorker); timerWorker = null; }
}

function registrarHandlers() {
    eventBus.subscribe(EVENTOS.COURSE_ASSIGNED, alAsignarCurso);
    eventBus.subscribe(EVENTOS.COURSE_DEADLINE_APPROACHING, alAcercarseLaFechaLimite);
    eventBus.subscribe(EVENTOS.USER_PASSWORD_CHANGED, alCambiarContrasena);
    eventBus.subscribe(EVENTOS.USER_INVITED, alInvitar);
    console.log('[emailNotifications.service] handlers registrados');
}

module.exports = {
    TIPOS,
    MAX_REINTENTOS,
    MAX_INTENTOS,
    BACKOFF_BASE_SEGUNDOS,
    esCorreoValido,
    esErrorTransitorio,
    usarTransporte,
    quiereRecibir,
    obtenerPreferencias,
    actualizarPreferencias,
    encolar,
    procesarPendientes,
    alAsignarCurso,
    alAcercarseLaFechaLimite,
    alCambiarContrasena,
    alInvitar,
    estadoDeLaCola,
    iniciarWorker,
    detenerWorker,
    registrarHandlers
};
