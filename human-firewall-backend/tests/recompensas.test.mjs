import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// fileURLToPath en lugar de .pathname: en Windows, .pathname devuelve
// "/C:/..." con los espacios y acentos codificados (%20, %C3%A1), y la ruta
// resultante no existe. fileURLToPath decodifica y resuelve la unidad.
const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e='') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

const adapter = {
  query: (t, p) => pg.query(t, p),
  connect: async () => ({ query: (t, p) => pg.query(t, p), release: () => {} })
};
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

// Base previa CON datos, para verificar que la migracion no destruye nada
await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
await pg.exec(`
  INSERT INTO users (email,password,role) VALUES ('emp@hf.com','x','employee');
  INSERT INTO badges (name, description, points_required, icon_url)
    VALUES ('Insignia Vieja','Ganada antes de la migracion',100,'/old.png');
  INSERT INTO user_badges (user_id, badge_id) VALUES (2, 1);
`);

for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking',
                 '004_event_outbox','005_rol_rh','006_rewards_catalog','007_user_rewards']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas sobre una base con datos previos\n');

const eventBus = require_('./services/eventBus');
const points   = require_('./services/points.service');
const rewards  = require_('./services/rewards.service');
points.registrarHandlers();
rewards.registrarHandlers();

const { rows:[u] } = await pg.query(`SELECT id FROM users WHERE email='emp@hf.com'`);
const uid = u.id;

console.log('--- MIGRACION DE DATOS EXISTENTES ---');
const { rows:[vieja] } = await pg.query(`SELECT reward_name, reward_icon_url, dedupe_key FROM user_rewards WHERE user_id=2`);
check('el historial previo sobrevive', !!vieja);
check('se completo el snapshot de la insignia vieja', vieja?.reward_name==='Insignia Vieja' && vieja?.reward_icon_url==='/old.png');
const { rows:[trad] } = await pg.query(`SELECT condition_type, condition_params FROM rewards_catalog WHERE name='Insignia Vieja'`);
check('points_required se tradujo a condicion', trad?.condition_type==='points_total' && trad?.condition_params?.threshold===100);

console.log('\n--- OTORGAMIENTO AUTOMATICO ---');
await pg.exec(`
  INSERT INTO courses (title) VALUES ('Ciberseguridad 101');
  INSERT INTO course_contents (course_id, content_type, body, points_reward) VALUES (1,'text','L1',25);
  INSERT INTO course_contents (course_id, content_type, body, points_reward) VALUES (1,'text','L2',25);
  INSERT INTO course_assignments (course_id, user_id, status) VALUES (1, ${uid}, 'assigned');
`);

await pg.query(`INSERT INTO lesson_progress (user_id, content_id) VALUES ($1,1)`, [uid]);
await eventBus.publish('lesson.completed', { userId: uid, contentId: 1 });
await eventBus.procesarPendientes();

const { rows: r1 } = await pg.query(`SELECT reward_name FROM user_rewards WHERE user_id=$1`, [uid]);
check('completar una leccion otorga "Primeros Pasos"', r1.some(r => r.reward_name === 'Primeros Pasos'), `(${JSON.stringify(r1.map(x=>x.reward_name))})`);

// No repetible: reevaluar no duplica
await eventBus.publish('lesson.completed', { userId: uid, contentId: 1 });
await eventBus.procesarPendientes();
const { rows:[dup] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Primeros Pasos'`, [uid]);
check('una recompensa no repetible no se otorga dos veces', dup.n===1, `(hay ${dup.n})`);

// Umbral de puntos
await points.registrarMovimiento({ userId: uid, sourceType:'manual', sourceId:'seed', points:600, ruleCode:'manual', idempotencyKey:`manual:${uid}:seed` });
await eventBus.procesarPendientes();
const { rows:[cent] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Centinela'`, [uid]);
check('superar 500 puntos otorga "Centinela"', cent.n===1, `(hay ${cent.n})`);
const { rows:[guard] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Guardian'`, [uid]);
check('no otorga "Guardian" con 625 puntos (umbral 2000)', guard.n===0, `(hay ${guard.n})`);

// Repetible: racha
console.log('\n--- REPETIBLES ---');
for (const q of ['q1','q2','q3']) {
  await pg.query(`INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, score, passed) VALUES ($1,$2,'simulation',90,true)`, [uid, q]);
}
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'q3', quizType:'simulation', score:90, passed:true });
await eventBus.procesarPendientes();
const { rows:[racha] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Sin Fallar'`, [uid]);
check('racha de 3 aprobadas otorga "Sin Fallar"', racha.n===1, `(hay ${racha.n})`);

// Un logro nuevo vuelve a otorgar la repetible
await pg.query(`INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, score, passed) VALUES ($1,'q4','simulation',95,true)`, [uid]);
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'q4', quizType:'simulation', score:95, passed:true });
await eventBus.procesarPendientes();
const { rows:[racha2] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Sin Fallar'`, [uid]);
check('la repetible se otorga de nuevo ante otro logro', racha2.n===2, `(hay ${racha2.n})`);

// Curso completo
console.log('\n--- CURSO COMPLETO ---');
await pg.query(`INSERT INTO lesson_progress (user_id, content_id) VALUES ($1,2)`, [uid]);
await pg.query(`UPDATE course_assignments SET status='completed' WHERE user_id=$1`, [uid]);
await eventBus.publish('course.completed', { userId: uid, courseId: 1 });
await eventBus.procesarPendientes();
const { rows:[curso] } = await pg.query(`SELECT COUNT(*)::int n FROM user_rewards WHERE user_id=$1 AND reward_name='Curso Completo'`, [uid]);
check('finalizar un curso otorga "Curso Completo"', curso.n===1, `(hay ${curso.n})`);

// Snapshot ante edicion y borrado del catalogo
console.log('\n--- SNAPSHOT INMUTABLE ---');
await pg.query(`UPDATE rewards_catalog SET name='Centinela RENOMBRADA', description='otra cosa' WHERE name='Centinela'`);
const { rows:[snap] } = await pg.query(`SELECT reward_name FROM user_rewards WHERE user_id=$1 AND reward_name LIKE 'Centinela%'`, [uid]);
check('editar el catalogo no altera lo ya otorgado', snap?.reward_name==='Centinela', `(quedo "${snap?.reward_name}")`);

await pg.query(`DELETE FROM rewards_catalog WHERE name='Centinela RENOMBRADA'`);
const { rows:[trasBorrar] } = await pg.query(`SELECT reward_name, reward_description FROM user_rewards WHERE user_id=$1 AND reward_name='Centinela'`, [uid]);
check('borrar del catalogo NO borra el historial', !!trasBorrar, '(se borro en cascada!)');
check('el snapshot sigue completo tras el borrado', trasBorrar?.reward_description==='Alcanzaste 500 puntos de seguridad');

try { await pg.query(`UPDATE user_rewards SET reward_name='x'`); check('UPDATE bloqueado por trigger', false, '(paso!)'); }
catch (e) { check('UPDATE bloqueado por trigger', /inmutable/i.test(msg(e))); }
try { await pg.query(`DELETE FROM user_rewards WHERE user_id=$1`, [uid]); check('DELETE bloqueado por trigger', false, '(paso!)'); }
catch (e) { check('DELETE bloqueado por trigger', /inmutable/i.test(msg(e))); }

// Galeria
console.log('\n--- GALERIA ---');
const galeria = await rewards.obtenerRecompensasDeUsuario(uid);
check('devuelve las obtenidas', galeria.total_obtenidas >= 4, `(${galeria.total_obtenidas})`);
const bloqueada = galeria.bloqueadas.find(b => b.name === 'Guardian');
check('devuelve las bloqueadas con su umbral', bloqueada?.threshold === 2000, `(${JSON.stringify(bloqueada)})`);
// El progreso se compara contra el total real del ledger, no contra un
// numero fijo: asi la prueba no se rompe si cambian las reglas de puntos.
const { rows:[totReal] } = await pg.query(`SELECT total_points FROM v_user_points WHERE user_id=$1`, [uid]);
const esperado = Math.min(100, Math.round(totReal.total_points * 100 / 2000));
check('el progreso hacia la bloqueada sale del ledger',
      bloqueada?.progreso === totReal.total_points && bloqueada?.porcentaje === esperado,
      `(dio ${bloqueada?.progreso}/${bloqueada?.porcentaje}%, esperado ${totReal.total_points}/${esperado}%)`);

// Aislamiento entre usuarios
await pg.exec(`INSERT INTO users (email,password,role) VALUES ('otro@hf.com','x','employee')`);
const { rows:[o] } = await pg.query(`SELECT id FROM users WHERE email='otro@hf.com'`);
const otra = await rewards.obtenerRecompensasDeUsuario(o.id);
check('otro usuario no hereda recompensas ajenas', otra.total_obtenidas === 0, `(${otra.total_obtenidas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
