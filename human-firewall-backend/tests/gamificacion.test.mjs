import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// fileURLToPath en lugar de .pathname: en Windows, .pathname devuelve
// "/C:/..." con los espacios y acentos codificados (%20, %C3%A1), y la ruta
// resultante no existe. fileURLToPath decodifica y resuelve la unidad.
const DIR = fileURLToPath(new URL('../../', import.meta.url));
const BACK = `${DIR}human-firewall-backend/src`;
const require_ = createRequire(`${BACK}/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e='') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };

// Adaptador: expone la API de pg.Pool que usa el codigo (query + connect).
// PGlite es una sola sesion, asi que BEGIN/COMMIT funcionan como SQL normal.
const adapter = {
  query: (t, p) => pg.query(t, p),
  connect: async () => ({ query: (t, p) => pg.query(t, p), release: () => {} })
};

// Inyecta el adaptador en lugar del modulo real de conexion.
const dbPath = require_.resolve('./config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

// Esquema + migraciones
await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking','004_event_outbox','005_rol_rh'])
  await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8'));
console.log('Esquema y migraciones listos\n');

const eventBus = require_('./services/eventBus');
const points   = require_('./services/points.service');
points.registrarHandlers();

// Datos
await pg.exec(`
  INSERT INTO users (email,password,role) VALUES ('emp@hf.com','x','employee');
  INSERT INTO courses (title) VALUES ('Ciberseguridad 101');
  INSERT INTO course_contents (course_id, content_type, body, points_reward) VALUES (1,'text','Leccion A',25);
  INSERT INTO course_contents (course_id, content_type, body, points_reward) VALUES (1,'text','Leccion B',30);
`);
const { rows:[u] } = await pg.query(`SELECT id FROM users WHERE email='emp@hf.com'`);
const uid = u.id;

console.log('--- FLUJO ASINCRONO ---');

// 1. Completar leccion -> evento -> puntos
await eventBus.publish('lesson.completed', { userId: uid, contentId: 1 });
const { rows:[pend] } = await pg.query(`SELECT status FROM event_outbox WHERE id=1`);
check('el evento queda encolado sin procesar (no bloquea la respuesta)', pend.status === 'pending', `(estado ${pend.status})`);

await eventBus.procesarPendientes();
const { rows: l1 } = await pg.query(`SELECT points, source_type, rule_code FROM points_ledger WHERE user_id=$1`, [uid]);
check('leccion otorga los puntos de course_contents.points_reward', l1.length===1 && l1[0].points===25, `(${JSON.stringify(l1)})`);
check('el movimiento guarda la regla aplicada', l1[0]?.rule_code === 'lesson.completed');

const { rows:[ev1] } = await pg.query(`SELECT status FROM event_outbox WHERE id=1`);
check('el evento queda marcado como done', ev1.status==='done', `(${ev1.status})`);

// 2. Cache de total_points
const { rows:[cache1] } = await pg.query(`SELECT total_points FROM users WHERE id=$1`,[uid]);
check('users.total_points se sincroniza con el historial', cache1.total_points===25, `(${cache1.total_points})`);

// 3. Evento duplicado no duplica puntos
await eventBus.publish('lesson.completed', { userId: uid, contentId: 1 });
await eventBus.procesarPendientes();
const { rows:[c2] } = await pg.query(`SELECT COUNT(*)::int n FROM points_ledger WHERE user_id=$1`,[uid]);
check('reintento del mismo evento no duplica puntos', c2.n===1, `(hay ${c2.n} movimientos)`);

// 4. Quiz reprobado no otorga nada
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'phishing', quizType:'simulation', score:40, passed:false });
await eventBus.procesarPendientes();
const { rows:[c3] } = await pg.query(`SELECT COUNT(*)::int n FROM points_ledger WHERE source_type='quiz'`);
check('intento reprobado no asigna puntos', c3.n===0, `(hay ${c3.n})`);

// 5. Quiz aprobado con puntaje -> proporcional (regla by_score, base 100)
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'phishing', quizType:'simulation', score:80, passed:true });
await eventBus.procesarPendientes();
const { rows:[q1] } = await pg.query(`SELECT points FROM points_ledger WHERE source_type='quiz' AND source_id='phishing'`);
check('quiz aprobado otorga puntos segun el puntaje (80% de 100)', q1?.points===80, `(dio ${q1?.points})`);

// 6. Re-aprobar el mismo quiz no duplica
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'phishing', quizType:'simulation', score:100, passed:true });
await eventBus.procesarPendientes();
const { rows:[c4] } = await pg.query(`SELECT COUNT(*)::int n FROM points_ledger WHERE source_id='phishing'`);
check('repetir una evaluacion ya aprobada no duplica puntos', c4.n===1, `(hay ${c4.n})`);

// 7. Desafio con recompensa propia (basePoints)
await eventBus.publish('quiz.approved', { userId: uid, quizRef:'wifi', quizType:'challenge', score:100, passed:true, basePoints:200 });
await eventBus.procesarPendientes();
const { rows:[q2] } = await pg.query(`SELECT points FROM points_ledger WHERE source_id='wifi'`);
check('el desafio usa su propio points_reward como base', q2?.points===200, `(dio ${q2?.points})`);

// 8. Evento points_assigned para la HU de recompensas
const { rows:[pa] } = await pg.query(`SELECT COUNT(*)::int n FROM event_outbox WHERE event_name='points_assigned'`);
check('cada asignacion emite points_assigned para la HU de recompensas', pa.n===3, `(emitio ${pa.n})`);

// 9. Total final
const { rows:[tot] } = await pg.query(`SELECT total_points FROM v_user_points WHERE user_id=$1`,[uid]);
check('total recalculado desde el historial', tot.total_points===305, `(dio ${tot.total_points}, esperado 305)`);

// 10. Reintento ante fallo del handler
eventBus.subscribe('evento.roto', async () => { throw new Error('fallo simulado'); });
await eventBus.publish('evento.roto', {});
await eventBus.procesarPendientes();
const { rows:[roto] } = await pg.query(`SELECT status, attempts, last_error, next_attempt_at > now() AS espera FROM event_outbox WHERE event_name='evento.roto'`);
check('un handler que falla deja el evento reintentable', roto.status==='pending' && roto.attempts===1, `(${roto.status}/${roto.attempts})`);
check('el backoff evita quemar los reintentos de golpe', roto.espera === true, `(espera=${roto.espera})`);
check('se guarda el motivo del fallo', /fallo simulado/.test(roto.last_error||''));

// Un segundo drenado no debe tocarlo mientras dure la espera
await eventBus.procesarPendientes();
const { rows:[roto2] } = await pg.query(`SELECT attempts FROM event_outbox WHERE event_name='evento.roto'`);
check('el worker respeta la espera y no reintenta antes de tiempo', roto2.attempts===1, `(intentos=${roto2.attempts})`);

// 11. Historial paginado
for (let i=0;i<5;i++) await points.registrarMovimiento({userId:uid, sourceType:'manual', sourceId:`m${i}`, points:1, ruleCode:'manual', idempotencyKey:`manual:${uid}:m${i}`});
const h = await points.obtenerHistorial(uid, { page:1, limit:3 });
check('historial pagina correctamente', h.historial.length===3 && h.movimientos===8, `(${h.historial.length} filas, ${h.movimientos} mov.)`);
check('el total acompana al historial', h.total_points===310, `(${h.total_points})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos>0?1:0);
