/**
 * Pruebas de la HU de configuracion de preferencias de correo.
 *
 * El criterio tecnico 1 pide revisar lo que ya existe antes de tocar nada, y
 * lo que existe es casi todo: la HU de notificaciones por correo dejo el
 * catalogo de tipos, la tabla de preferencias y la comprobacion antes de
 * enviar. Esta suite verifica esa maquinaria CONTRA LOS CRITERIOS DE ESTA
 * HISTORIA, que es lo que no estaba escrito en ningun lado:
 *
 *   - el catalogo que ve el empleado y que solo trae lo configurable (CA 1, CT 2),
 *   - activar y desactivar una categoria opcional (CA 2),
 *   - que lo guardado quede en la cuenta y se lea igual al volver (CA 3, 4, 7),
 *   - que desactivar se respete en el envio siguiente (CA 5, CT 5 y 10),
 *   - que un fallo no confirme nada a medias (CA 6, CT 7),
 *   - que nadie toque las preferencias de otro (CA 8, CT 6),
 *   - y que lo obligatorio salga igual, con el canal y el tipo apagados (CA 9, CT 9).
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
process.env.JWT_EXPIRES = '1h';
delete process.env.SMTP_HOST;

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

const correo = require_('./servicios/notificaciones/application/emailNotifications.service');
const controller = require_('./servicios/notificaciones/controller/emailNotifications.controller');

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

const comoAna = { user: { id: ana, role: 'employee' } };
const comoBeto = { user: { id: beto, role: 'employee' } };

// ---------------------------------------------------------------------
console.log('--- LO QUE EL EMPLEADO PUEDE CONFIGURAR (criterio de aceptacion 1, tecnico 2) ---');

const inicial = await llamar(controller.getPreferencias, comoAna);
check('el empleado puede ver sus categorias de correo', inicial.estado === 200);
check('cada categoria viene con una descripcion legible, no solo el codigo',
    inicial.cuerpo.tipos.every(t => typeof t.descripcion === 'string' && t.descripcion.length > 5));
check('y dice cuales son obligatorias', inicial.cuerpo.tipos.some(t => t.critico === true));
check('hay al menos una opcional para configurar', inicial.cuerpo.tipos.some(t => t.critico === false));

// Criterio tecnico 2: "evitando incluir opciones que el sistema no soporte".
const { rows: noConfigurables } = await pg.query(
    'SELECT code FROM email_notification_types WHERE NOT user_configurable'
);
check('existe al menos un tipo que NO es configurable por el usuario', noConfigurables.length > 0,
    '(la invitacion le llega a quien todavia no tiene cuenta)');
check('y ese tipo no aparece en la lista del empleado',
    noConfigurables.every(t => !inicial.cuerpo.tipos.some(x => x.tipo === t.code)),
    inicial.cuerpo.tipos.map(t => t.tipo).join(','));

const { rows: catalogoEntero } = await pg.query('SELECT code FROM email_notification_types');
check('la lista sale del catalogo de la base, no de una constante del codigo',
    inicial.cuerpo.tipos.every(t => catalogoEntero.some(c => c.code === t.tipo)));
check('sin configuracion previa, todo lo opcional llega habilitado',
    inicial.cuerpo.tipos.filter(t => !t.critico).every(t => t.habilitado === true));

const { rows: filasIniciales } = await pg.query(
    'SELECT COUNT(*)::int AS n FROM email_preferences WHERE user_id = $1', [ana]
);
check('y no se siembra ninguna fila para decir "todo por defecto"', filasIniciales[0].n === 0);

// ---------------------------------------------------------------------
console.log('\n--- ACTIVAR Y DESACTIVAR (criterios de aceptacion 2, 3 y 4) ---');

const opcional = inicial.cuerpo.tipos.find(t => !t.critico).tipo;

const apagado = await llamar(controller.patchPreferencias, {
    ...comoAna, body: { tipos: { [opcional]: false } }
});
check(`desactivar "${opcional}" responde 200`, apagado.estado === 200);
check('y la respuesta ya lo devuelve apagado',
    apagado.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === false);

const { rows: guardado } = await pg.query(
    'SELECT enabled FROM email_preferences WHERE user_id = $1 AND notification_type = $2',
    [ana, opcional]
);
check('la configuracion queda asociada a la cuenta en la base', guardado[0]?.enabled === false);

// Criterio de aceptacion 4 y 7: volver a entrar es volver a pedir el perfil.
const alVolver = await llamar(controller.getPreferencias, comoAna);
check('al volver a entrar se ve lo que se guardo',
    alVolver.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === false);
check('y el resto de las categorias quedo como estaba',
    alVolver.cuerpo.tipos.filter(t => t.tipo !== opcional && !t.critico).every(t => t.habilitado === true));

const prendido = await llamar(controller.patchPreferencias, {
    ...comoAna, body: { tipos: { [opcional]: true } }
});
check('se puede volver a activar', prendido.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === true);

const varios = inicial.cuerpo.tipos.filter(t => !t.critico).slice(0, 2).map(t => t.tipo);
if (varios.length === 2) {
    const dos = await llamar(controller.patchPreferencias, {
        ...comoAna, body: { tipos: { [varios[0]]: false, [varios[1]]: false } }
    });
    check('se pueden cambiar varias categorias de una vez',
        varios.every(v => dos.cuerpo.tipos.find(t => t.tipo === v).habilitado === false));
    await llamar(controller.patchPreferencias, {
        ...comoAna, body: { tipos: Object.fromEntries(varios.map(v => [v, true])) }
    });
}

// ---------------------------------------------------------------------
console.log('\n--- LA PREFERENCIA SE RESPETA AL ENVIAR (criterio de aceptacion 5, tecnicos 5 y 10) ---');

// Se usa course_assigned porque es la categoria opcional que el proyecto ya
// tiene cableada de punta a punta. Los datos son los que pide su plantilla.
const tipoEnviable = 'course_assigned';
const DATOS = { curso: 'Wi-Fi Seguro', ruta: '/dashboard', enlace: 'https://hf.test/dashboard' };

check(`"${tipoEnviable}" es opcional y configurable, como pide el escenario`,
    inicial.cuerpo.tipos.some(t => t.tipo === tipoEnviable && !t.critico));

const antes = await correo.encolar({
    userId: ana, tipo: tipoEnviable, datos: DATOS, dedupeKey: `pref:1:${tipoEnviable}`
});
check(`con la categoria encendida, "${tipoEnviable}" se encola`, antes.estado === 'encolado', JSON.stringify(antes));

await llamar(controller.patchPreferencias, { ...comoAna, body: { tipos: { [tipoEnviable]: false } } });

const despues = await correo.encolar({
    userId: ana, tipo: tipoEnviable, datos: DATOS, dedupeKey: `pref:2:${tipoEnviable}`
});
check('con la categoria apagada, el envio siguiente se omite', despues.estado === 'omitido', JSON.stringify(despues));

const { rows: encolados } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM email_jobs WHERE user_id = $1 AND notification_type = $2`,
    [ana, tipoEnviable]
);
check('y no queda ningun job de mas en la cola', encolados[0].n === 1, `(${encolados[0].n})`);

// Omitir no es fallar: no debe quedar registrado como error de envio.
const { rows: fallidos } = await pg.query(
    `SELECT COUNT(*)::int AS n FROM email_jobs WHERE user_id = $1 AND status IN ('failed','undeliverable')`,
    [ana]
);
check('omitir por preferencia no deja un fallo en la cola', fallidos[0].n === 0);

// La preferencia de OTRO usuario no cambia lo que recibe Ana.
const deBeto = await correo.encolar({
    userId: beto, tipo: tipoEnviable, datos: DATOS, dedupeKey: `pref:3:${tipoEnviable}`
});
check('la preferencia de uno no afecta el envio a otro', deBeto.estado === 'encolado');

await llamar(controller.patchPreferencias, { ...comoAna, body: { tipos: { [tipoEnviable]: true } } });
const reactivado = await correo.encolar({
    userId: ana, tipo: tipoEnviable, datos: DATOS, dedupeKey: `pref:4:${tipoEnviable}`
});
check('al volver a activarla, los envios se reanudan', reactivado.estado === 'encolado');

// ---------------------------------------------------------------------
console.log('\n--- LO OBLIGATORIO SE MANDA IGUAL (criterio de aceptacion 9, tecnico 9) ---');

const critico = inicial.cuerpo.tipos.find(t => t.critico).tipo;
// Datos que pide la plantilla del aviso de cambio de contrasena.
const DATOS_CRITICO = { fecha: '2026-10-20 10:00', ip: '186.0.0.1', ruta: '/login' };

const rechazo = await llamar(controller.patchPreferencias, {
    ...comoAna, body: { tipos: { [critico]: false } }
});
check('desactivar una categoria obligatoria se rechaza con 400', rechazo.estado === 400);
check('y el mensaje explica por que, no es un error generico',
    /critica|seguridad/i.test(JSON.stringify(rechazo.cuerpo)), JSON.stringify(rechazo.cuerpo));

const trasRechazo = await llamar(controller.getPreferencias, comoAna);
check('la obligatoria sigue habilitada despues del rechazo',
    trasRechazo.cuerpo.tipos.find(t => t.tipo === critico).habilitado === true);

// Aunque alguien escriba la fila a mano saltandose la API, el envio la ignora.
await pg.query(
    `INSERT INTO email_preferences (user_id, notification_type, enabled) VALUES ($1, $2, false)
     ON CONFLICT (user_id, notification_type) DO UPDATE SET enabled = false`,
    [ana, critico]
);
await pg.query(
    `INSERT INTO notification_preferences (user_id, channel, enabled) VALUES ($1, 'email', false)
     ON CONFLICT (user_id, channel) DO UPDATE SET enabled = false`,
    [ana]
);

const criticoIgual = await correo.encolar({
    userId: ana, tipo: critico, datos: DATOS_CRITICO, dedupeKey: `pref:critico:${critico}`
});
check('el correo obligatorio se encola con el canal Y la categoria apagados',
    criticoIgual.estado === 'encolado', JSON.stringify(criticoIgual));

const vistaConCriticoApagado = await llamar(controller.getPreferencias, comoAna);
check('y la pantalla lo sigue mostrando como habilitado, para no mentir',
    vistaConCriticoApagado.cuerpo.tipos.find(t => t.tipo === critico).habilitado === true);

// El canal apagado si corta lo opcional.
const opcionalSinCanal = await correo.encolar({
    userId: ana, tipo: tipoEnviable, datos: DATOS, dedupeKey: `pref:5:${tipoEnviable}`
});
check('en cambio lo opcional si se corta con el canal apagado', opcionalSinCanal.estado === 'omitido');

await pg.query(`UPDATE notification_preferences SET enabled = true WHERE user_id = $1 AND channel = 'email'`, [ana]);
await pg.query(`DELETE FROM email_preferences WHERE user_id = $1 AND notification_type = $2`, [ana, critico]);

// ---------------------------------------------------------------------
console.log('\n--- UN FALLO NO CONFIRMA NADA (criterio de aceptacion 6, tecnico 7) ---');

const estadoPrevio = await llamar(controller.getPreferencias, comoAna);
const fotoPrevia = JSON.stringify(estadoPrevio.cuerpo.tipos);

for (const malo of [
    { tipos: { categoria_que_no_existe: false } },
    { tipos: { [opcional]: 'no' } },
    { tipos: [] },
    {},
    { tipos: null }
]) {
    const r = await llamar(controller.patchPreferencias, { ...comoAna, body: malo });
    const ahora = await llamar(controller.getPreferencias, comoAna);
    check(`${JSON.stringify(malo).slice(0, 42)} -> 400 y nada cambia`,
        r.estado === 400 && JSON.stringify(ahora.cuerpo.tipos) === fotoPrevia,
        `(estado ${r.estado})`);
}

const errorDetallado = await llamar(controller.patchPreferencias, {
    ...comoAna, body: { tipos: { categoria_que_no_existe: false } }
});
check('el error dice cual campo esta mal, para poder mostrarlo en pantalla',
    errorDetallado.cuerpo.errores?.[0]?.campo?.includes('categoria_que_no_existe'),
    JSON.stringify(errorDetallado.cuerpo));

// Un pedido con una categoria valida y otra invalida no se aplica a medias.
const mezclado = await llamar(controller.patchPreferencias, {
    ...comoAna, body: { tipos: { [opcional]: false, categoria_que_no_existe: true } }
});
const trasMezcla = await llamar(controller.getPreferencias, comoAna);
check('un pedido medio invalido no se aplica a medias',
    mezclado.estado === 400
    && trasMezcla.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === true);

// ---------------------------------------------------------------------
console.log('\n--- CADA UNO LAS SUYAS (criterio de aceptacion 8, tecnico 6) ---');

await llamar(controller.patchPreferencias, { ...comoBeto, body: { tipos: { [opcional]: false } } });
const betoVe = await llamar(controller.getPreferencias, comoBeto);
const anaVe = await llamar(controller.getPreferencias, comoAna);

check('beto apaga la suya', betoVe.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === false);
check('y la de ana no se movio', anaVe.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === true);
check('cada respuesta trae el id de quien pregunta',
    betoVe.cuerpo.user_id === beto && anaVe.cuerpo.user_id === ana);

// El id sale del token: mandar otro en el cuerpo o la URL no sirve de nada.
await llamar(controller.patchPreferencias, {
    ...comoAna,
    params: { id: String(beto) },
    body: { tipos: { [opcional]: false }, userId: beto, user_id: beto }
});
const betoTrasIntento = await llamar(controller.getPreferencias, comoBeto);
const { rows: filaDeAna } = await pg.query(
    'SELECT enabled FROM email_preferences WHERE user_id = $1 AND notification_type = $2',
    [ana, opcional]
);
check('mandar el id de otro no le cambia la configuracion a esa persona',
    betoTrasIntento.cuerpo.tipos.find(t => t.tipo === opcional).habilitado === false);
check('el cambio se le aplico a quien hizo el pedido', filaDeAna[0]?.enabled === false);

const { rows: porUsuario } = await pg.query(
    'SELECT user_id, COUNT(*)::int AS n FROM email_preferences GROUP BY user_id ORDER BY user_id'
);
check('las preferencias quedan separadas por usuario en la base',
    porUsuario.length === 2 && porUsuario.every(f => f.n > 0),
    JSON.stringify(porUsuario));

// ---------------------------------------------------------------------
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos > 0 ? 1 : 0);
