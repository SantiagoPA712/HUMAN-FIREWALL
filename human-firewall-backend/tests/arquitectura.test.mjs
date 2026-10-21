/**
 * HU: arquitectura de microservicios por capas y contratos de API.
 *
 * Pruebas de ARQUITECTURA. Leen el codigo (sin ejecutar casos de uso) y
 * convierten en reglas verificables lo que la HU pide:
 *
 *   - cada servicio tiene la misma forma y una ficha (manifiesto) veraz;
 *   - las capas se respetan: ningun controlador habla con la base y el
 *     dominio no depende de nada tecnico;
 *   - un servicio llega a otro SOLO por su contrato (index.js), y solo desde
 *     un cliente en infrastructure/client/;
 *   - nadie escribe en tablas de otro servicio, y toda lectura ajena esta
 *     declarada con su motivo;
 *   - los eventos que cada manifiesto dice publicar y consumir son los que
 *     el codigo publica y consume;
 *   - compartido/ no depende de ningun servicio.
 *
 * Si alguien agrega mañana un require directo a un archivo interno de otro
 * servicio, o un SELECT a una tabla ajena sin declararlo, esta suite falla y
 * dice donde.
 */

import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const require_ = createRequire(`${DIR}src/server.js`);

let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const lista = (xs) => xs.length ? `\n        ${xs.join('\n        ')}` : '';

const log = console.log;
console.log = () => {};
const a = require_('./compartido/arquitectura/analizador');
const { SERVICIOS } = require_('./servicios');
const { EVENTOS } = require_('./compartido/eventos/catalogo');
console.log = log;

const NOMBRES = a.listarServicios();
const manifiestos = Object.fromEntries(SERVICIOS.map(s => [s.manifiesto.nombre, s.manifiesto]));
const analisis = Object.fromEntries(NOMBRES.map(n => [n, a.analizarServicio(n)]));
const DB = path.join(a.DIR_SRC, 'compartido', 'config', 'db.js');

// =====================================================================
console.log('--- ESTRUCTURA DE CADA SERVICIO (criterios de aceptacion 1, 2 y 9) ---');
// =====================================================================

check('el registro (servicios/index.js) tiene todas las carpetas de servicios',
    JSON.stringify(Object.keys(manifiestos).sort()) === JSON.stringify(NOMBRES),
    `(${Object.keys(manifiestos).sort()} vs ${NOMBRES})`);

for (const nombre of NOMBRES) {
    const base = path.join(a.DIR_SERVICIOS, nombre);
    // Las capas de la seccion 11 del material: controller, application,
    // domain, infrastructure y la configuracion propia del servicio.
    const faltan = ['index.js', 'manifiesto.js', 'README.md', 'controller', 'application', 'domain', 'infrastructure',
                    'config/configuracion.js', 'contract/openapi.js', 'controller/dto.js']
        .filter(p => !existsSync(path.join(base, p)));
    check(`${nombre}: tiene index, manifiesto, README, controller, application, domain, infrastructure, config, DTO y contrato`,
        faltan.length === 0, `(faltan: ${faltan.join(', ')})`);

    const m = manifiestos[nombre];
    const campos = ['nombre', 'responsabilidad', 'prefijos', 'tablas', 'publica', 'consume', 'dependeDe',
                    'lecturasCompartidas', 'escriturasCompartidas', 'procesos'];
    check(`${nombre}: el manifiesto declara todos sus campos`, m && campos.every(c => m[c] !== undefined));

    const capasRaras = analisis[nombre]
        .map(f => f.capa)
        .filter(c => !['controller', 'application', 'domain', 'infrastructure', 'contract', 'config', '(raiz)'].includes(c));
    check(`${nombre}: no hay carpetas fuera de las capas definidas`, capasRaras.length === 0, `(${[...new Set(capasRaras)]})`);
}

// =====================================================================
console.log('\n--- CAPAS (criterios tecnicos 3 y 4) ---');
// =====================================================================

const todos = NOMBRES.flatMap(n => analisis[n]);

const apiConBase = todos.filter(f => f.capa === 'controller' && f.requires.some(r => r.destino === DB));
check('ningun controlador ni archivo de rutas importa la base de datos', apiConBase.length === 0,
    lista(apiConBase.map(f => f.relativo)));

const apiConSql = todos.filter(f => f.capa === 'controller' && (f.lecturas.length || f.escrituras.length));
check('ningun archivo de la capa api tiene SQL', apiConSql.length === 0, lista(apiConSql.map(f => f.relativo)));

const dominioImpuro = todos.filter(f => f.capa === 'domain' && f.requires.some(r => !r.destino.includes(`${path.sep}domain${path.sep}`)));
check('la capa de dominio no depende de nada fuera del dominio (ni base, ni bus, ni HTTP)',
    dominioImpuro.length === 0, lista(dominioImpuro.map(f => `${f.relativo} -> ${f.requires.map(r => r.especificador)}`)));

const dominioConSql = todos.filter(f => f.capa === 'domain' && (f.lecturas.length || f.escrituras.length));
check('la capa de dominio no tiene SQL', dominioConSql.length === 0, lista(dominioConSql.map(f => f.relativo)));

// El controller solo puede usar, de infrastructure, el cliente de auditoria
// (registra quien hizo que con los datos del request). Lo demas pasa por application/.
const controllerConInfra = todos.filter(f => f.capa === 'controller' &&
    f.requires.some(r => r.destino.includes(`${path.sep}infrastructure${path.sep}`) &&
                         !r.destino.endsWith(`${path.sep}seguridad.cliente.js`)));
check('el controller delega en application: no usa repositorios ni otros servicios directo', controllerConInfra.length === 0,
    lista(controllerConInfra.map(f => f.relativo)));

// Seccion 11: cada servicio tiene su propia configuracion (application.yml).
// Las capas no leen process.env sueltas: piden el valor a config/.
const leeEntorno = todos.filter(f => ['controller', 'application', 'domain', 'infrastructure'].includes(f.capa) &&
    /process\.env\.(?!NODE_ENV\b)[A-Z_]+/.test(readFileSync(f.archivo, 'utf8')));
check('las variables de entorno de cada servicio se leen solo en su config/', leeEntorno.length === 0,
    lista(leeEntorno.map(f => f.relativo)));

const contratoConBase = todos.filter(f => f.capa === 'contract' && f.requires.some(r => r.destino === DB));
check('los contratos no tocan la base', contratoConBase.length === 0);

// =====================================================================
console.log('\n--- COMUNICACION ENTRE SERVICIOS (criterio de aceptacion 5) ---');
// =====================================================================

const esCliente = (f) => /\/infrastructure\/client\/[a-z]+\.cliente\.js$/.test(f.relativo);
const violaciones = [];
const dependenciasReales = Object.fromEntries(NOMBRES.map(n => [n, new Set()]));

for (const nombre of NOMBRES) {
    for (const f of analisis[nombre]) {
        for (const r of f.requires) {
            const otro = a.servicioDe(r.destino);
            if (!otro || otro === nombre) continue;
            const esIndex = r.destino === path.join(a.DIR_SERVICIOS, otro, 'index.js');
            if (!esCliente(f)) violaciones.push(`${f.relativo} importa ${r.especificador} (solo un cliente puede llegar a otro servicio)`);
            else if (!esIndex) violaciones.push(`${f.relativo} importa ${r.especificador} (solo se puede usar el index.js del otro servicio)`);
            else dependenciasReales[nombre].add(otro);
        }
    }
}
check('un servicio solo llega a otro por su index.js y desde infrastructure/client/', violaciones.length === 0, lista(violaciones));

const clientesMalNombrados = todos.filter(f => esCliente(f) && !f.requires.some(r => {
    const otro = a.servicioDe(r.destino);
    return otro && f.relativo.endsWith(`/${otro}.cliente.js`);
}));
check('cada cliente se llama como el servicio al que llama', clientesMalNombrados.length === 0,
    lista(clientesMalNombrados.map(f => f.relativo)));

for (const nombre of NOMBRES) {
    const declaradas = [...manifiestos[nombre].dependeDe].sort();
    const reales = [...dependenciasReales[nombre]].sort();
    check(`${nombre}: dependeDe del manifiesto coincide con sus clientes`,
        JSON.stringify(declaradas) === JSON.stringify(reales), `(declara ${declaradas}, usa ${reales})`);
}

// Sin ciclos de carga: cada cliente resuelve el otro servicio al llamar, no al importar.
const clientesAnsiosos = todos.filter(f => esCliente(f) && /^const\s+\w+\s*=\s*require\(/m.test(
    require_('fs').readFileSync(f.archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
check('los clientes resuelven el otro servicio de forma diferida (sin ciclos de carga)',
    clientesAnsiosos.length === 0, lista(clientesAnsiosos.map(f => f.relativo)));

const compartido = a.listarJs(path.join(a.DIR_SRC, 'compartido'));
const compartidoDepende = compartido.filter(f => a.requiresDe(f).some(r => a.servicioDe(r.destino)));
check('compartido/ no depende de ningun servicio', compartidoDepende.length === 0,
    lista(compartidoDepende.map(f => path.relative(a.DIR_SRC, f))));

// =====================================================================
console.log('\n--- DATOS: CADA TABLA TIENE UN SOLO DUENO (criterio tecnico 8) ---');
// =====================================================================

const dueno = new Map();
const repetidas = [];
for (const nombre of NOMBRES) {
    for (const t of manifiestos[nombre].tablas) {
        if (dueno.has(t)) repetidas.push(`${t}: ${dueno.get(t)} y ${nombre}`);
        dueno.set(t, nombre);
    }
}
// Tablas de la plataforma (el bus de eventos y el registro de migraciones).
for (const t of ['event_outbox', 'schema_migrations']) dueno.set(t, 'compartido');

check('ninguna tabla esta declarada en dos servicios', repetidas.length === 0, lista(repetidas));

const huerfanas = new Set();
for (const f of todos) for (const t of [...f.lecturas, ...f.escrituras]) if (!dueno.has(t)) huerfanas.add(`${t} (${f.relativo})`);
check('toda tabla usada en el SQL tiene un servicio dueno', huerfanas.size === 0, lista([...huerfanas]));

const declaradasDe = (lista, nombre) => new Set(
    manifiestos[nombre][lista].flatMap(d => [].concat(d.tablas || d.tabla))
);

const escriturasAjenas = [];
const lecturasAjenas = [];
const lecturasUsadas = Object.fromEntries(NOMBRES.map(n => [n, new Set()]));
for (const nombre of NOMBRES) {
    const escriturasOk = declaradasDe('escriturasCompartidas', nombre);
    const lecturasOk = declaradasDe('lecturasCompartidas', nombre);
    for (const f of analisis[nombre]) {
        for (const t of f.escrituras) {
            if (dueno.get(t) !== nombre && dueno.get(t) !== 'compartido' && !escriturasOk.has(t)) {
                escriturasAjenas.push(`${f.relativo} escribe en ${t} (de ${dueno.get(t)})`);
            }
        }
        for (const t of f.lecturas) {
            if (dueno.get(t) === nombre || dueno.get(t) === 'compartido') continue;
            if (!lecturasOk.has(t) && !escriturasOk.has(t)) lecturasAjenas.push(`${f.relativo} lee ${t} (de ${dueno.get(t)})`);
            else lecturasUsadas[nombre].add(t);
        }
    }
}
check('ningun servicio escribe en tablas de otro sin declararlo', escriturasAjenas.length === 0, lista(escriturasAjenas));
check('toda lectura de una tabla ajena esta declarada en el manifiesto con su motivo', lecturasAjenas.length === 0, lista(lecturasAjenas));

const sinMotivo = NOMBRES.flatMap(n => [...manifiestos[n].lecturasCompartidas, ...manifiestos[n].escriturasCompartidas]
    .filter(d => !d.motivo || d.motivo.length < 20).map(d => `${n}: ${d.tabla || d.tablas}`));
check('cada excepcion declarada explica su motivo', sinMotivo.length === 0, lista(sinMotivo));

const declaracionesViejas = NOMBRES.flatMap(n =>
    [...declaradasDe('lecturasCompartidas', n)].filter(t => !lecturasUsadas[n].has(t)).map(t => `${n}: ${t}`));
check('no quedan lecturas declaradas que el codigo ya no hace', declaracionesViejas.length === 0, lista(declaracionesViejas));

const escriturasDeclaradas = NOMBRES.flatMap(n => manifiestos[n].escriturasCompartidas.map(d => `${n}->${d.tabla}`));
check('la unica escritura compartida es la cache de puntos y nivel en users',
    JSON.stringify(escriturasDeclaradas) === JSON.stringify(['gamificacion->users']), `(${escriturasDeclaradas})`);

// =====================================================================
console.log('\n--- EVENTOS: EL MANIFIESTO DICE LA VERDAD ---');
// =====================================================================

const nombreDeEvento = (constante) => EVENTOS[constante];
const publicadoPor = new Map();
for (const nombre of NOMBRES) {
    const publicados = new Set(analisis[nombre].flatMap(f => f.publica).map(nombreDeEvento));
    for (const e of publicados) publicadoPor.set(e, [...(publicadoPor.get(e) || []), nombre]);
    const declarados = [...manifiestos[nombre].publica].sort();
    check(`${nombre}: publica lo que declara`,
        JSON.stringify(declarados) === JSON.stringify([...publicados].sort()),
        `(declara ${declarados}, publica ${[...publicados].sort()})`);
}

const doblePublicacion = [...publicadoPor].filter(([, s]) => s.length > 1);
check('cada evento lo publica un solo servicio (su dueno)', doblePublicacion.length === 0,
    lista(doblePublicacion.map(([e, s]) => `${e}: ${s}`)));

// Suscripciones reales: se intercepta subscribe() mientras cada servicio registra sus handlers.
const eventBus = require_('./compartido/eventos/eventBus');
const original = eventBus.subscribe;
let actual = null;
const consumidos = Object.fromEntries(NOMBRES.map(n => [n, new Set()]));
eventBus.subscribe = (evento) => { consumidos[actual].add(evento); };
console.log = () => {};
for (const s of SERVICIOS) { actual = s.manifiesto.nombre; s.registrarHandlers(); }
console.log = log;
eventBus.subscribe = original;

for (const nombre of NOMBRES) {
    const declarados = [...manifiestos[nombre].consume].sort();
    const reales = [...consumidos[nombre]].sort();
    check(`${nombre}: consume lo que declara`, JSON.stringify(declarados) === JSON.stringify(reales),
        `(declara ${declarados}, consume ${reales})`);
}

const sinPublicador = NOMBRES.flatMap(n => [...consumidos[n]].filter(e => !publicadoPor.has(e)).map(e => `${n} consume ${e}`));
check('todo evento consumido lo publica algun servicio', sinPublicador.length === 0, lista(sinPublicador));

const todosLosNombres = new Set(Object.values(EVENTOS));
const fueraDeCatalogo = [...publicadoPor.keys(), ...NOMBRES.flatMap(n => [...consumidos[n]])].filter(e => !todosLosNombres.has(e));
check('todos los eventos estan en el catalogo', fueraDeCatalogo.length === 0, lista(fueraDeCatalogo));

// =====================================================================
console.log('\n--- DOCUMENTACION TECNICA AL DIA (criterio de aceptacion 9) ---');
// =====================================================================

console.log = () => {};
const { generar, DESTINO } = require_('../scripts/generar-catalogo-de-servicios.js');
const esperado = generar();
console.log = log;
const catalogoActual = existsSync(DESTINO) ? readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n') : '';
check('docs/arquitectura/SERVICIOS.md coincide con el codigo (si falla: npm run docs:arquitectura)', catalogoActual === esperado);
check('el catalogo describe los siete servicios con endpoints y estructura',
    NOMBRES.every(n => esperado.includes(`## ${n}`)) && (esperado.match(/### Endpoints/g) || []).length === NOMBRES.length);

console.log(`\n${ok} OK, ${fallos} fallas`);
process.exit(fallos === 0 ? 0 : 1);
