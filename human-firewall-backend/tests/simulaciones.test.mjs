import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

// Mismo arranque que el resto de las pruebas: PostgreSQL real compilado a
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
await pg.exec(`
  INSERT INTO users (email,password,role) VALUES ('emp@hf.com','x','employee');
  INSERT INTO users (email,password,role) VALUES ('instru@hf.com','x','instructor');
`);

for (const f of ['001_points_ledger','002_points_rules','003_lesson_quiz_tracking',
                 '004_event_outbox','005_rol_rh','006_rewards_catalog','007_user_rewards',
                 '008_desafios_faltantes','020_levels_config','021_user_level_history',
                 '022_recommendation_rules','023_cursos_de_refuerzo','024_simulacion_de_ejemplo']) {
  try { await pg.exec(readFileSync(`${DIR}migrations/${f}.sql`, 'utf8')); }
  catch (e) { console.log(`ERROR en ${f}: ${msg(e)}`); fallos++; }
}
console.log('Migraciones aplicadas\n');

const controller = require_('./controllers/simulation.controller');

const { rows:[e] } = await pg.query(`SELECT id FROM users WHERE email='emp@hf.com'`);
const { rows:[i] } = await pg.query(`SELECT id FROM users WHERE email='instru@hf.com'`);
const empleado = e.id, instructor = i.id;

/** Stubs de req/res para ejercitar el controlador real. */
const llamar = async (handler, { user, params = {}, body = {} }) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ user, params, body }, res);
    return { estado, cuerpo };
};

// ---------------------------------------------------------------------
console.log('--- SIMULACION SEMBRADA (migracion 024) ---');

const { rows:[sim] } = await pg.query(`SELECT id, title, course_id, difficulty FROM simulations WHERE id=910`);
check('la migracion carga la simulacion de ejemplo', !!sim);
check('queda enlazada a un curso, para poder recomendar refuerzos', sim?.course_id === 901,
  `(curso ${sim?.course_id})`);

const { rows:[conteo] } = await pg.query(
  `SELECT COUNT(DISTINCT st.id)::int pasos, COUNT(o.id)::int opciones
     FROM simulation_steps st JOIN simulation_options o ON o.step_id = st.id
    WHERE st.simulation_id = 910`);
check('tiene 3 pasos y 9 opciones', conteo.pasos === 3 && conteo.opciones === 9,
  `(${conteo.pasos} pasos, ${conteo.opciones} opciones)`);

// ---------------------------------------------------------------------
console.log('\n--- LISTADO (el endpoint que faltaba) ---');

// Sin este endpoint no habia forma de saber que simulaciones existen: el
// frontend tenia que adivinar el id.
//
// La 910 sale de la migracion 024 y esta en el curso 901, que la 023 le
// asigna a todos los usuarios existentes, asi que el empleado ya la ve.
const listaEmpleado = await llamar(controller.listSimulations, { user: { id: empleado, role: 'employee' } });
check('el empleado ve la simulacion de un curso que tiene asignado',
  listaEmpleado.cuerpo.some(s => s.id === 910),
  `(vio ${listaEmpleado.cuerpo.map(s => s.id)})`);
check('el listado informa cuantos pasos tiene',
  listaEmpleado.cuerpo.find(s => s.id === 910)?.pasos === 3);
check('y si el usuario ya la intento', listaEmpleado.cuerpo.find(s => s.id === 910)?.intentada === false);

// Para probar el filtro por asignacion hace falta un curso que el empleado
// NO tenga: los de la migracion 023 los tiene todos.
await pg.exec(`
  INSERT INTO courses (id, title) VALUES (950, 'Curso restringido');
  INSERT INTO simulations (id, title, course_id) VALUES (950, 'Solo para asignados', 950);
  INSERT INTO simulation_steps (id, simulation_id, scenario_text, order_idx) VALUES (9501, 950, 'X', 1);
  INSERT INTO simulation_options (id, step_id, option_text, is_correct, points_awarded)
    VALUES (95011, 9501, 'Unica', true, 10);
`);

const sinAsignar = await llamar(controller.listSimulations, { user: { id: empleado, role: 'employee' } });
check('una simulacion de un curso NO asignado no se le ofrece (RN-01)',
  !sinAsignar.cuerpo.some(s => s.id === 950),
  `(vio ${sinAsignar.cuerpo.map(s => s.id)})`);

await pg.query(`INSERT INTO course_assignments (course_id, user_id, status) VALUES (950, $1, 'assigned')`, [empleado]);
const trasAsignar = await llamar(controller.listSimulations, { user: { id: empleado, role: 'employee' } });
check('al asignarle el curso, esa simulacion aparece',
  trasAsignar.cuerpo.some(s => s.id === 950));

// Una simulacion sin pasos no se le ofrece al empleado: abriria una pantalla
// vacia, sin nada que responder.
await pg.query(`INSERT INTO simulations (id, title, course_id) VALUES (911, 'Vacia', 901)`);
const conVacia = await llamar(controller.listSimulations, { user: { id: empleado, role: 'employee' } });
check('una simulacion sin pasos no se le ofrece al empleado',
  !conVacia.cuerpo.some(s => s.id === 911));
const comoInstructor = await llamar(controller.listSimulations, { user: { id: instructor, role: 'instructor' } });
check('pero el instructor si la ve, para poder terminarla',
  comoInstructor.cuerpo.some(s => s.id === 911));

// ---------------------------------------------------------------------
console.log('\n--- CIERRE DE LA SIMULACION ---');

// Antes nadie escribia una fila en quiz_attempts para una simulacion: una
// simulacion terminada no existia para el resumen de desempeno ni para las
// recomendaciones.
const correctas = await pg.query(
  `SELECT o.id FROM simulation_options o JOIN simulation_steps st ON st.id = o.step_id
    WHERE st.simulation_id = 910 AND o.is_correct = true ORDER BY st.order_idx`);
const idsCorrectas = correctas.rows.map(r => r.id);

const perfecto = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' }, body: { decisiones: idsCorrectas }
});
check('todas correctas dan 100%', perfecto.cuerpo?.score === 100, `(dio ${perfecto.cuerpo?.score})`);
check('y la marca como aprobada', perfecto.cuerpo?.aprobada === true);
check('cuenta los aciertos', perfecto.cuerpo?.aciertos === 3 && perfecto.cuerpo?.pasos === 3);

const { rows:[intento] } = await pg.query(
  `SELECT score, passed, course_id, quiz_type FROM quiz_attempts
    WHERE user_id=$1 AND quiz_ref='910'`, [empleado]);
check('el intento queda registrado en quiz_attempts', !!intento);
check('con el tipo y el curso correctos',
  intento?.quiz_type === 'simulation' && intento?.course_id === 901);

// Puntaje parcial: la opcion mediocre del paso 2 otorga 10 de 30.
const { rows: parciales } = await pg.query(
  `SELECT o.id, o.points_awarded, st.order_idx
     FROM simulation_options o JOIN simulation_steps st ON st.id = o.step_id
    WHERE st.simulation_id = 910 AND o.points_awarded = 10`);
const mezcla = [idsCorrectas[0], parciales.rows?.[0]?.id ?? parciales[0].id, idsCorrectas[2]];
const parcial = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' }, body: { decisiones: mezcla }
});
check('el puntaje se calcula sobre la mejor opcion de cada paso (40+10+30 de 100)',
  parcial.cuerpo?.score === 80, `(dio ${parcial.cuerpo?.score})`);
check('el segundo intento se numera como tal', parcial.cuerpo?.intento_no === 2,
  `(dio ${parcial.cuerpo?.intento_no})`);

// ---------------------------------------------------------------------
console.log('\n--- EL PUNTAJE NO SE ACEPTA DEL CLIENTE ---');

// Si el score viajara en el cuerpo, cualquiera aprobaria mandando {score:100}.
const inventado = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' },
    body: { decisiones: [idsCorrectas[0]], score: 100, aprobada: true }
});
check('un score enviado por el cliente se ignora',
  inventado.cuerpo?.score === 40, `(dio ${inventado.cuerpo?.score})`);

// Una opcion de otra simulacion inflaria el puntaje de esta.
await pg.exec(`
  INSERT INTO simulations (id, title) VALUES (912, 'Otra');
  INSERT INTO simulation_steps (id, simulation_id, scenario_text, order_idx) VALUES (9121, 912, 'X', 1);
  INSERT INTO simulation_options (id, step_id, option_text, is_correct, points_awarded)
    VALUES (91211, 9121, 'Opcion ajena', true, 999);
`);
const ajena = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' }, body: { decisiones: [91211] }
});
check('una opcion de otra simulacion se rechaza', ajena.estado === 400, `(HTTP ${ajena.estado})`);

const vacio = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' }, body: { decisiones: [] }
});
check('cerrar sin decisiones se rechaza', vacio.estado === 400);

const inexistente = await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '99999' }, body: { decisiones: [1] }
});
check('una simulacion inexistente da 404', inexistente.estado === 404);

// ---------------------------------------------------------------------
console.log('\n--- ALIMENTA EL RESUMEN DE DESEMPENO ---');

const reco = require_('./services/recommendations.service');
const resumen = await reco.obtenerResumenDesempeno(empleado);
check('la simulacion aparece entre las evaluaciones realizadas',
  resumen.evolucion.serie.some(s => s.quiz_ref === '910'),
  `(serie: ${resumen.evolucion.serie.map(s => s.quiz_ref).join(',')})`);
check('resuelve su titulo desde la tabla simulations',
  resumen.evolucion.serie.find(s => s.quiz_ref === '910')?.titulo === 'Correo del proveedor con factura adjunta');

// Un intento flojo la convierte en area de oportunidad con refuerzos.
const flojas = await pg.query(
  `SELECT o.id FROM simulation_options o JOIN simulation_steps st ON st.id = o.step_id
    WHERE st.simulation_id = 910 AND o.points_awarded = 0 ORDER BY st.order_idx`);
await llamar(controller.completeSimulation, {
    user: { id: empleado }, params: { simulationId: '910' },
    body: { decisiones: flojas.rows.map(r => r.id) }
});

const trasFallar = await reco.obtenerResumenDesempeno(empleado);
check('fallarla la marca como area de oportunidad',
  trasFallar.areas_de_oportunidad.some(a => a.quiz_ref === '910'),
  `(areas: ${trasFallar.areas_de_oportunidad.map(a => a.quiz_ref).join(',')})`);
check('y genera refuerzos del curso de la simulacion',
  trasFallar.recomendaciones.some(r => r.course_id === 901),
  `(recos de cursos: ${trasFallar.recomendaciones.map(r => r.course_id).join(',')})`);

check('todas las conexiones se devolvieron al pool', conexionesAbiertas === 0, `(quedaron ${conexionesAbiertas})`);

console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
