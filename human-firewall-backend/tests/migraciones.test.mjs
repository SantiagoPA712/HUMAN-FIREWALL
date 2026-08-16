import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';

const DIR = new URL('../../', import.meta.url).pathname;
const db = new PGlite();
let fallos = 0, ok = 0;
const check = (n, cond, extra='') => {
  if (cond) { console.log(`  OK    ${n}`); ok++; }
  else { console.log(`  FALLA ${n} ${extra}`); fallos++; }
};
const msg = e => (e && e.message) ? e.message : String(e);

await db.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
console.log('schema.sql aplicado');
for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking','004_event_outbox','005_rol_rh']) {
  try { await db.exec(readFileSync(`${DIR}migrations/${f}.sql`,'utf8')); console.log(`${f} aplicado`); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}

console.log('\n--- PRUEBAS ---');
await db.exec(`INSERT INTO users (email,password,role) VALUES ('test@hf.com','x','employee')`);
const { rows:[u] } = await db.query(`SELECT id FROM users WHERE email='test@hf.com'`);
const uid = u.id;

const ins = (st, sid, pts, rule, key) => db.query(
  `INSERT INTO points_ledger (user_id, source_type, source_id, points, rule_code, idempotency_key)
   VALUES ($1,$2,$3,$4,$5,$6)`, [uid, st, sid, pts, rule, key]);

await ins('lesson','7',10,'lesson.completed',`lesson:${uid}:7`);
const { rows:[c1] } = await db.query(`SELECT COUNT(*)::int n FROM points_ledger`);
check('INSERT en points_ledger', c1.n === 1);

try { await db.query(`UPDATE points_ledger SET points=9999`); check('UPDATE bloqueado por trigger', false, '(paso!)'); }
catch (e) { check('UPDATE bloqueado por trigger', /inmutable/i.test(msg(e))); }

try { await db.query(`DELETE FROM points_ledger`); check('DELETE bloqueado por trigger', false, '(paso!)'); }
catch (e) { check('DELETE bloqueado por trigger', /inmutable/i.test(msg(e))); }

try { await ins('lesson','7',10,'lesson.completed',`lesson:${uid}:7`); check('idempotency_key evita duplicados', false, '(inserto 2 veces!)'); }
catch (e) { check('idempotency_key evita duplicados', /duplicate key/i.test(msg(e))); }

await ins('quiz','wifi',75,'quiz.approved',`quiz:${uid}:wifi`);
const { rows:[v] } = await db.query(`SELECT total_points, movimientos FROM v_user_points WHERE user_id=$1`, [uid]);
check('v_user_points recalcula el total', v.total_points===85 && v.movimientos===2, `(dio ${v.total_points}/${v.movimientos})`);

const { rows:[r] } = await db.query(`SELECT COUNT(*)::int n FROM points_rules WHERE is_active`);
check('points_rules sembrada con 5 reglas', r.n===5, `(hay ${r.n})`);

try { await db.query(`INSERT INTO users (email,password,role) VALUES ('rh@hf.com','x','rh')`); check('rol rh aceptado', true); }
catch (e) { check('rol rh aceptado', false, msg(e)); }

try { await db.query(`INSERT INTO users (email,password,role) VALUES ('malo@hf.com','x','hacker')`); check('rol invalido rechazado', false, '(acepto rol inventado!)'); }
catch (e) { check('rol invalido rechazado', /chk_users_role|check constraint/i.test(msg(e))); }

try { await ins('manual','ajuste',-5,'manual',`manual:${uid}:aj1`); check('permite ajuste compensatorio negativo', true); }
catch (e) { check('permite ajuste compensatorio negativo', false, msg(e)); }

try { await ins('inventado','x',10,'r',`x:${uid}:1`); check('source_type invalido rechazado', false, '(acepto tipo invalido!)'); }
catch (e) { check('source_type invalido rechazado', /check constraint/i.test(msg(e))); }

await db.query(`INSERT INTO event_outbox (event_name,payload) VALUES ('lesson.completed','{"userId":1}'::jsonb)`);
const { rows:[o] } = await db.query(`SELECT status, attempts FROM event_outbox LIMIT 1`);
check('event_outbox arranca en pending', o.status==='pending' && o.attempts===0);

// El total tras el ajuste negativo debe reflejarse
const { rows:[v2] } = await db.query(`SELECT total_points FROM v_user_points WHERE user_id=$1`,[uid]);
check('total refleja el ajuste negativo', v2.total_points===80, `(dio ${v2.total_points})`);

// quiz_attempts y lesson_completions
await db.exec(`INSERT INTO courses (title) VALUES ('Curso 1');
               INSERT INTO course_contents (course_id, content_type, body, points_reward) VALUES (1,'text','Leccion 1',15);`);
await db.query(`INSERT INTO lesson_completions (user_id, content_id) VALUES ($1,1)`,[uid]);
try { await db.query(`INSERT INTO lesson_completions (user_id, content_id) VALUES ($1,1)`,[uid]); check('leccion no se completa dos veces', false, '(duplico!)'); }
catch (e) { check('leccion no se completa dos veces', /duplicate key/i.test(msg(e))); }

await db.query(`INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, score, passed) VALUES ($1,'wifi','challenge',80,true)`,[uid]);
const { rows:[qa] } = await db.query(`SELECT COUNT(*)::int n FROM quiz_attempts WHERE passed`);
check('quiz_attempts registra intento aprobado', qa.n===1);

try { await db.query(`INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, score, passed) VALUES ($1,'wifi','challenge',150,true)`,[uid]); check('score fuera de rango rechazado', false, '(acepto 150!)'); }
catch (e) { check('score fuera de rango rechazado', /check constraint/i.test(msg(e))); }

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos>0?1:0);
