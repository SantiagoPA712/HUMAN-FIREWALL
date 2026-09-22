/**
 * Pruebas de la HU de notificacion de resultados.
 *
 * Lo que se verifica:
 *
 *   - que el aviso se arme con los datos que trae el evento, sin recalcular,
 *   - que el dueno del resultado siempre se entere, y que al reprobar reciba
 *     las opciones para reintentar,
 *   - que RH solo entre cuando el curso esta marcado como critico,
 *   - que los canales se respeten por destinatario y que el estado de lectura
 *     sea independiente por canal,
 *   - que reprocesar el evento no genere un segundo aviso ni una segunda
 *     entrega,
 *   - y que el estado de cada entrega quede registrado con su timestamp.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

const adapter = {
    query: (t, p) => pg.query(t, p),
    connect: async () => ({ query: (t, p) => pg.query(t, p), release: () => {} })
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const resultados = require_('./services/resultNotifications.service');
const controller = require_('./controllers/resultNotifications.controller');
const { requireRoles } = require_('./middlewares/role.middleware');
const eventBus = require_('./services/eventBus');
const catalogo = require_('./events/catalogo');
const suscriptores = require_('./events/suscriptores');

const { EVENTOS } = catalogo;
const suscritos = suscriptores.conectarTodo({ iniciarWorker: false });

const llamar = async (handler, req) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ params: {}, body: {}, query: {}, ...req }, res);
    return { estado, cuerpo };
};

// ---------------------------------------------------------------------
console.log('--- EL HECHO SE PUBLICA EN EL ORIGEN (criterio tecnico 1) ---');

check('quiz.failed esta en el catalogo de eventos',
    catalogo.NOMBRES_VALIDOS.has('quiz.failed'));
check('y tiene suscriptor registrado en el bus',
    suscritos['quiz.failed'] === 1, `(tiene ${suscritos['quiz.failed']})`);
check('los cuatro eventos de resultado tienen quien los escuche',
    ['quiz.approved', 'quiz.failed', 'course.completed', 'simulation.completed']
        .every(e => (suscritos[e] || 0) > 0));

// El desafio reprobado publica el evento: se ejercita el controlador real.
await pg.exec(`
  INSERT INTO users (email, password, role, team_id) VALUES
    ('ana@hf.com',   'x', 'employee', 1),
    ('beto@hf.com',  'x', 'employee', 2),
    ('rh1@hf.com',   'x', 'rh',       1),
    ('rhotro@hf.com','x', 'rh',       3);
`);
const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const ana = await idDe('ana@hf.com');
const beto = await idDe('beto@hf.com');
const rhDelEquipo = await idDe('rh1@hf.com');
const rhDeOtroEquipo = await idDe('rhotro@hf.com');

const gamification = require_('./controllers/gamification.controller');

await llamar(gamification.completeChallenge, {
    user: { id: ana, role: 'employee' },
    body: { challengeId: 'password', passed: false, score: 35 }
});

const { rows: encolados } = await pg.query(
    `SELECT event_name, payload FROM event_outbox WHERE event_name = 'quiz.failed'`
);
check('reprobar un desafio publica quiz.failed', encolados.length === 1);
check('el evento lleva el puntaje YA calculado por el modulo de origen',
    encolados[0]?.payload?.score === 35, `(${JSON.stringify(encolados[0]?.payload)})`);
check('y el numero de intento, que distingue un fallo de otro',
    encolados[0]?.payload?.attemptNo === 1);

const { rows: aprobados } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM event_outbox WHERE event_name = 'quiz.approved'`
);
check('reprobar NO publica quiz.approved', aprobados[0].n === 0);

const { rows: puntos } = await pg.query(`SELECT COUNT(*)::int AS n FROM points_ledger`);
check('y reprobar sigue sin otorgar puntos', puntos[0].n === 0);

// ---------------------------------------------------------------------
console.log('\n--- AVISO AL DUENO DEL RESULTADO (criterio de aceptacion 1) ---');

await eventBus.procesarPendientes();

const { rows: avisoAna } = await pg.query(
    `SELECT title, body, payload FROM notifications WHERE user_id = $1 AND event_name = 'quiz.failed'`,
    [ana]
);
check('el usuario recibe el aviso de su resultado', avisoAna.length === 1);
check('el titulo nombra la evaluacion, no su id',
    /Maestro de Contrase/.test(avisoAna[0]?.title || ''), `(${avisoAna[0]?.title})`);
check('el cuerpo informa el puntaje obtenido', /35/.test(avisoAna[0]?.body || ''));
check('al reprobar trae la opcion de reintentar',
    avisoAna[0]?.payload?.reintentar_en === '/challenges',
    `(${JSON.stringify(avisoAna[0]?.payload)})`);
check('y la de reforzar antes de volver a intentar',
    avisoAna[0]?.payload?.reforzar_en === '/performance');

// Curso terminado
await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId: ana, courseId: 901 });
await eventBus.procesarPendientes();

const { rows: avisoCurso } = await pg.query(
    `SELECT title, payload FROM notifications WHERE user_id = $1 AND event_name = 'course.completed'`,
    [ana]
);
check('completar un curso tambien avisa', avisoCurso.length === 1);
check('con el titulo del curso resuelto',
    /Phishing/.test(avisoCurso[0]?.title || ''), `(${avisoCurso[0]?.title})`);

// Simulacion reprobada
const { rows: [simulacion] } = await pg.query('SELECT id, title FROM simulations ORDER BY id LIMIT 1');
await eventBus.publish(EVENTOS.SIMULATION_COMPLETED, {
    userId: ana, simulationId: simulacion.id, courseId: null,
    score: 40, aprobada: false, aciertos: 1, pasos: 3, attemptNo: 1
});
await eventBus.procesarPendientes();

const { rows: avisoSim } = await pg.query(
    `SELECT title, body, payload FROM notifications WHERE user_id = $1 AND event_name = 'simulation.completed'`,
    [ana]
);
check('una simulacion reprobada avisa con su resultado',
    avisoSim.length === 1 && /40/.test(avisoSim[0].body));
check('el aviso usa los aciertos que trajo el evento, no los recalcula',
    /1 de 3/.test(avisoSim[0]?.body || ''), `(${avisoSim[0]?.body})`);
check('y ofrece volver a intentarla',
    avisoSim[0]?.payload?.reintentar_en === `/simulation/play/${simulacion.id}`);

// ---------------------------------------------------------------------
console.log('\n--- RH Y CURSOS CRITICOS (criterio de aceptacion 2 / tecnico 2) ---');

const { rows: [rhSinCritico] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [rhDelEquipo]
);
check('con el curso sin marcar, RH no recibe nada', rhSinCritico.n === 0,
    `(recibio ${rhSinCritico.n})`);

// RH marca el curso como critico.
const sinPermiso = (rol) => {
    let estado = null, siguio = false;
    const res = { status(c) { estado = c; return this; }, json() { return this; } };
    requireRoles(['rh', 'admin'])({ user: rol ? { id: 1, role: rol } : null }, res, () => { siguio = true; });
    return { estado, siguio };
};

check('un empleado no puede marcar cursos criticos', sinPermiso('employee').estado === 403);
check('un gerente tampoco', sinPermiso('manager').estado === 403);
check('sin autenticar recibe 401', sinPermiso(null).estado === 401);
check('rh pasa', sinPermiso('rh').siguio === true);
check('admin pasa', sinPermiso('admin').siguio === true);

const marcado = await llamar(controller.patchCursoCritico, {
    user: { id: rhDelEquipo, role: 'rh' },
    params: { courseId: '902' },
    body: { is_critical: true }
});
check('RH marca un curso como critico', marcado.estado === 200 && marcado.cuerpo.is_critical === true);

const invalido = await llamar(controller.patchCursoCritico, {
    user: { id: rhDelEquipo, role: 'rh' }, params: { courseId: '902' }, body: {}
});
check('sin el campo is_critical responde 400', invalido.estado === 400);

const inexistente = await llamar(controller.patchCursoCritico, {
    user: { id: rhDelEquipo, role: 'rh' }, params: { courseId: '9999' }, body: { is_critical: true }
});
check('un curso inexistente responde 404', inexistente.estado === 404);

// Ahora si: un resultado sobre el curso critico.
await eventBus.publish(EVENTOS.QUIZ_FAILED, {
    userId: ana, quizRef: 'wifi', quizType: 'challenge',
    score: 20, passed: false, attemptNo: 1, courseId: 902
});
await eventBus.procesarPendientes();

const { rows: avisoRh } = await pg.query(
    `SELECT title, body, payload FROM notifications WHERE user_id = $1`, [rhDelEquipo]
);
check('con el curso critico, RH del equipo si recibe el aviso', avisoRh.length === 1);
check('el aviso identifica al empleado', /ana@hf\.com/.test(avisoRh[0]?.title || ''));
check('y nombra el curso critico', /Contrasenas Seguras/.test(avisoRh[0]?.title || ''),
    `(${avisoRh[0]?.title})`);
check('el payload marca que fue por un curso critico',
    avisoRh[0]?.payload?.curso_critico === true);
// El aviso a RH no puede ofrecer acciones del empleado: RH no va a rehacer el
// desafio de otra persona, y la pantalla pinta esos campos como botones.
check('y NO le ofrece a RH reintentar el intento ajeno',
    avisoRh[0]?.payload?.reintentar_en === undefined &&
    avisoRh[0]?.payload?.reforzar_en === undefined,
    `(${JSON.stringify(avisoRh[0]?.payload)})`);
check('en su lugar lo manda al reporte de desempeno',
    avisoRh[0]?.payload?.ver_desempeno_en === '/reports');

const { rows: [otroRh] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [rhDeOtroEquipo]
);
check('el RH de otro equipo no se entera', otroRh.n === 0, `(recibio ${otroRh.n})`);

// Empleado de un equipo sin RH: el aviso no se pierde. El padron incluye al
// rh@humanfirewall.com que siembra la migracion 027, asi que se cuenta contra
// la base en vez de asumir cuantos hay.
const { rows: [rhTotales] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE role = 'rh' AND is_active = true`
);
const rhsDeBeto = await resultados.destinatariosRh(beto);
check('si el equipo del empleado no tiene RH, el aviso cae en todos los RH',
    rhsDeBeto.length === rhTotales.n &&
    rhsDeBeto.includes(rhDelEquipo) && rhsDeBeto.includes(rhDeOtroEquipo),
    `(${JSON.stringify(rhsDeBeto)} de ${rhTotales.n} RH)`);

const rhsDeAna = await resultados.destinatariosRh(ana);
check('y si lo tiene, solo va al RH de su equipo',
    rhsDeAna.length === 1 && rhsDeAna[0] === rhDelEquipo, `(${JSON.stringify(rhsDeAna)})`);

// ---------------------------------------------------------------------
console.log('\n--- CANALES POR DESTINATARIO (criterio tecnico 3) ---');

const porDefecto = await resultados.obtenerPreferencias(beto);
check('sin configuracion previa, los dos canales estan habilitados',
    porDefecto.canales.in_app === true && porDefecto.canales.email === true);

const { rows: canalesAna } = await pg.query(
    `SELECT DISTINCT channel FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
      WHERE n.user_id = $1 ORDER BY channel`, [ana]
);
check('por defecto se registra entrega por los dos canales',
    canalesAna.length === 2, `(${JSON.stringify(canalesAna.map(c => c.channel))})`);

await resultados.actualizarPreferencias(ana, { email: false });

await eventBus.publish(EVENTOS.QUIZ_FAILED, {
    userId: ana, quizRef: 'social', quizType: 'challenge',
    score: 10, passed: false, attemptNo: 1, courseId: null
});
await eventBus.procesarPendientes();

const { rows: [ultimo] } = await pg.query(
    `SELECT id FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [ana]
);
const { rows: canalesUltimo } = await pg.query(
    `SELECT channel FROM notification_deliveries WHERE notification_id = $1`, [ultimo.id]
);
check('con el correo deshabilitado no se registra entrega por ese canal',
    canalesUltimo.length === 1 && canalesUltimo[0].channel === 'in_app',
    `(${JSON.stringify(canalesUltimo.map(c => c.channel))})`);

const malas = await llamar(controller.patchPreferencias, {
    user: { id: ana, role: 'employee' }, body: { email: 'si' }
});
check('una preferencia que no sea true/false se rechaza con 400', malas.estado === 400);

// ---------------------------------------------------------------------
console.log('\n--- IDEMPOTENCIA (criterio tecnico 4) ---');

// Primero se drena un reproceso para que la configuracion quede estable.
//
// Hace falta porque la prueba marco el curso 902 como critico DESPUES de que
// el primer desafio reprobado ya se habia procesado, y el desafio 'password'
// pertenece justamente a ese curso. Al reprocesarlo, la regla nueva aplica y
// el aviso a RH se genera: no es un duplicado, es un destinatario que antes no
// correspondia. Las reglas se evaluan cuando el evento se procesa, no cuando
// se publico.
await pg.query(`UPDATE event_outbox SET status = 'pending', next_attempt_at = now()`);
await eventBus.procesarPendientes();

const { rows: [antesAvisos] } = await pg.query('SELECT COUNT(*)::int AS n FROM notifications');
const { rows: [antesEntregas] } = await pg.query('SELECT COUNT(*)::int AS n FROM notification_deliveries');

await pg.query(`UPDATE event_outbox SET status = 'pending', next_attempt_at = now()`);
await eventBus.procesarPendientes();

const { rows: [despuesAvisos] } = await pg.query('SELECT COUNT(*)::int AS n FROM notifications');
const { rows: [despuesEntregas] } = await pg.query('SELECT COUNT(*)::int AS n FROM notification_deliveries');

check('reprocesar todos los eventos no genera un solo aviso nuevo',
    antesAvisos.n === despuesAvisos.n, `(${antesAvisos.n} -> ${despuesAvisos.n})`);
check('ni una entrega nueva',
    antesEntregas.n === despuesEntregas.n, `(${antesEntregas.n} -> ${despuesEntregas.n})`);

// Dos fallos del mismo desafio SI son dos avisos distintos: son dos hechos.
await eventBus.publish(EVENTOS.QUIZ_FAILED, {
    userId: ana, quizRef: 'social', quizType: 'challenge',
    score: 15, passed: false, attemptNo: 2, courseId: null
});
await eventBus.procesarPendientes();

const { rows: [dosIntentos] } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE user_id = $1 AND event_name = 'quiz.failed' AND payload->>'quizRef' = 'social'`,
    [ana]
);
check('pero dos intentos distintos del mismo desafio si generan dos avisos',
    dosIntentos.n === 2, `(dio ${dosIntentos.n})`);

// ---------------------------------------------------------------------
console.log('\n--- ESTADO DE ENTREGA (criterio tecnico 5) ---');

const { rows: entregas } = await pg.query(
    `SELECT channel, status, generated_at, delivered_at FROM notification_deliveries
      ORDER BY id LIMIT 2`
);
check('cada entrega guarda su canal y su estado',
    entregas.every(e => e.channel && e.status));
check('con el timestamp del momento en que se genero',
    entregas.every(e => e.generated_at instanceof Date));
check('una entrega in-app queda como entregada',
    entregas.some(e => e.channel === 'in_app' && e.status === 'entregada'));
check('sin SMTP configurado, la de correo queda en generada y no miente diciendo entregada',
    entregas.some(e => e.channel === 'email' && e.status === 'generada'));

const estadosValidos = await pg.query(
    `SELECT DISTINCT status FROM notification_deliveries ORDER BY status`
);
check('todos los estados registrados estan en el catalogo del criterio',
    estadosValidos.rows.every(r => resultados.ESTADOS.includes(r.status)),
    `(${JSON.stringify(estadosValidos.rows.map(r => r.status))})`);

try {
    await pg.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status)
         VALUES ($1, 'in_app', 'inventado')`, [ultimo.id]
    );
    check('la base rechaza un estado fuera del catalogo', false, '(lo acepto)');
} catch (e) {
    check('la base rechaza un estado fuera del catalogo', /check/i.test(msg(e)));
}

// ---------------------------------------------------------------------
console.log('\n--- CENTRO DE NOTIFICACIONES (criterio de aceptacion 3) ---');

const centro = await resultados.obtenerCentro(ana);
check('el centro lista los resultados del usuario', centro.resultados.length > 0);
check('en orden cronologico, del mas reciente al mas viejo',
    centro.resultados.every((r, i, arr) =>
        i === 0 || new Date(arr[i - 1].created_at) >= new Date(r.created_at)));
check('informa cuantas hay sin leer', centro.no_leidas === centro.resultados.length,
    `(${centro.no_leidas} de ${centro.resultados.length})`);
check('cada resultado trae el estado de sus canales',
    centro.resultados[0].canales.length > 0 && centro.resultados[0].canales[0].canal);

const ajeno = await resultados.obtenerCentro(beto);
check('un usuario no ve los resultados de otro', ajeno.resultados.length === 0);

const marcadas = await resultados.marcarTodasLeidas(ana);
check('marcar todas como leidas de una vez marca varias', marcadas.marcadas > 1,
    `(marco ${marcadas.marcadas})`);

const despues = await resultados.obtenerCentro(ana);
check('y el contador de no leidas queda en cero', despues.no_leidas === 0);

const { rows: leidasInApp } = await pg.query(
    `SELECT d.status FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
      WHERE n.user_id = $1 AND d.channel = 'in_app'`, [ana]
);
check('el canal in-app queda marcado como leido',
    leidasInApp.every(d => d.status === 'leida'), `(${JSON.stringify(leidasInApp.map(d => d.status))})`);

const { rows: correoNoLeido } = await pg.query(
    `SELECT d.status FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
      WHERE n.user_id = $1 AND d.channel = 'email'`, [ana]
);
check('y el de correo NO: el estado de lectura es independiente por canal',
    correoNoLeido.every(d => d.status !== 'leida'),
    `(${JSON.stringify(correoNoLeido.map(d => d.status))})`);

const { rows: rhIntacto } = await pg.query(
    `SELECT read_at FROM notifications WHERE user_id = $1`, [rhDelEquipo]
);
check('marcar las propias no toca las de otra persona',
    rhIntacto.every(n => n.read_at === null));

// ---------------------------------------------------------------------
console.log('\n--- REGRESIONES DE LA REVISION DEL PR ---');

// 1. El titulo del aviso tiene que caber en notifications.title (VARCHAR 150),
//    aunque courses.title admita 255. Antes reventaba el INSERT y el usuario
//    no se enteraba de su resultado.
const TITULO_LARGO = 'Proteccion de Datos Sensibles y Respuesta ante Incidentes de Ransomware '.repeat(3);
await pg.query(
    `INSERT INTO courses (id, title, description) VALUES (930, $1, 'curso de prueba')
     ON CONFLICT (id) DO NOTHING`, [TITULO_LARGO]
);
check('el caso de prueba usa un titulo valido para courses pero largo',
    TITULO_LARGO.length > 150 && TITULO_LARGO.length <= 255, `(${TITULO_LARGO.length} caracteres)`);

await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId: beto, courseId: 930 });
await eventBus.procesarPendientes();

const { rows: avisoLargo } = await pg.query(
    `SELECT title, body FROM notifications WHERE user_id = $1 AND event_name = 'course.completed'`,
    [beto]
);
check('un curso de titulo largo SI genera el aviso', avisoLargo.length === 1);
check('y su titulo entra en la columna', (avisoLargo[0]?.title.length || 999) <= 150,
    `(${avisoLargo[0]?.title.length} caracteres)`);
check('el titulo completo no se pierde: va en el cuerpo, que es TEXT',
    (avisoLargo[0]?.body || '').includes(TITULO_LARGO.slice(0, 60)));

// 2. Dos intentos distintos con el MISMO attempt_no (que es lo que pasa cuando
//    dos envios simultaneos calculan el COUNT a la vez) no se pueden deduplicar
//    en uno solo: la identidad la da attemptId, no attemptNo.
const { rows: antesCarrera } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [beto]
);
for (const attemptId of [8001, 8002]) {
    await eventBus.publish(EVENTOS.QUIZ_FAILED, {
        userId: beto, quizRef: 'phishing', quizType: 'challenge',
        score: 30, passed: false, attemptId, attemptNo: 7, courseId: null
    });
}
await eventBus.procesarPendientes();
const { rows: despuesCarrera } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [beto]
);
check('dos intentos con el mismo numero pero distinto id generan DOS avisos',
    despuesCarrera[0].n - antesCarrera[0].n === 2,
    `(genero ${despuesCarrera[0].n - antesCarrera[0].n})`);

// Y el mismo intento reprocesado sigue sin duplicar.
await eventBus.publish(EVENTOS.QUIZ_FAILED, {
    userId: beto, quizRef: 'phishing', quizType: 'challenge',
    score: 30, passed: false, attemptId: 8001, attemptNo: 7, courseId: null
});
await eventBus.procesarPendientes();
const { rows: reprocesado } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [beto]
);
check('pero el MISMO intento reprocesado sigue sin duplicar',
    reprocesado[0].n === despuesCarrera[0].n);

// 3. Quien apaga el canal in-app no ve los avisos en el centro, aunque el
//    aviso exista: el centro ES la vista de ese canal.
await pg.exec(`INSERT INTO users (email, password, role) VALUES ('sincanal@hf.com', 'x', 'employee');`);
const sinCanal = await idDe('sincanal@hf.com');
await resultados.actualizarPreferencias(sinCanal, { in_app: false });

await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId: sinCanal, courseId: 901 });
await eventBus.procesarPendientes();

const { rows: existeElAviso } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [sinCanal]
);
check('el aviso se registra igual: es el hecho, no la entrega', existeElAviso[0].n === 1);

const centroSinCanal = await resultados.obtenerCentro(sinCanal);
check('pero NO aparece en el centro de quien apago el canal in-app',
    centroSinCanal.resultados.length === 0, `(vio ${centroSinCanal.resultados.length})`);
check('ni suma en el contador de sin leer', centroSinCanal.no_leidas === 0,
    `(conto ${centroSinCanal.no_leidas})`);

// 4. Si el aviso quedo sin entregas (fallo entre las dos escrituras), el
//    reintento del evento las reconstruye en vez de salirse de largo.
await pg.exec(`INSERT INTO users (email, password, role) VALUES ('huerfano@hf.com', 'x', 'employee');`);
const huerfano = await idDe('huerfano@hf.com');

await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId: huerfano, courseId: 901 });
await eventBus.procesarPendientes();

const { rows: avisoHuerfano } = await pg.query(
    `SELECT id FROM notifications WHERE user_id = $1`, [huerfano]
);
await pg.query(`DELETE FROM notification_deliveries WHERE notification_id = $1`,
    [avisoHuerfano[0].id]);

const { rows: sinEntregas } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notification_deliveries WHERE notification_id = $1`,
    [avisoHuerfano[0].id]
);
check('el escenario arranca con el aviso sin ninguna entrega', sinEntregas[0].n === 0);

await eventBus.publish(EVENTOS.COURSE_COMPLETED, { userId: huerfano, courseId: 901 });
await eventBus.procesarPendientes();

const { rows: reconciliadas } = await pg.query(
    `SELECT channel, status FROM notification_deliveries
      WHERE notification_id = $1 ORDER BY channel`, [avisoHuerfano[0].id]
);
check('reprocesar reconstruye las entregas que faltaban',
    reconciliadas.length === 2, `(quedaron ${reconciliadas.length})`);
check('sin reenviar el correo: queda como generada, que es lo unico que consta',
    reconciliadas.find(d => d.channel === 'email')?.status === 'generada');

const { rows: sinDuplicar } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`, [huerfano]
);
check('y sigue habiendo un solo aviso', sinDuplicar[0].n === 1);

const centroHuerfano = await resultados.obtenerCentro(huerfano);
check('el aviso reconciliado vuelve a salir en el centro',
    centroHuerfano.resultados.length === 1);

// 5. Marcar como leido es del canal, no del aviso.
const marcadoHuerfano = await resultados.marcarTodasLeidas(huerfano);
check('marcar todas informa cuantas entregas in-app marco',
    marcadoHuerfano.marcadas === 1, `(${marcadoHuerfano.marcadas})`);

const { rows: porCanal } = await pg.query(
    `SELECT channel, status FROM notification_deliveries
      WHERE notification_id = $1 ORDER BY channel`, [avisoHuerfano[0].id]
);
check('la entrega in-app queda leida',
    porCanal.find(d => d.channel === 'in_app')?.status === 'leida');
check('y la de correo NO, aunque el aviso figure leido en la bandeja general',
    porCanal.find(d => d.channel === 'email')?.status !== 'leida');

const centroLeido = await resultados.obtenerCentro(huerfano);
check('el centro cuenta la lectura por el canal, no por el campo global',
    centroLeido.no_leidas === 0 && !!centroLeido.resultados[0].leida_en_app);

// ---------------------------------------------------------------------
console.log('\n--- SEGUNDA REVISION DEL PR ---');

// 6. Aprobar contenido de un curso critico tambien le llega a RH. Antes solo
//    llegaba al reprobar, y esa asimetria no tenia defensa.
await pg.exec(`INSERT INTO users (email, password, role, team_id) VALUES ('cris@hf.com', 'x', 'employee', 1);`);
const cris = await idDe('cris@hf.com');

const { rows: cursoCritico } = await pg.query(
    `SELECT id FROM courses WHERE is_critical = true LIMIT 1`
);
check('hay un curso marcado como critico para la prueba', !!cursoCritico[0]);

// Se ejercita el controlador real, no un evento armado a mano: asi se verifica
// que quien publica mande el courseId.
const { rows: desafioDelCurso } = await pg.query(
    `SELECT id FROM challenges WHERE course_id = $1 LIMIT 1`, [cursoCritico[0].id]
);
check('y ese curso tiene un desafio asociado', !!desafioDelCurso[0]);

await llamar(gamification.completeChallenge, {
    user: { id: cris, role: 'employee' },
    body: { challengeId: desafioDelCurso[0].id, passed: true, score: 95 }
});

const { rows: eventoAprobado } = await pg.query(
    `SELECT payload FROM event_outbox
      WHERE event_name = 'quiz.approved' AND (payload->>'userId')::int = $1`, [cris]
);
check('aprobar publica quiz.approved con el curso adentro',
    eventoAprobado[0]?.payload?.courseId === cursoCritico[0].id,
    `(${JSON.stringify(eventoAprobado[0]?.payload)})`);

await eventBus.procesarPendientes();

const { rows: avisoPropio } = await pg.query(
    `SELECT title FROM notifications WHERE user_id = $1 AND event_name = 'quiz.approved'`,
    [cris]
);
check('el que aprobo recibe su aviso', avisoPropio.length === 1);

const { rows: avisoRhAprobado } = await pg.query(
    `SELECT title, payload FROM notifications
      WHERE user_id = $1 AND dedupe_key LIKE 'res:quiz.approved%:rh:%'`, [rhDelEquipo]
);
check('y RH recibe copia porque el curso es critico', avisoRhAprobado.length === 1,
    `(recibio ${avisoRhAprobado.length})`);
check('el aviso a RH dice que lo completo, no que fallo',
    /completo/i.test(avisoRhAprobado[0]?.title || ''), `(${avisoRhAprobado[0]?.title})`);
check('y sigue sin ofrecerle acciones del empleado',
    !('reintentar_en' in (avisoRhAprobado[0]?.payload || {})));

// 7. Marcar leidas es de ESTE centro: no toca avisos de otros modulos ni el
//    canal de correo.
await pg.query(
    `INSERT INTO notifications (user_id, event_name, title, body, dedupe_key)
     VALUES ($1, 'level_up', 'Subiste de nivel', 'felicitaciones', 'ajeno:level:cris')`,
    [cris]
);

const marcadoCris = await resultados.marcarTodasLeidas(cris);
check('marcar todas marca el resultado del centro', marcadoCris.marcadas === 1,
    `(${marcadoCris.marcadas})`);

const { rows: avisoAjeno } = await pg.query(
    `SELECT read_at FROM notifications WHERE dedupe_key = 'ajeno:level:cris'`
);
check('pero NO toca el aviso de nivel, que es de otro modulo',
    avisoAjeno[0]?.read_at === null);

const { rows: canalesCris } = await pg.query(
    `SELECT d.channel, d.status FROM notification_deliveries d
       JOIN notifications n ON n.id = d.notification_id
      WHERE n.user_id = $1 AND n.event_name = 'quiz.approved' ORDER BY d.channel`, [cris]
);
check('la entrega in-app queda leida',
    canalesCris.find(d => d.channel === 'in_app')?.status === 'leida');
check('y marcar in-app NO altera el estado de lectura del correo',
    canalesCris.find(d => d.channel === 'email')?.status !== 'leida',
    `(${JSON.stringify(canalesCris)})`);

const { rows: readAtPropio } = await pg.query(
    `SELECT read_at FROM notifications WHERE user_id = $1 AND event_name = 'quiz.approved'`,
    [cris]
);
check('el campo global solo se escribe para los avisos de esta historia',
    readAtPropio[0]?.read_at !== null);

// ---------------------------------------------------------------------
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
