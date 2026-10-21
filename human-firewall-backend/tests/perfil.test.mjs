/**
 * Pruebas de la HU de perfil editable, por HTTP real contra app.js.
 *
 * Lo que se verifica:
 *
 *   - consultar el perfil propio con los datos de la cuenta (aceptacion 1),
 *     reutilizando GET /api/users/me (tecnico 1),
 *   - guardar los campos editables con confirmacion, normalizados, y verlos
 *     al volver a consultar (aceptacion 3 y 7, tecnico 7),
 *   - un error por campo ante un formato incorrecto o un obligatorio vacio,
 *     sin escribir nada (aceptacion 4, tecnico 5),
 *   - guardar sin cambios no escribe ni deja log (aceptacion 5),
 *   - rol, estado, correo, permisos y cualquier campo fuera de la lista
 *     blanca: 403 y nada guardado, aunque vengan con campos validos
 *     (aceptacion 8, tecnico 6),
 *   - el id sale del token: nadie modifica el perfil de otro (tecnico 9),
 *   - una falla a mitad del guardado no deja datos a medias ni responde
 *     "actualizado" (aceptacion 9, tecnico 10),
 *   - data.logs con el valor anterior y el nuevo, solo de lo que cambio,
 *   - el CHECK de la base como ultima barrera para el telefono,
 *   - y que el idioma (la pantalla de notificaciones) siga funcionando igual.
 */

import { levantarApi } from './ayudantes/api-de-prueba.mjs';

let ok = 0, fallos = 0;
const check = (n, c, e = '') => { if (c) { console.log(`  OK    ${n}`); ok++; } else { console.log(`  FALLA ${n} ${e}`); fallos++; } };
const msg = e => e?.message || String(e);

const api = await levantarApi();
const { pg, require_, ids, tokens, pedir, estado } = api;
const eventBus = require_('./compartido/eventos/eventBus');
const dominio = require_('./servicios/identidad/domain/usuario');

const yo = tokens.employee;
const miId = ids.employee;

const fila = async (id = miId) => (await pg.query(
    'SELECT id, email, role, is_active, full_name, phone, language, team_id, total_points, updated_at FROM users WHERE id = $1',
    [id]
)).rows[0];

const logsDePerfil = async () => (await pg.query(
    `SELECT old_value, new_value, user_id, resource_id FROM data.logs
      WHERE resource_type = 'user_profile' ORDER BY id`
)).rows;

const drenar = async () => { await new Promise(r => setTimeout(r, 5)); await eventBus.procesarPendientes(); };
const guardar = (body, token = yo) => pedir('PATCH', '/api/users/me', { token, body });

// =====================================================================
console.log('--- CONSULTAR EL PERFIL (aceptacion 1, tecnico 1) ---');
// =====================================================================

await pg.query(`UPDATE users SET team_id = (SELECT id FROM teams ORDER BY id LIMIT 1) WHERE id = $1`, [miId]);

const r0 = await pedir('GET', '/api/users/me', { token: yo });
check('GET /api/users/me responde 200', r0.estado === 200, `(${r0.estado})`);
check('trae el correo y el rol de la cuenta del token',
    r0.cuerpo.id === miId && r0.cuerpo.email === 'employee.contrato@hf.com' && r0.cuerpo.role === 'employee');
check('trae los datos personales, aunque esten vacios',
    'full_name' in r0.cuerpo && 'phone' in r0.cuerpo && 'language' in r0.cuerpo);
check('trae el nombre del equipo y la fecha de alta (solo lectura)',
    typeof r0.cuerpo.team_name === 'string' && !!r0.cuerpo.created_at);
check('no expone la contrasena ni los contadores internos',
    !('password' in r0.cuerpo) && !('failed_attempts' in r0.cuerpo) && !('lock_until' in r0.cuerpo));

const sinToken = await pedir('GET', '/api/users/me');
check('sin token: 401', sinToken.estado === 401);

// =====================================================================
console.log('\n--- GUARDAR CAMBIOS VALIDOS (aceptacion 3 y 7, tecnico 7) ---');
// =====================================================================

const antesDeGuardar = await fila();
const r1 = await guardar({ full_name: '  Ana   María  Pérez ', phone: '+57 (300) 123-4567' });
check('guardar responde 200', r1.estado === 200, `(${r1.estado} ${JSON.stringify(r1.cuerpo)})`);
check('con mensaje de confirmacion', r1.cuerpo.msg === 'Perfil actualizado correctamente');
check('sin_cambios: false y la lista de lo que cambio',
    r1.cuerpo.sin_cambios === false && r1.cuerpo.cambios.sort().join() === 'full_name,phone');
check('la respuesta trae el perfil completo ya guardado',
    r1.cuerpo.full_name === 'Ana María Pérez' && r1.cuerpo.email === 'employee.contrato@hf.com');

const despues = await fila();
check('el nombre se guarda sin espacios de mas', despues.full_name === 'Ana María Pérez', `(${despues.full_name})`);
check('el telefono se guarda normalizado', despues.phone === '+573001234567', `(${despues.phone})`);
check('updated_at avanza', new Date(despues.updated_at) > new Date(antesDeGuardar.updated_at));
check('el rol, el estado y el equipo no se tocan',
    despues.role === 'employee' && despues.is_active === true && despues.team_id === antesDeGuardar.team_id);

const r1b = await pedir('GET', '/api/users/me', { token: yo });
check('al volver a consultar se ve lo guardado (aceptacion 7)',
    r1b.cuerpo.full_name === 'Ana María Pérez' && r1b.cuerpo.phone === '+573001234567');

const r1c = await guardar({ phone: '' });
check('el telefono es opcional: vacio lo borra', r1c.estado === 200 && (await fila()).phone === null);
await guardar({ phone: '3001234567' });

// =====================================================================
console.log('\n--- DATOS INVALIDOS (aceptacion 4, tecnico 5) ---');
// =====================================================================

const guardado = await fila();

const r2 = await guardar({ full_name: '   ' });
check('nombre vacio: 400', r2.estado === 400, `(${r2.estado})`);
check('el error dice que el nombre es obligatorio',
    r2.cuerpo.errores?.[0]?.campo === 'full_name' && /obligatorio/.test(r2.cuerpo.errores[0].detalle));

const r3 = await guardar({ full_name: 'Ana 123' });
check('nombre con numeros: 400 con el formato permitido',
    r3.estado === 400 && /solo puede tener letras/.test(r3.cuerpo.errores?.[0]?.detalle));

const r4 = await guardar({ full_name: 'A' });
check('nombre de una letra: 400 con el largo', r4.estado === 400 && /entre 2 y 150/.test(r4.cuerpo.errores?.[0]?.detalle));

const r5 = await guardar({ phone: '300-ABC-1234' });
check('telefono con letras: 400 con un ejemplo del formato',
    r5.estado === 400 && r5.cuerpo.errores?.[0]?.campo === 'phone' && /\+57/.test(r5.cuerpo.errores[0].detalle));

const r6 = await guardar({ phone: '12345' });
check('telefono demasiado corto: 400', r6.estado === 400);

const r7 = await guardar({ language: 'fr' });
check('idioma inexistente: 400', r7.estado === 400 && r7.cuerpo.errores?.[0]?.campo === 'language');

const r8 = await guardar({ full_name: '', phone: 'x' });
check('dos campos mal: un error por cada uno', r8.estado === 400 && r8.cuerpo.errores?.length === 2);

const r9 = await guardar({ full_name: 'Nombre Valido', phone: 'x' });
check('uno bien y otro mal: 400 y no se guarda ninguno',
    r9.estado === 400 && (await fila()).full_name === guardado.full_name);

const r10 = await guardar({});
check('cuerpo vacio: 400 del DTO', r10.estado === 400);

const r11 = await guardar({ full_name: 42 });
check('nombre que no es texto: 400 del DTO', r11.estado === 400 && r11.cuerpo.errores?.[0]?.campo === 'full_name');

const intacto = await fila();
check('despues de todos los rechazos el perfil sigue igual',
    intacto.full_name === guardado.full_name && intacto.phone === guardado.phone &&
    String(intacto.updated_at) === String(guardado.updated_at));

// =====================================================================
console.log('\n--- GUARDAR SIN CAMBIOS (aceptacion 5) ---');
// =====================================================================

await drenar();
const logsAntes = (await logsDePerfil()).length;
const r12 = await guardar({ full_name: guardado.full_name, phone: '300 123 4567' });
check('mismos valores (el telefono escrito de otra forma): 200', r12.estado === 200);
check('con sin_cambios: true y el mensaje', r12.cuerpo.sin_cambios === true && r12.cuerpo.msg === 'No hay cambios para guardar');
check('no se escribe: updated_at no cambia', String((await fila()).updated_at) === String(guardado.updated_at));
await drenar();
check('y no deja log de un cambio que no hubo', (await logsDePerfil()).length === logsAntes);

// =====================================================================
console.log('\n--- CAMPOS PROTEGIDOS (aceptacion 8, tecnico 6) ---');
// =====================================================================

const intentos = [
    ['rol', { role: 'admin' }],
    ['estado de la cuenta', { is_active: false }],
    ['correo', { email: 'otro@hf.com' }],
    ['permisos', { permissions: ['users:write'] }],
    ['equipo', { team_id: 99 }],
    ['puntos', { total_points: 99999 }],
    ['nivel', { level: 10 }],
    ['contrasena', { password: 'Hackeada123' }],
    ['id', { id: ids.admin }]
];
for (const [nombre, body] of intentos) {
    const r = await guardar(body);
    check(`${nombre}: 403 PROHIBIDO`, r.estado === 403 && r.cuerpo.codigo === 'PROHIBIDO', `(${r.estado})`);
}

const r13 = await guardar({ full_name: 'Ana Admin', role: 'admin' });
check('rol escondido entre campos validos: 403', r13.estado === 403);
check('la respuesta dice que campo se rechazo y cuales se pueden editar',
    r13.cuerpo.campos.join() === 'role' && r13.cuerpo.editables.join() === 'full_name,phone,language');

const trasIntentos = await fila();
check('nada se guardo: ni el rol ni el nombre que venia al lado',
    trasIntentos.role === 'employee' && trasIntentos.full_name === guardado.full_name &&
    trasIntentos.is_active === true && trasIntentos.email === 'employee.contrato@hf.com' &&
    trasIntentos.total_points === guardado.total_points);

// =====================================================================
console.log('\n--- SOLO EL PERFIL PROPIO (tecnico 9) ---');
// =====================================================================

const delAdmin = await fila(ids.admin);
await guardar({ full_name: 'Bruno Diaz' }, tokens.rh);
check('cada token modifica solo su propia fila',
    (await fila(ids.rh)).full_name === 'Bruno Diaz' && (await fila(ids.admin)).full_name === delAdmin.full_name);

const sinTokenPatch = await pedir('PATCH', '/api/users/me', { body: { full_name: 'Nadie' } });
check('sin token: 401', sinTokenPatch.estado === 401);

const otroToken = await pedir('PATCH', '/api/users/me', {
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.firma-falsa',
    body: { full_name: 'Falso' }
});
check('con un token adulterado: 401', otroToken.estado === 401);

// =====================================================================
console.log('\n--- FALLA AL GUARDAR (aceptacion 9, tecnico 10) ---');
// =====================================================================

// Falla justo en el UPDATE, despues de haber leido la fila dentro de la
// transaccion: es el punto donde un guardado sin transaccion dejaria algo a
// medias.
const queryReal = pg.query.bind(pg);
pg.query = (t, p) => (/^\s*UPDATE users SET/.test(t)
    ? Promise.reject(new Error('canceling statement due to statement timeout'))
    : queryReal(t, p));

const previo = await fila();
const r14 = await guardar({ full_name: 'Nombre Que No Llega', phone: '+573009999999' });
pg.query = queryReal;

check('la falla responde 500', r14.estado === 500, `(${r14.estado})`);
check('no muestra una confirmacion: sin el mensaje de exito ni sin_cambios',
    r14.cuerpo.msg !== 'Perfil actualizado correctamente' && r14.cuerpo.sin_cambios === undefined);
check('no filtra el error interno', !JSON.stringify(r14.cuerpo).includes('statement timeout'));
const trasFalla = await fila();
check('ni el nombre ni el telefono quedaron a medias',
    trasFalla.full_name === previo.full_name && trasFalla.phone === previo.phone);

// now() es la hora de INICIO DE LA TRANSACCION. Dentro de un bloque abierto
// queda clavada en el BEGIN; fuera, cada sentencia es su propia transaccion
// implicita y avanza con el reloj. Asi que se mide: se pregunta la hora, se
// espera, y se vuelve a preguntar. Si avanzo, la conexion no quedo dentro de
// ninguna transaccion.
//
// Antes esto era `now() = statement_timestamp()`, y fallaba de a ratos: el
// reloj de PGlite tiene granularidad de milisegundo, asi que fuera de
// transaccion esa resta da 0 o 1-2 ms segun le toque y la igualdad exacta
// se caia en una corrida de cada dos o tres. Medir el avance no depende ni
// de la granularidad del reloj ni de hace cuanto se abrio la transaccion.
const ESPERA_MS = 30;
const hora = async () => (await pg.query('SELECT now() AS t')).rows[0].t;
const horaAntes = await hora();
await new Promise(r => setTimeout(r, ESPERA_MS));
const horaDespues = await hora();
const en_tx = (new Date(horaDespues) - new Date(horaAntes)) >= ESPERA_MS / 2;
check('la transaccion se cerro con ROLLBACK (la conexion no quedo dentro de ella)', en_tx === true);

estado.caida = true;
const r15 = await guardar({ full_name: 'Base Caida' });
estado.caida = false;
check('con la base caida: 500 con traceId', r15.estado === 500 && !!r15.cuerpo.traceId);

const r16 = await guardar({ full_name: 'Ana Recuperada' });
check('despues de la falla se puede guardar normalmente', r16.estado === 200 && (await fila()).full_name === 'Ana Recuperada');

// =====================================================================
console.log('\n--- TRAZABILIDAD (data.logs) ---');
// =====================================================================

await drenar();
const logs = await logsDePerfil();
const ultimo = logs[logs.length - 1];
check('cada guardado con cambios deja una fila en data.logs', !!ultimo && ultimo.user_id === miId);
check('con el valor anterior y el nuevo de lo que cambio, nada mas',
    ultimo.old_value?.full_name === previo.full_name && ultimo.new_value?.full_name === 'Ana Recuperada' &&
    !('phone' in ultimo.new_value), JSON.stringify(ultimo));

// =====================================================================
console.log('\n--- COMPATIBILIDAD Y BASE ---');
// =====================================================================

const r17 = await guardar({ language: 'en' });
check('cambiar solo el idioma sigue funcionando (pantalla de notificaciones)',
    r17.estado === 200 && r17.cuerpo.language === 'en' && r17.cuerpo.id === miId);
const r18 = await guardar({ language: null });
check('null vuelve al idioma de la plataforma', r18.estado === 200 && r18.cuerpo.language === null);

let rechazo = null;
try { await pg.query(`UPDATE users SET phone = 'abc1234567' WHERE id = $1`, [miId]); }
catch (e) { rechazo = msg(e); }
check('el CHECK de la base rechaza un telefono con letras aunque se saltee el servicio',
    /users_phone_formato/.test(rechazo || ''), `(${rechazo})`);

// =====================================================================
console.log('\n--- DOMINIO (sin base) ---');
// =====================================================================

check('la lista blanca es exactamente nombre, telefono e idioma',
    dominio.CAMPOS_EDITABLES_PERFIL.join() === 'full_name,phone,language');
check('camposProtegidos devuelve lo que sobra',
    dominio.camposProtegidos({ full_name: 'x', role: 'a', is_active: true }).join() === 'role,is_active');
const v = dominio.validarPerfil({ full_name: "  Maria  José O'Neill-Gómez ", phone: '+57 300.123.45-67' });
check('acepta tildes, apostrofo y guion, y normaliza',
    v.errores.length === 0 && v.valores.full_name === "Maria José O'Neill-Gómez" && v.valores.phone === '+573001234567');
check('solo valida los campos que vienen', Object.keys(dominio.validarPerfil({ language: 'es' }).valores).join() === 'language');
check('cambiosDePerfil ignora lo que es igual (null y ausente son lo mismo)',
    Object.keys(dominio.cambiosDePerfil({ full_name: 'A', phone: null }, { full_name: 'A', phone: null })).length === 0);

await api.cerrar();
console.log(`\nRESULTADO: ${ok} OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
