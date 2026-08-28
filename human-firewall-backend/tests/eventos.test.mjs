/**
 * Pruebas de la arquitectura basada en eventos.
 *
 * No verifican reglas de negocio (de eso se ocupan las otras suites), sino la
 * arquitectura en si:
 *   - que el catalogo y el cableado real coincidan,
 *   - que las acciones respondan SIN haber ejecutado todavia sus consecuencias,
 *   - que las consecuencias ocurran al drenar la cola,
 *   - y que reprocesar un evento no duplique nada.
 *
 * Ese ultimo punto es el que mas importa: el worker reintenta, asi que un
 * handler no idempotente no es un bug latente, es un bug garantizado.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// utils/token.js no tiene valor por defecto para JWT_SECRET: sin esto, el
// register de la prueba revienta al firmar el token.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';

const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

let conexionesAbiertas = 0;
const adapter = {
    query: (t, p) => pg.query(t, p),
    connect: async () => {
        conexionesAbiertas++;
        let devuelta = false;
        return {
            query: (t, p) => pg.query(t, p),
            release: () => { if (!devuelta) { devuelta = true; conexionesAbiertas--; } }
        };
    }
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

// Esquema + TODAS las migraciones del directorio, en orden. Se leen del disco
// en vez de listarlas a mano: asi una migracion nueva entra sola a la prueba.
await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const eventBus      = require_('./services/eventBus');
const catalogo      = require_('./events/catalogo');
const suscriptores  = require_('./events/suscriptores');
const authService   = require_('./services/auth.service');
const simController = require_('./controllers/simulation.controller');

const { EVENTOS, SUSCRIPTORES_ESPERADOS } = catalogo;

// Igual que server.js, pero sin arrancar el temporizador: la cola se drena a
// mano para que las pruebas no dependan de esperar cinco segundos.
const suscritos = suscriptores.conectarTodo({ iniciarWorker: false });

/** Stubs de req/res para ejercitar los controladores reales. */
const llamar = async (handler, { user, params = {}, body = {}, query = {} }) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ user, params, body, query }, res);
    return { estado, cuerpo };
};

const contar = async (sql, params = []) => {
    const { rows } = await pg.query(sql, params);
    return Number(rows[0].n);
};

// =====================================================================
console.log('--- CATALOGO Y CABLEADO ---');
// =====================================================================

// El catalogo es documentacion, y la documentacion miente apenas alguien
// agrega un subscribe sin actualizarla. Esta prueba la obliga a no mentir.
for (const [evento, esperados] of Object.entries(SUSCRIPTORES_ESPERADOS)) {
    check(
        `${evento} tiene ${esperados.length} suscriptor(es) registrado(s)`,
        suscritos[evento] === esperados.length,
        `(catalogo dice ${esperados.length}: ${esperados.join(', ')}; el bus tiene ${suscritos[evento] ?? 0})`
    );
}

const fueraDelCatalogo = Object.keys(suscritos).filter(e => !catalogo.NOMBRES_VALIDOS.has(e));
check('ningun servicio escucha un evento que no este en el catalogo',
    fueraDelCatalogo.length === 0, `(sobran: ${fueraDelCatalogo.join(', ')})`);

// =====================================================================
console.log('\n--- REGISTRO DE USUARIO ---');
// =====================================================================

const token = await authService.register('nuevo@hf.com', 'Password1');
check('register() devuelve el token sin esperar a nadie', typeof token === 'string' && token.length > 0);

const { rows: [nuevo] } = await pg.query(`SELECT id FROM users WHERE email='nuevo@hf.com'`);

check('el usuario quedo creado', !!nuevo);
check('user.registered quedo encolado',
    await contar(`SELECT COUNT(*) n FROM event_outbox WHERE event_name=$1 AND status='pending'`,
        [EVENTOS.USER_REGISTERED]) === 1);

// La respuesta ya se dio y todavia no hay notificacion: eso es exactamente lo
// que significa "asincrono". Si esta comprobacion falla, el handler se estaria
// ejecutando dentro del request.
check('todavia NO hay notificacion de bienvenida (la accion no la espero)',
    await contar(`SELECT COUNT(*) n FROM notifications WHERE user_id=$1`, [nuevo.id]) === 0);

await eventBus.procesarPendientes();

check('tras drenar la cola, llego la bienvenida',
    await contar(`SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND event_name=$2`,
        [nuevo.id, EVENTOS.USER_REGISTERED]) === 1);

// Reprocesar el MISMO hecho: es lo que hace el worker cuando un handler falla
// y el evento vuelve a la cola.
await eventBus.publish(EVENTOS.USER_REGISTERED, {
    userId: nuevo.id, email: 'nuevo@hf.com', role: 'employee', provider: 'local'
});
await eventBus.procesarPendientes();

check('reprocesar user.registered NO duplica la notificacion',
    await contar(`SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND event_name=$2`,
        [nuevo.id, EVENTOS.USER_REGISTERED]) === 1);

// =====================================================================
console.log('\n--- SIMULACION: DECISION ---');
// =====================================================================

await pg.exec(`
  INSERT INTO courses (id, title) VALUES (700, 'Phishing avanzado');
  INSERT INTO simulations (id, title, course_id) VALUES (700, 'Correo sospechoso', 700);
  INSERT INTO simulation_steps (id, simulation_id, scenario_text, order_idx) VALUES (7001, 700, 'Llega un correo', 1);
  INSERT INTO simulation_options (id, step_id, option_text, is_correct, points_awarded, feedback_text)
       VALUES (70011, 7001, 'Reportarlo', true, 40, 'Correcto'),
              (70012, 7001, 'Abrir el adjunto', false, 0, 'Incorrecto');
`);

const decision = await llamar(simController.submitDecision, {
    user: { id: nuevo.id }, body: { optionId: 70011 }
});

check('submit-decision responde 200', decision.estado === 200);
check('la respuesta trae el estimado, no el otorgado',
    decision.cuerpo.puntos_estimados === 40 && decision.cuerpo.ya_contabilizada === false,
    JSON.stringify(decision.cuerpo));

check('la retroalimentacion sigue siendo inmediata',
    decision.cuerpo.is_correct === true && decision.cuerpo.feedback === 'Correcto');

// Lo importante: respondio sin escribir en el historial de puntos.
check('todavia NO hay movimiento en points_ledger',
    await contar(`SELECT COUNT(*) n FROM points_ledger WHERE user_id=$1`, [nuevo.id]) === 0);

await eventBus.procesarPendientes();

check('tras drenar, los 40 puntos estan otorgados',
    await contar(`SELECT COUNT(*) n FROM points_ledger WHERE user_id=$1 AND source_type='simulation' AND points=40`,
        [nuevo.id]) === 1);

// Reenviar la misma opcion: la version vieja de este endpoint fue justamente
// donde estuvo el fallo de puntos infinitos.
const repetida = await llamar(simController.submitDecision, {
    user: { id: nuevo.id }, body: { optionId: 70011 }
});
await eventBus.procesarPendientes();

check('reenviar la misma opcion se marca como ya contabilizada',
    repetida.cuerpo.ya_contabilizada === true && repetida.cuerpo.puntos_estimados === 0,
    JSON.stringify(repetida.cuerpo));

check('reenviar la misma opcion NO suma puntos otra vez',
    await contar(`SELECT COUNT(*) n FROM points_ledger WHERE user_id=$1 AND source_type='simulation'`,
        [nuevo.id]) === 1);

// =====================================================================
console.log('\n--- SIMULACION: CIERRE ---');
// =====================================================================

const puntosAntesDelCierre = await contar(
    `SELECT COALESCE(SUM(points),0) n FROM points_ledger WHERE user_id=$1`, [nuevo.id]);

const cierre = await llamar(simController.completeSimulation, {
    user: { id: nuevo.id }, params: { simulationId: '700' }, body: { decisiones: [70011] }
});

check('completar la simulacion responde 200', cierre.estado === 200, JSON.stringify(cierre.cuerpo));
check('el puntaje lo calculo el servidor', cierre.cuerpo.score === 100 && cierre.cuerpo.aprobada === true);

check('simulation.completed quedo encolado',
    await contar(`SELECT COUNT(*) n FROM event_outbox WHERE event_name=$1`,
        [EVENTOS.SIMULATION_COMPLETED]) === 1);

await eventBus.procesarPendientes();

// points.service NO se suscribe a simulation.completed: los puntos ya se
// pagaron opcion por opcion. Si alguien lo suscribiera por error, este check
// lo delata.
check('cerrar la simulacion NO vuelve a pagar los puntos de las opciones',
    await contar(`SELECT COALESCE(SUM(points),0) n FROM points_ledger WHERE user_id=$1`,
        [nuevo.id]) === puntosAntesDelCierre);

// =====================================================================
console.log('\n--- PROYECCION DE RECOMENDACIONES ---');
// =====================================================================

const { rows: proyeccion } = await pg.query(
    `SELECT trigger_event, generated_at FROM user_recommendations WHERE user_id=$1`, [nuevo.id]);

check('simulation.completed dejo la proyeccion escrita', proyeccion.length === 1);
check('la proyeccion registra que evento la genero',
    proyeccion[0]?.trigger_event === EVENTOS.SIMULATION_COMPLETED,
    `(quedo "${proyeccion[0]?.trigger_event}")`);

// =====================================================================
console.log('\n--- NIVEL Y AVISO ---');
// =====================================================================

const notisAntes = await contar(
    `SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND event_name=$2`,
    [nuevo.id, EVENTOS.LEVEL_UP]);

await eventBus.publish(EVENTOS.LEVEL_UP, {
    userId: nuevo.id, nivel: 2, nombre: 'Aprendiz', nivelesAlcanzados: [2], puntos: 120
});
await eventBus.procesarPendientes();

check('level_up genera un aviso',
    await contar(`SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND event_name=$2`,
        [nuevo.id, EVENTOS.LEVEL_UP]) === notisAntes + 1);

// Mismo nivel, evento repetido: el usuario no puede recibir dos veces
// "subiste al nivel 2".
await eventBus.publish(EVENTOS.LEVEL_UP, {
    userId: nuevo.id, nivel: 2, nombre: 'Aprendiz', nivelesAlcanzados: [2], puntos: 130
});
await eventBus.procesarPendientes();

check('repetir level_up del MISMO nivel no duplica el aviso',
    await contar(`SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND event_name=$2`,
        [nuevo.id, EVENTOS.LEVEL_UP]) === notisAntes + 1);

// =====================================================================
console.log('\n--- ESTADO DE LA COLA ---');
// =====================================================================

const estado = await eventBus.estadoDeLaCola();
check('no quedaron eventos pendientes ni fallidos',
    estado.por_estado.pending === 0 && estado.por_estado.failed === 0,
    JSON.stringify(estado.por_estado));
check('todos los eventos procesados quedaron en done', estado.por_estado.done > 0);
check('el diagnostico expone los suscriptores', Object.keys(estado.suscriptores).length > 0);

check('no se filtraron conexiones del pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

// =====================================================================
console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos === 0 ? 0 : 1);
