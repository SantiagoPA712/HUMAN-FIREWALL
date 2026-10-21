/**
 * Pruebas de la HU de preferencia de idioma de la plataforma.
 *
 * Lo que se verifica:
 *
 *   - el catalogo de idiomas: que salga del dominio y no de una lista escrita
 *     en la interfaz, y que incluya el idioma por defecto (aceptacion 1,
 *     tecnico 1 y 7),
 *   - que guardar el idioma lo deje en la cuenta y sobreviva a cerrar sesion
 *     (aceptacion 4, tecnico 5),
 *   - que sin preferencia configurada rija el idioma por defecto (aceptacion 5),
 *   - que un idioma no habilitado se rechace sin cambiar el que habia
 *     (aceptacion 6, tecnico 7 y 9),
 *   - que nadie pueda cambiar la preferencia de otro (aceptacion 8, tecnico 10),
 *   - los diccionarios de la interfaz: mismas claves en los dos idiomas,
 *     ningun texto en blanco, y la caida ordenada cuando falta una traduccion
 *     (tecnico 2, 6 y 8).
 *
 * Los diccionarios son del frontend pero se prueban aca a proposito: son
 * archivos de datos sin React adentro, y una clave que se desincroniza es
 * justo el fallo que no se ve mirando la pantalla en un solo idioma.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.JWT_EXPIRES = '1h';

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
const dbPath = require_.resolve('./compartido/config/db');
require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
    try { await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8')); }
    catch (e) { console.log(`ERROR en ${archivo}: ${msg(e)}`); fallos++; }
}
console.log('Esquema y migraciones listos\n');

const controller = require_('./servicios/identidad/controller/user.controller');
const dominio = require_('./servicios/identidad/domain/usuario');

/** Llama a un controlador sin levantar Express. */
const llamar = async (handler, req) => {
    let estado = 200, cuerpo = null;
    const res = {
        status(c) { estado = c; return this; },
        json(b) { cuerpo = b; return this; }
    };
    await handler({ params: {}, body: {}, query: {}, ...req }, res);
    return { estado, cuerpo };
};

await pg.exec(`
  INSERT INTO users (email, password, role) VALUES
    ('ana@hf.com',  'x', 'employee'),
    ('beto@hf.com', 'x', 'employee');
`);
const idDe = async (email) => (await pg.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
const ana = await idDe('ana@hf.com');
const beto = await idDe('beto@hf.com');

const idiomaDe = async (id) =>
    (await pg.query('SELECT language FROM users WHERE id = $1', [id])).rows[0].language;

// ---------------------------------------------------------------------
console.log('--- CATALOGO DE IDIOMAS (criterio de aceptacion 1, tecnicos 1 y 7) ---');

const catalogo = await llamar(controller.getIdiomas, { user: { id: ana, role: 'employee' } });

check('el empleado puede ver los idiomas disponibles', catalogo.estado === 200);
check('el catalogo trae al menos espanol e ingles',
    ['es', 'en'].every(c => catalogo.cuerpo.idiomas.some(i => i.codigo === c)),
    JSON.stringify(catalogo.cuerpo));
check('cada idioma viene con su nombre para mostrar',
    catalogo.cuerpo.idiomas.every(i => typeof i.nombre === 'string' && i.nombre.length > 0));
check('el nombre esta escrito en su propio idioma, no en el del sistema',
    catalogo.cuerpo.idiomas.find(i => i.codigo === 'en')?.nombre === 'English');
check('el catalogo dice cual es el idioma por defecto',
    catalogo.cuerpo.por_defecto === dominio.IDIOMA_POR_DEFECTO);

// La lista que se muestra y la que valida el PATCH tienen que ser la misma:
// si fueran dos, agregar un idioma obligaria a acordarse de tocar las dos.
check('el catalogo sale de la misma fuente que valida el guardado',
    catalogo.cuerpo.idiomas.map(i => i.codigo).join(',') === dominio.IDIOMAS.join(','));

const { rows: checkDeLaBase } = await pg.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_language_valido'`
);
check('y los mismos codigos que acepta la restriccion de la base',
    dominio.IDIOMAS.every(c => (checkDeLaBase[0]?.def || '').includes(`'${c}'`)),
    checkDeLaBase[0]?.def);

// ---------------------------------------------------------------------
console.log('\n--- IDIOMA POR DEFECTO (criterio de aceptacion 5) ---');

const perfilInicial = await llamar(controller.getMe, { user: { id: ana, role: 'employee' } });
check('una cuenta nueva no trae idioma configurado', perfilInicial.cuerpo.language === null);
check('y en la base tampoco queda sembrado un valor', (await idiomaDe(ana)) === null);
check('el idioma por defecto esta definido y es uno de los habilitados',
    dominio.IDIOMAS.includes(dominio.IDIOMA_POR_DEFECTO), dominio.IDIOMA_POR_DEFECTO);

// ---------------------------------------------------------------------
console.log('\n--- GUARDAR LA PREFERENCIA (criterio de aceptacion 4, tecnico 5) ---');

const guardado = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    body: { language: 'en' }
});
check('guardar un idioma habilitado responde 200', guardado.estado === 200);
check('y devuelve el perfil con el idioma nuevo', guardado.cuerpo.language === 'en');
check('la preferencia queda en la cuenta, no en el navegador',
    (await idiomaDe(ana)) === 'en');

// Cerrar sesion no es una operacion del backend: el token se tira del lado
// del cliente. Lo que importa es que al volver a pedir el perfil siga ahi.
const perfilNuevaSesion = await llamar(controller.getMe, { user: { id: ana, role: 'employee' } });
check('al volver a entrar, el perfil sigue trayendo el idioma elegido',
    perfilNuevaSesion.cuerpo.language === 'en');

const vuelta = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    body: { language: 'es' }
});
check('se puede volver a cambiar', vuelta.cuerpo.language === 'es');

const aPorDefecto = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    body: { language: null }
});
check('y se puede volver al idioma por defecto mandando null',
    aPorDefecto.estado === 200 && aPorDefecto.cuerpo.language === null);

// ---------------------------------------------------------------------
console.log('\n--- IDIOMA NO DISPONIBLE (criterio de aceptacion 6, tecnicos 7 y 9) ---');

await llamar(controller.updateMe, { user: { id: ana, role: 'employee' }, body: { language: 'en' } });

const invalido = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    body: { language: 'fr' }
});
check('un idioma que no esta habilitado se rechaza con 400', invalido.estado === 400);
check('el mensaje dice cuales son los validos',
    dominio.IDIOMAS.every(c => JSON.stringify(invalido.cuerpo).includes(c)),
    JSON.stringify(invalido.cuerpo));
check('y senala el campo, no un error generico',
    invalido.cuerpo.errores?.[0]?.campo === 'language');

// Criterio de aceptacion 6: "mantiene el idioma actual". El rechazo no puede
// dejar la cuenta sin idioma ni a medio camino.
check('el rechazo NO cambia el idioma que ya tenia', (await idiomaDe(ana)) === 'en');

for (const basura of [123, true, 'ES_MX', '', 'esp']) {
    const r = await llamar(controller.updateMe, {
        user: { id: ana, role: 'employee' },
        body: { language: basura }
    });
    check(`rechaza ${JSON.stringify(basura)} sin tocar la cuenta`,
        r.estado === 400 && (await idiomaDe(ana)) === 'en');
}

// Un PATCH vacio no es un error: no hay nada que cambiar. Lo que importa para
// esta HU es que NO se invente un idioma ni borre el que habia. (La HU de
// perfil editable es la que fijo esta respuesta: 200 con sin_cambios.)
const sinCampo = await llamar(controller.updateMe, { user: { id: ana, role: 'employee' }, body: {} });
check('sin el campo language no se adivina ni se borra nada',
    sinCampo.estado === 200 && sinCampo.cuerpo.sin_cambios === true && (await idiomaDe(ana)) === 'en');

// ---------------------------------------------------------------------
console.log('\n--- CADA UNO LA SUYA (criterio de aceptacion 8, tecnico 10) ---');

await llamar(controller.updateMe, { user: { id: beto, role: 'employee' }, body: { language: 'es' } });
check('beto configura el suyo', (await idiomaDe(beto)) === 'es');

await llamar(controller.updateMe, { user: { id: ana, role: 'employee' }, body: { language: 'en' } });
check('ana cambia el suyo', (await idiomaDe(ana)) === 'en');
check('y el de beto queda intacto', (await idiomaDe(beto)) === 'es');

// El id sale del token: mandar otro en el cuerpo o en la URL no sirve de nada.
// Desde la HU de perfil editable el pedido ni siquiera se procesa: `userId` e
// `id` no estan en la lista blanca, asi que se rechaza ENTERO con 403 aunque
// venga con un `language` valido al lado. Antes se ignoraban en silencio; esto
// es mas estricto y cubre igual el criterio de aceptacion 8.
const intentoAjeno = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    params: { id: String(beto) },
    body: { language: 'en', userId: beto, id: beto }
});
check('mandar el id de otro se rechaza con 403 y no toca ninguna cuenta',
    intentoAjeno.estado === 403
    && (await idiomaDe(beto)) === 'es'
    && (await idiomaDe(ana)) === 'en');

// Y el pedido limpio sigue aplicandose a quien lo hizo, por la URL de otro.
const propio = await llamar(controller.updateMe, {
    user: { id: ana, role: 'employee' },
    params: { id: String(beto) },
    body: { language: 'en' }
});
check('el cambio se le aplico a quien hizo el pedido',
    propio.estado === 200 && (await idiomaDe(ana)) === 'en' && (await idiomaDe(beto)) === 'es');

const perfilAjeno = await llamar(controller.getMe, {
    user: { id: ana, role: 'employee' },
    params: { id: String(beto) }
});
check('tampoco se puede leer el perfil de otro por la URL',
    perfilAjeno.cuerpo.id === ana);

// ---------------------------------------------------------------------
console.log('\n--- DICCIONARIOS DE LA INTERFAZ (criterios tecnicos 2, 6 y 8) ---');

const RUTA_I18N = `${DIR}human-firewall-frontend/src/i18n`;
const es = (await import(`${RUTA_I18N}/es.js`)).default;
const en = (await import(`${RUTA_I18N}/en.js`)).default;
const { traducir, clavesDe, DICCIONARIOS, IDIOMA_POR_DEFECTO } = await import(`${RUTA_I18N}/index.js`);

const clavesEs = clavesDe(es);
const clavesEn = clavesDe(en);

check('los textos viven en diccionarios aparte, no en los componentes',
    clavesEs.length > 100, `(${clavesEs.length} claves)`);

const faltanEnIngles = clavesEs.filter(c => !clavesEn.includes(c));
const sobranEnIngles = clavesEn.filter(c => !clavesEs.includes(c));
check('los dos idiomas tienen exactamente las mismas claves',
    faltanEnIngles.length === 0 && sobranEnIngles.length === 0,
    `faltan: ${faltanEnIngles.slice(0, 5).join(', ')} | sobran: ${sobranEnIngles.slice(0, 5).join(', ')}`);

const vacias = clavesEs.filter(c => !String(traducir('es', c)).trim())
    .concat(clavesEn.filter(c => !String(traducir('en', c)).trim()));
check('ningun texto quedo en blanco', vacias.length === 0, vacias.slice(0, 5).join(', '));

const sinTraducir = clavesEs.filter(c => traducir('en', c) === traducir('es', c)
    && !/^(comun\.(puntos|nivel|de)|nav\.tema|.*\.(pts|idioma_en))$/.test(c));
check('el ingles no es una copia del espanol',
    sinTraducir.length < clavesEs.length * 0.1,
    `(${sinTraducir.length} iguales: ${sinTraducir.slice(0, 6).join(', ')})`);

check('hay diccionario para cada idioma que ofrece la plataforma',
    dominio.IDIOMAS.every(c => Object.hasOwn(DICCIONARIOS, c)),
    Object.keys(DICCIONARIOS).join(','));
check('y el idioma por defecto de la interfaz es el mismo que el del backend',
    IDIOMA_POR_DEFECTO === dominio.IDIOMA_POR_DEFECTO);

// Criterio tecnico 8: navegacion, botones y mensajes tienen que estar en el
// sistema de traducciones. Si alguien borra una de estas secciones, se nota.
for (const seccion of ['nav', 'comun', 'preferencias', 'panel', 'acceso']) {
    check(`la seccion "${seccion}" existe en los dos idiomas`,
        Object.hasOwn(es, seccion) && Object.hasOwn(en, seccion));
}

// ---------------------------------------------------------------------
console.log('\n--- RESOLUCION DE TEXTOS (criterio tecnico 2) ---');

check('traduce al idioma pedido', traducir('en', 'nav.preferencias') === en.nav.preferencias);
check('y el mismo texto cambia segun el idioma',
    traducir('es', 'nav.preferencias') !== traducir('en', 'nav.preferencias'));

check('una clave sin traducir cae al espanol en vez de mostrar la clave cruda',
    traducir('xx', 'nav.preferencias') === es.nav.preferencias);
check('una clave que no existe se devuelve tal cual, para que se note',
    traducir('es', 'seccion.inexistente') === 'seccion.inexistente');
check('una clave a medio camino tampoco devuelve un objeto',
    typeof traducir('es', 'nav') === 'string');

check('reemplaza las variables del texto',
    traducir('es', 'nivel.alcanzado_con', { fecha: '1/1/2026', puntos: 120 })
        .includes('1/1/2026'));
check('y una variable sin valor deja el hueco visible, no "undefined"',
    traducir('es', 'nivel.alcanzado_con', { fecha: '1/1/2026' }).includes('{puntos}'));

// ---------------------------------------------------------------------
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
