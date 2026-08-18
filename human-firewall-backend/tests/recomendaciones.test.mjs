import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

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
await pg.exec(`
  INSERT INTO users (email,password,role) VALUES ('ana@hf.com','x','employee');
  INSERT INTO users (email,password,role) VALUES ('beto@hf.com','x','employee');
`);

for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking',
                 '004_event_outbox','005_rol_rh','006_rewards_catalog','007_user_rewards',
                 '008_desafios_faltantes','020_levels_config','021_user_level_history',
                 '022_recommendation_rules','023_cursos_de_refuerzo']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas\n');

const reco = require_('./services/recommendations.service');

const { rows:[a] } = await pg.query(`SELECT id FROM users WHERE email='ana@hf.com'`);
const { rows:[b] } = await pg.query(`SELECT id FROM users WHERE email='beto@hf.com'`);
const ana = a.id, beto = b.id;

// Curso con lecciones + una simulacion asociada.
await pg.exec(`
  INSERT INTO courses (id, title) VALUES (10,'Ingenieria Social'), (11,'Phishing 101');
  INSERT INTO course_contents (id, course_id, content_type, body, order_idx, points_reward) VALUES
    (100,10,'text','Senales de urgencia fabricada',1,20),
    (101,10,'video','Verificacion por canal alternativo',2,20),
    (102,11,'text','Como leer un remitente',1,15);
  INSERT INTO course_assignments (course_id, user_id, status) VALUES (10, ${ana}, 'assigned');
  INSERT INTO simulations (id, title, course_id) VALUES (50,'Fraude del CEO',10), (51,'Correo falso',11);
`);

// ---------------------------------------------------------------------
console.log('--- REGLA CONFIGURABLE ---');

const regla = await reco.obtenerRegla();
check('lee la regla de la base, no del codigo', regla.code === 'refuerzo_por_puntaje_bajo');
check('el umbral por defecto es 70', regla.score_threshold === 70, `(dio ${regla.score_threshold})`);

let errChk = null;
try { await pg.query(`INSERT INTO recommendation_rules (code, score_threshold) VALUES ('mala', 150)`); }
catch (e) { errChk = e; }
check('un umbral fuera de 0..100 se rechaza', !!errChk);

// ---------------------------------------------------------------------
console.log('\n--- AREAS DE OPORTUNIDAD ---');

await pg.query(
  `INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, course_id, score, passing_score, passed, attempt_no, created_at) VALUES
     ($1,'50','simulation',10,40,60,false,1, now() - interval '6 days'),
     ($1,'50','simulation',10,55,60,false,2, now() - interval '4 days'),
     ($1,'50','simulation',10,65,60,true, 3, now() - interval '2 days'),
     ($1,'wifi','challenge',NULL,100,60,true,1, now() - interval '1 day')`,
  [ana]
);

const evaluaciones = await reco.obtenerEvaluaciones(ana);
check('agrupa los intentos por evaluacion', evaluaciones.length === 2, `(dio ${evaluaciones.length})`);

const fraude = evaluaciones.find(e => e.quiz_ref === '50');
check('resuelve el titulo de una simulacion desde quiz_ref numerico',
  fraude?.titulo === 'Fraude del CEO', `(dio ${fraude?.titulo})`);
check('resuelve el titulo de un desafio desde quiz_ref de texto',
  evaluaciones.find(e => e.quiz_ref === 'wifi')?.titulo === 'Wi-Fi Seguro');
check('toma el mejor puntaje de los 3 intentos', fraude?.mejor_puntaje === 65, `(dio ${fraude?.mejor_puntaje})`);
check('cuenta los intentos', fraude?.intentos === 3, `(dio ${fraude?.intentos})`);
check('marca como aprobada si alguna vez se aprobo', fraude?.aprobada === true);

const areas = reco.filtrarAreasDeOportunidad(evaluaciones, regla);
check('una evaluacion aprobada pero por debajo del umbral SI es area de oportunidad',
  areas.length === 1 && areas[0].quiz_ref === '50', `(dio ${areas.length})`);
check('una evaluacion con 100% no aparece como area',
  !areas.some(x => x.quiz_ref === 'wifi'));
check('el motivo explica por que aparece', /65%/.test(areas[0].motivo) && /70%/.test(areas[0].motivo),
  `("${areas[0].motivo}")`);

// Quien saca 45 y despues 90 ya domina el tema: deja de ser area.
const superado = reco.filtrarAreasDeOportunidad(
  [{ quiz_ref:'x', aprobada:true, mejor_puntaje:90, ultimo_puntaje:90, ultimo_aprobado:true, titulo:'X' }], regla);
check('mejorar hasta superar el umbral saca la evaluacion de las areas', superado.length === 0);

// El caso que faltaba: aprobo con 100 y despues fallo. El maximo historico
// decia "todo bien" mientras el usuario acababa de equivocarse.
const retroceso = reco.filtrarAreasDeOportunidad(
  [{ quiz_ref:'data', aprobada:true, mejor_puntaje:100, ultimo_puntaje:0, ultimo_aprobado:false, titulo:'Proteccion de Datos' }], regla);
check('aprobar antes y fallar despues SI es area de oportunidad',
  retroceso.length === 1, `(dio ${retroceso.length})`);
check('el motivo dice que hubo un retroceso',
  /aprobaste antes/i.test(retroceso[0]?.motivo || ''), `("${retroceso[0]?.motivo}")`);
check('marca la bandera de retroceso para la interfaz', retroceso[0]?.retrocedio === true);

// Bajar de nota sin llegar a reprobar tambien cuenta.
const bajon = reco.filtrarAreasDeOportunidad(
  [{ quiz_ref:'y', aprobada:true, mejor_puntaje:95, ultimo_puntaje:62, ultimo_aprobado:true, titulo:'Y' }], regla);
check('bajar por debajo del umbral sin reprobar tambien es area', bajon.length === 1);

// La comparacion es estricta (score < umbral), asi que con umbral 100 un
// puntaje de 100 queda fuera. Para exigir la perfeccion hay que poner 101.
const conUmbralExigente = reco.filtrarAreasDeOportunidad(evaluaciones, { ...regla, score_threshold: 101 });
check('subir el umbral en la regla suma areas, sin tocar codigo',
  conUmbralExigente.length === 2, `(dio ${conUmbralExigente.length})`);

const conUmbralLaxo = reco.filtrarAreasDeOportunidad(evaluaciones, { ...regla, score_threshold: 60 });
check('bajar el umbral las quita: con 60, un 65 ya alcanza',
  conUmbralLaxo.length === 0, `(dio ${conUmbralLaxo.length})`);

// ---------------------------------------------------------------------
console.log('\n--- RECOMENDACIONES DE REFUERZO ---');

const sugerencias = await reco.generarRecomendaciones(ana, areas, regla);
check('sugiere lecciones del MISMO curso de la evaluacion floja',
  sugerencias.length === 2 && sugerencias.every(s => s.course_id === 10),
  `(dio ${sugerencias.length})`);
check('no sugiere lecciones de un curso sin problemas',
  !sugerencias.some(s => s.course_id === 11));
check('el motivo cita la evaluacion que la origino',
  /Fraude del CEO/.test(sugerencias[0].motivo), `("${sugerencias[0].motivo}")`);

// Completar una leccion la saca de las sugerencias
await pg.query(`INSERT INTO lesson_progress (user_id, content_id) VALUES ($1, 100)`, [ana]);
const trasCompletar = await reco.generarRecomendaciones(ana, areas, regla);
check('una leccion ya completada deja de sugerirse',
  trasCompletar.length === 1 && trasCompletar[0].content_id === 101,
  `(dio ${trasCompletar.map(s=>s.content_id)})`);

const topeado = await reco.generarRecomendaciones(ana, areas, { ...regla, max_suggestions: 1 });
check('max_suggestions limita la lista', topeado.length === 1);

const sinAreas = await reco.generarRecomendaciones(ana, [], regla);
check('sin areas de oportunidad no hay nada que sugerir', sinAreas.length === 0);

// En un retroceso el motivo debe citar el ultimo puntaje, no el mejor: decir
// "sugerido porque tu puntaje fue 100%" contradice el area de oportunidad.
const areaRetroceso = [{
  quiz_ref:'data', course_id:11, titulo:'Proteccion de Datos', aprobada:true,
  mejor_puntaje:100, ultimo_puntaje:0, retrocedio:true
}];
const recoRetroceso = await reco.generarRecomendaciones(ana, areaRetroceso, regla);
check('el motivo de un retroceso cita el ultimo puntaje, no el mejor',
  recoRetroceso.length > 0 && /bajó a 0%/.test(recoRetroceso[0].motivo) && !/100%/.test(recoRetroceso[0].motivo),
  `("${recoRetroceso[0]?.motivo}")`);

// ---------------------------------------------------------------------
console.log('\n--- EVOLUCION CONTRA EL PROPIO HISTORIAL ---');

const evo = await reco.obtenerEvolucion(ana, 2);
check('la serie viene en orden cronologico',
  evo.serie.every((p, i) => i === 0 || new Date(p.created_at) >= new Date(evo.serie[i-1].created_at)));
check('calcula el promedio general', evo.promedio_general === 65, `(dio ${evo.promedio_general})`);
check('compara los intentos recientes contra los previos',
  evo.promedio_reciente === 83 && evo.promedio_previo === 48,
  `(reciente ${evo.promedio_reciente}, previo ${evo.promedio_previo})`);
check('detecta que va mejorando', evo.tendencia === 'mejorando', `(dio ${evo.tendencia})`);

const evoBeto = await reco.obtenerEvolucion(beto);
check('sin intentos no inventa una tendencia',
  evoBeto.tendencia === 'sin_datos' && evoBeto.promedio_general === null);

// La ventana fija de 5 se comia la serie entera: con exactamente 5 intentos
// no quedaba nada en "previos" y la pantalla decia "no hay suficientes
// intentos para comparar" mostrando cinco puntos en el grafico.
const evoPorDefecto = await reco.obtenerEvolucion(ana);
check('con 4 intentos y ventana por defecto 5, igual compara',
  evoPorDefecto.tendencia !== 'sin_datos',
  `(tendencia ${evoPorDefecto.tendencia}, serie de ${evoPorDefecto.total_intentos})`);
check('la ventana se recorta a la mitad de la serie',
  evoPorDefecto.ventana === Math.floor(evoPorDefecto.total_intentos / 2),
  `(ventana ${evoPorDefecto.ventana} sobre ${evoPorDefecto.total_intentos} intentos)`);

// Con un solo intento si es honesto decir que no hay con que comparar.
// Se usa un tercer usuario para no ensuciar a beto, que mas abajo sirve para
// verificar el aislamiento entre usuarios.
await pg.query(`INSERT INTO users (email,password,role) VALUES ('caro@hf.com','x','employee')`);
const { rows:[c] } = await pg.query(`SELECT id FROM users WHERE email='caro@hf.com'`);
await pg.query(
  `INSERT INTO quiz_attempts (user_id, quiz_ref, quiz_type, score, passing_score, passed, attempt_no)
   VALUES ($1,'social','challenge',100,60,true,1)`, [c.id]);
const evoUno = await reco.obtenerEvolucion(c.id);
check('con un solo intento sigue sin haber tendencia', evoUno.tendencia === 'sin_datos',
  `(dio ${evoUno.tendencia})`);

// ---------------------------------------------------------------------
console.log('\n--- AISLAMIENTO ENTRE USUARIOS (criterio de aceptacion 3) ---');

const resumenBeto = await reco.obtenerResumenDesempeno(beto);
check('otro usuario no ve las evaluaciones ajenas',
  resumenBeto.resumen.evaluaciones_realizadas === 0, `(dio ${resumenBeto.resumen.evaluaciones_realizadas})`);
check('otro usuario no hereda areas de oportunidad ajenas',
  resumenBeto.areas_de_oportunidad.length === 0);
check('otro usuario no recibe recomendaciones ajenas',
  resumenBeto.recomendaciones.length === 0);
check('el promedio de otro usuario no se contamina con el ajeno',
  resumenBeto.resumen.promedio_general === null);

// ---------------------------------------------------------------------
console.log('\n--- PENDIENTES Y AVANCE ---');

const pendientes = await reco.obtenerPendientes(ana);
check('las evaluaciones ya intentadas no figuran como pendientes',
  !pendientes.some(p => p.quiz_ref === '50' || p.quiz_ref === 'wifi'));
check('los desafios del portal se ofrecen a todos, con o sin curso asignado',
  pendientes.some(p => p.quiz_ref === 'phishing'));
check('las simulaciones si respetan la asignacion del curso (RN-01)',
  !pendientes.some(p => p.quiz_ref === '51'),
  `(pendientes: ${pendientes.map(p=>p.quiz_ref).join(',')})`);

// Un desafio enlazado a un curso que el usuario NO tiene asignado igual se
// ofrece: es la regresion que introdujo la migracion 023 al ponerles course_id.
await pg.query(`UPDATE challenges SET course_id = 11 WHERE id = 'data'`);
const trasEnlazar = await reco.obtenerPendientes(ana);
check('enlazar un desafio a un curso no lo esconde del portal',
  trasEnlazar.some(p => p.quiz_ref === 'data'),
  `(pendientes: ${trasEnlazar.map(p=>p.quiz_ref).join(',')})`);
await pg.query(`UPDATE challenges SET course_id = NULL WHERE id = 'data'`);

const cursos = await reco.obtenerAvanceCursos(ana);
// La migracion 023 asigna sus cinco cursos de refuerzo a todos los usuarios,
// asi que aca hay 6: esos cinco mas el curso 10 que arma esta prueba.
const curso10 = cursos.find(c => c.course_id === 10);
check('calcula el avance del curso asignado',
  curso10?.lecciones_totales === 2 && curso10?.lecciones_completadas === 1,
  `(${JSON.stringify(curso10)})`);
check('el porcentaje de avance es correcto', curso10?.porcentaje === 50, `(dio ${curso10?.porcentaje}%)`);
check('los cursos de refuerzo de la migracion 023 quedan asignados',
  cursos.filter(c => c.course_id >= 901 && c.course_id <= 905).length === 5,
  `(hay ${cursos.length} cursos)`);

// ---------------------------------------------------------------------
console.log('\n--- SOLO LECTURA (criterio tecnico 4) ---');

const { rows:[antesQ] } = await pg.query(`SELECT COUNT(*)::int n FROM quiz_attempts`);
const { rows:[antesL] } = await pg.query(`SELECT COUNT(*)::int n FROM lesson_progress`);
await reco.obtenerResumenDesempeno(ana);
const { rows:[despuesQ] } = await pg.query(`SELECT COUNT(*)::int n FROM quiz_attempts`);
const { rows:[despuesL] } = await pg.query(`SELECT COUNT(*)::int n FROM lesson_progress`);
check('generar el resumen no toca quiz_attempts', antesQ.n === despuesQ.n);
check('generar el resumen no toca lesson_progress', antesL.n === despuesL.n);

// ---------------------------------------------------------------------
// Sin esto, la HU entera queda muerta: si un fallo no se registra, no hay
// areas de oportunidad y por lo tanto no hay nada que recomendar.
console.log('\n--- REGISTRO DE INTENTOS FALLIDOS ---');

const controller = require_('./controllers/gamification.controller');
const eventBus2 = require_('./services/eventBus');

// Stubs minimos de req/res para ejercitar el controlador real.
const llamar = async (userId, body) => {
    let estado = 0, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await controller.completeChallenge({ body, user: { id: userId } }, res);
    return { estado, cuerpo };
};

const perdido = await llamar(beto, { challengeId: 'phishing', passed: false });
check('perder devuelve 0 puntos estimados', perdido.cuerpo?.puntos_estimados === 0,
  `(${JSON.stringify(perdido.cuerpo)})`);
check('la respuesta dice que no se aprobo', perdido.cuerpo?.aprobado === false);

const { rows:[fallido] } = await pg.query(
  `SELECT score, passed FROM quiz_attempts WHERE user_id=$1 AND quiz_ref='phishing'`, [beto]);
check('el intento fallido SI queda en quiz_attempts',
  fallido?.passed === false && fallido?.score === 0, `(${JSON.stringify(fallido)})`);

const { rows: ganados } = await pg.query(
  `SELECT 1 FROM user_challenge_results WHERE user_id=$1 AND challenge_id='phishing'`, [beto]);
check('perder no marca el desafio como ganado', ganados.length === 0);

await eventBus2.procesarPendientes();
const { rows:[puntosTrasFallo] } = await pg.query(
  `SELECT COALESCE(SUM(points),0)::int AS t FROM points_ledger WHERE user_id=$1`, [beto]);
check('perder no otorga puntos', puntosTrasFallo.t === 0, `(dio ${puntosTrasFallo.t})`);

// Y ahora el fallo se traduce en una recomendacion real.
await pg.query(`UPDATE challenges SET course_id = 11 WHERE id = 'phishing'`);
await pg.query(`UPDATE quiz_attempts SET course_id = 11 WHERE user_id=$1 AND quiz_ref='phishing'`, [beto]);
await pg.query(`INSERT INTO course_assignments (course_id, user_id, status) VALUES (11, $1, 'assigned')
                ON CONFLICT DO NOTHING`, [beto]);

const resumenTrasFallo = await reco.obtenerResumenDesempeno(beto);
check('el fallo aparece como area de oportunidad',
  resumenTrasFallo.areas_de_oportunidad.some(a => a.quiz_ref === 'phishing'),
  `(areas: ${resumenTrasFallo.areas_de_oportunidad.length})`);
check('y genera una recomendacion de refuerzo del curso relacionado',
  resumenTrasFallo.recomendaciones.length > 0 && resumenTrasFallo.recomendaciones[0].course_id === 11,
  `(recos: ${resumenTrasFallo.recomendaciones.length})`);
check('el motivo dice que todavia no la aprobo',
  /no aprobás|no aprobas/i.test(resumenTrasFallo.areas_de_oportunidad.find(a => a.quiz_ref === 'phishing').motivo));

// Reintentar y aprobar si otorga puntos.
const ganado = await llamar(beto, { challengeId: 'phishing', passed: true });
check('reintentar y aprobar si otorga puntos', ganado.cuerpo?.puntos_estimados > 0,
  `(${JSON.stringify(ganado.cuerpo)})`);

const { rows:[intentos] } = await pg.query(
  `SELECT COUNT(*)::int n FROM quiz_attempts WHERE user_id=$1 AND quiz_ref='phishing'`, [beto]);
check('quedan los dos intentos en el historial', intentos.n === 2, `(hay ${intentos.n})`);

// Compatibilidad: un cliente viejo que no manda `passed` sigue funcionando.
const sinCampo = await llamar(beto, { challengeId: 'wifi' });
check('sin el campo passed se asume aprobado (cliente viejo)', sinCampo.cuerpo?.aprobado === true);

check('todas las conexiones se devolvieron al pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
