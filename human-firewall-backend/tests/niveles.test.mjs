import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// Mismo arranque que recompensas.test.mjs: PostgreSQL real compilado a
// WebAssembly, sin credenciales ni base levantada.
const DIR = fileURLToPath(new URL('../../', import.meta.url));
const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

const pg = new PGlite();
let ok = 0, fallos = 0;
const check = (n, c, e='') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
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

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
await pg.exec(`INSERT INTO users (email,password,role) VALUES ('nivel@hf.com','x','employee');`);

for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking',
                 '004_event_outbox','005_rol_rh','006_rewards_catalog','007_user_rewards',
                 '008_desafios_faltantes','020_levels_config','021_user_level_history']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas\n');

const eventBus = require_('./services/eventBus');
const points   = require_('./services/points.service');
const levels   = require_('./services/levels.service');
points.registrarHandlers();
levels.registrarHandlers();

const { rows:[u] } = await pg.query(`SELECT id FROM users WHERE email='nivel@hf.com'`);
const uid = u.id;

// ---------------------------------------------------------------------
console.log('--- CATALOGO DE NIVELES ---');

const escalera = await levels.obtenerEscalera();
check('la escalera trae los 6 niveles sembrados', escalera.length === 6, `(hay ${escalera.length})`);
check('viene ordenada por umbral ascendente',
  escalera.every((n, i) => i === 0 || n.min_points > escalera[i-1].min_points));
check('el nivel 1 arranca en 0 y el 2 en 101 (enunciado de la HU)',
  escalera[0].min_points === 0 && escalera[1].min_points === 101,
  `(${escalera[0].min_points}, ${escalera[1].min_points})`);

let err = null;
try { await pg.query(`INSERT INTO levels_config (level, name, min_points) VALUES (99,'Duplicado',301)`); }
catch (e) { err = e; }
check('dos niveles no pueden compartir el mismo umbral', !!err);

// ---------------------------------------------------------------------
console.log('\n--- CALCULO DERIVADO (funcion pura) ---');

const p = (puntos) => levels.calcularProgreso(puntos, escalera);

check('0 puntos = nivel 1',            p(0).nivel_actual === 1);
check('100 puntos sigue siendo nivel 1', p(100).nivel_actual === 1, `(dio ${p(100).nivel_actual})`);
check('101 puntos ya es nivel 2 (borde exacto)', p(101).nivel_actual === 2, `(dio ${p(101).nivel_actual})`);
check('300 puntos sigue siendo nivel 2', p(300).nivel_actual === 2);
check('301 puntos es nivel 3',           p(301).nivel_actual === 3);

const medio = p(201);   // nivel 2: va de 101 a 300, son 200 de rango, lleva 100
check('el porcentaje se mide DENTRO del nivel, no sobre el total',
  medio.porcentaje_avance === 50, `(dio ${medio.porcentaje_avance}%)`);
check('puntos_faltantes apunta al umbral del siguiente',
  medio.puntos_faltantes === 100 && medio.puntos_para_siguiente === 301,
  `(faltan ${medio.puntos_faltantes}, siguiente ${medio.puntos_para_siguiente})`);

const tope = p(99999);
check('en el nivel maximo el avance es 100%', tope.porcentaje_avance === 100);
check('en el nivel maximo no hay siguiente umbral',
  tope.es_nivel_maximo === true && tope.puntos_para_siguiente === null && tope.puntos_faltantes === 0);

const justoEnElBorde = p(1501);
check('caer exacto en un umbral deja el avance en 0% del nivel nuevo',
  justoEnElBorde.nivel_actual === 5 && justoEnElBorde.porcentaje_avance === 0,
  `(nivel ${justoEnElBorde.nivel_actual}, ${justoEnElBorde.porcentaje_avance}%)`);

// ---------------------------------------------------------------------
console.log('\n--- SUBIDA AUTOMATICA AL GANAR PUNTOS ---');

const nivelInicial = await levels.obtenerNivelDeUsuario(uid);
check('un usuario sin puntos arranca en nivel 1 con 0 puntos',
  nivelInicial.nivel_actual === 1 && nivelInicial.puntos_actuales === 0);

// 150 puntos -> cruza a nivel 2
await points.registrarMovimiento({
  userId: uid, sourceType:'manual', sourceId:'seed1', points:150,
  ruleCode:'manual', idempotencyKey:`manual:${uid}:seed1`
});
await eventBus.procesarPendientes();

const tras150 = await levels.obtenerNivelDeUsuario(uid);
check('al superar 101 puntos el nivel sube solo a 2', tras150.nivel_actual === 2, `(dio ${tras150.nivel_actual})`);
check('el historial registro la subida al nivel 2',
  tras150.historial.some(h => h.level === 2));

const { rows:[cache1] } = await pg.query(`SELECT level FROM users WHERE id=$1`, [uid]);
check('users.level quedo sincronizado como cache', cache1.level === 2, `(cache dice ${cache1.level})`);

// Salto grande: de 150 a 1550 cruza los niveles 3, 4 y 5 de una sola vez
await points.registrarMovimiento({
  userId: uid, sourceType:'manual', sourceId:'seed2', points:1400,
  ruleCode:'manual', idempotencyKey:`manual:${uid}:seed2`
});
await eventBus.procesarPendientes();

const tras1550 = await levels.obtenerNivelDeUsuario(uid);
check('un solo movimiento grande lleva al nivel correcto', tras1550.nivel_actual === 5, `(dio ${tras1550.nivel_actual})`);
check('se registran TODOS los niveles intermedios, no solo el ultimo',
  [1,2,3,4,5].every(n => tras1550.historial.some(h => h.level === n)),
  `(registrados: ${tras1550.historial.map(h=>h.level).join(',')})`);

// Reprocesar el mismo evento no debe duplicar nada
await levels.sincronizarNivel({ userId: uid });
const { rows:[dup] } = await pg.query(
  `SELECT COUNT(*)::int n FROM user_level_history WHERE user_id=$1 AND level=5`, [uid]);
check('reevaluar no duplica el registro de un nivel ya alcanzado', dup.n === 1, `(hay ${dup.n})`);

// ---------------------------------------------------------------------
console.log('\n--- HISTORIAL INMUTABLE ---');

let errUpd = null;
try { await pg.query(`UPDATE user_level_history SET level_name='Hackeado' WHERE user_id=$1`, [uid]); }
catch (e) { errUpd = e; }
check('UPDATE bloqueado por trigger', !!errUpd);

let errDel = null;
try { await pg.query(`DELETE FROM user_level_history WHERE user_id=$1`, [uid]); }
catch (e) { errDel = e; }
check('DELETE bloqueado por trigger', !!errDel);

// Criterio tecnico 3: el nivel es derivado. Si cambian los umbrales, el nivel
// que se muestra cambia; el historial de lo ya alcanzado no se toca.
await pg.query(`UPDATE levels_config SET min_points = 5000 WHERE level = 5`);
const escaleraNueva = await levels.obtenerEscalera();
const trasCambio = levels.calcularProgreso(1550, escaleraNueva);
check('subir un umbral baja el nivel mostrado (es derivado, no almacenado)',
  trasCambio.nivel_actual === 4, `(dio ${trasCambio.nivel_actual})`);

const historialTrasCambio = await levels.obtenerHistorialNiveles(uid);
check('pero el historial conserva que ese nivel se alcanzo, con su umbral viejo',
  historialTrasCambio.some(h => h.level === 5 && h.min_points === 1501));

await pg.query(`UPDATE levels_config SET min_points = 1501 WHERE level = 5`);

// ---------------------------------------------------------------------
console.log('\n--- NIVELES DESACTIVADOS ---');

await pg.query(`UPDATE levels_config SET is_active = false WHERE level = 3`);
const sinNivel3 = await levels.obtenerEscalera();
check('un nivel inactivo desaparece de la escalera',
  !sinNivel3.some(n => n.level === 3) && sinNivel3.length === 5);
check('los tramos se recalculan sin dejar huecos',
  levels.calcularProgreso(400, sinNivel3).nivel_actual === 2,
  `(dio ${levels.calcularProgreso(400, sinNivel3).nivel_actual})`);
await pg.query(`UPDATE levels_config SET is_active = true WHERE level = 3`);

check('todas las conexiones se devolvieron al pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
