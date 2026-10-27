/**
 * Runner de migraciones.
 *
 * Antes habia que abrir el editor SQL de Supabase y pegar a mano cada archivo
 * de migrations/ en orden. Eso tenia tres problemas:
 *   - Nadie sabia cuales ya habia aplicado y cuales no.
 *   - Al hacer pull de una rama con migraciones nuevas, el backend arrancaba
 *     igual y reventaba recien al pedir un dato de una tabla inexistente.
 *   - Un integrante nuevo tenia que ejecutar todos los archivos uno por uno
 *     antes de poder levantar el proyecto.
 *
 * Ahora el estado vive en la tabla schema_migrations: cada archivo aplicado
 * queda registrado con su nombre, y en el arranque solo se ejecuta lo que
 * falta. Correrlo dos veces no hace nada la segunda vez.
 *
 *     npm run migrate     # aplicar lo pendiente
 *     npm run dev         # lo aplica solo y despues levanta el servidor
 *
 * Cada migracion corre dentro de una transaccion: si falla a la mitad, no
 * queda a medio aplicar ni se registra como hecha.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const bases = require('./bases');

const { RAIZ_REPO: RAIZ } = require('./rutas');
const DIR_MIGRACIONES = path.join(RAIZ, 'migrations');
const SCHEMA = path.join(RAIZ, 'schema.sql');

// schema.sql se trata como la migracion cero: crea las tablas originales del
// proyecto, sobre las que despues aplican todas las demas.
const NOMBRE_SCHEMA = '000_schema.sql';

async function asegurarTablaDeControl(base = db) {
    await base.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function yaAplicadas(base = db) {
    const { rows } = await base.query('SELECT filename FROM schema_migrations');
    return new Set(rows.map(r => r.filename));
}

async function existeTabla(nombre) {
    const { rows } = await db.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [nombre]
    );
    return rows.length > 0;
}

/**
 * Aplica un archivo SQL dentro de una transaccion y lo registra.
 */
async function aplicar(nombre, rutaCompleta, base = db, etiqueta = '') {
    const sql = fs.readFileSync(rutaCompleta, 'utf8');
    const client = await base.connect();

    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [nombre]
        );
        await client.query('COMMIT');
        console.log(`  aplicada  ${etiqueta}${nombre}`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${nombre}: ${err.message}`);
    } finally {
        client.release();
    }
}

async function migrar() {
    await asegurarTablaDeControl();
    const aplicadas = await yaAplicadas();
    let nuevas = 0;

    // --- schema.sql -------------------------------------------------
    if (!aplicadas.has(NOMBRE_SCHEMA)) {
        if (await existeTabla('users')) {
            // Base que ya venia funcionando desde antes de que existiera este
            // runner (por ejemplo la de Supabase, cargada a mano). Las tablas
            // ya estan; solo hay que anotar el estado para no reejecutar el
            // INSERT del admin, que chocaria contra el UNIQUE del email.
            await db.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                [NOMBRE_SCHEMA]
            );
            console.log(`  ya existia ${NOMBRE_SCHEMA} (base preexistente, solo se registra)`);
        } else {
            await aplicar(NOMBRE_SCHEMA, SCHEMA);
            nuevas++;
        }
    }

    // --- migrations/ ------------------------------------------------
    const archivos = fs.readdirSync(DIR_MIGRACIONES)
        .filter(f => f.endsWith('.sql'))
        // Orden numerico por nombre: 001, 002, ... 020, 021. Los nombres
        // llevan el numero con ceros a la izquierda, asi que el orden
        // alfabetico coincide con el cronologico.
        .sort();

    for (const archivo of archivos) {
        if (aplicadas.has(archivo)) continue;
        await aplicar(archivo, path.join(DIR_MIGRACIONES, archivo));
        nuevas++;
    }

    // --- migrations/servicios/<servicio>/ ----------------------------
    nuevas += await migrarServicios();

    if (nuevas === 0) {
        console.log('Base de datos al dia: no habia migraciones pendientes.');
    } else {
        console.log(`Listo: ${nuevas} ${nuevas === 1 ? 'migracion aplicada' : 'migraciones aplicadas'}.`);
    }
}

// ---------------------------------------------------------------------
// Base de datos por servicio
// ---------------------------------------------------------------------
//
// migrations/servicios/<servicio>/ tiene las migraciones de la base propia de
// cada servicio. 001_base.sql es la estructura completa del servicio (lo que
// dejo el historial 000-091); las siguientes (002, 003...) son los cambios
// nuevos de ese servicio.
//
// Con BASES_POR_SERVICIO=true el runner, por cada servicio:
//   1. crea su base si no existe (en el mismo servidor de DATABASE_URL),
//   2. le aplica sus migraciones pendientes,
//   3. la primera vez, copia los datos de su esquema desde la base compartida
//      (la que venia usando todo el equipo). La copia queda registrada y no se
//      repite.
//
// Con BASES_POR_SERVICIO=false todo vive en la base compartida, donde
// 001_base ya esta cubierta por el historial: solo se aplican las 002 en
// adelante, registradas como servicios/<servicio>/<archivo>.

const DIR_SERVICIOS = path.join(DIR_MIGRACIONES, 'servicios');
const BASE_INICIAL = '001_base.sql';
const COPIA_INICIAL = 'copia_desde_base_compartida';

function serviciosConMigraciones() {
    if (!fs.existsSync(DIR_SERVICIOS)) return [];
    return fs.readdirSync(DIR_SERVICIOS)
        .filter(s => fs.statSync(path.join(DIR_SERVICIOS, s)).isDirectory())
        .sort();
}

function archivosDe(servicio) {
    return fs.readdirSync(path.join(DIR_SERVICIOS, servicio)).filter(f => f.endsWith('.sql')).sort();
}

async function migrarServicios() {
    let nuevas = 0;
    const aplicadasCompartida = await yaAplicadas(db);

    for (const servicio of serviciosConMigraciones()) {
        const url = bases.urlDe(servicio);

        if (!bases.porServicio() || !url || url === process.env.DATABASE_URL) {
            // Modo compartido: el servicio vive en su esquema de la base comun.
            for (const archivo of archivosDe(servicio)) {
                const clave = `servicios/${servicio}/${archivo}`;
                if (archivo === BASE_INICIAL || aplicadasCompartida.has(clave)) continue;
                await aplicar(clave, path.join(DIR_SERVICIOS, servicio, archivo));
                nuevas++;
            }
            continue;
        }

        await crearBaseSiFalta(url);
        const base = bases.baseDe(url);
        await asegurarTablaDeControl(base);
        const aplicadas = await yaAplicadas(base);

        for (const archivo of archivosDe(servicio)) {
            if (aplicadas.has(archivo)) continue;
            await aplicar(archivo, path.join(DIR_SERVICIOS, servicio, archivo), base, `[${servicio}] `);
            nuevas++;
        }

        if (!aplicadas.has(COPIA_INICIAL)) {
            const filas = await copiarDesdeCompartida(base);
            await base.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [COPIA_INICIAL]);
            console.log(`  [${servicio}] datos copiados desde la base compartida (${filas} filas)`);
        }
    }
    return nuevas;
}

/** Crea la base del servicio si no existe y esta en el mismo servidor que la compartida. */
async function crearBaseSiFalta(url) {
    const destino = new URL(url);
    const origen = new URL(process.env.DATABASE_URL);
    if (destino.host !== origen.host) return;   // otro servidor: se asume creada

    const nombre = decodeURIComponent(destino.pathname.replace(/^\//, ''));
    if (!/^[A-Za-z0-9_]+$/.test(nombre)) throw new Error(`Nombre de base invalido: ${nombre}`);

    const { rows } = await db.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
    if (rows.length === 0) {
        await db.query(`CREATE DATABASE "${nombre}"`);
        console.log(`  creada    base ${nombre}`);
    }
}

/**
 * Copia los datos de los esquemas de la base del servicio desde la base
 * compartida. Se hace una sola vez: es el paso de "base compartida" a "base
 * por servicio" sin perder nada de lo que ya habia.
 *
 * Los datos viajan como JSON generado por PostgreSQL (json_agg), asi fechas,
 * numeros y JSON llegan tal cual, sin pasar por las conversiones de Node.
 */
async function copiarDesdeCompartida(base) {
    const { rows: tablas } = await base.query(
        `SELECT c.oid, n.nspname AS esquema, c.relname AS tabla
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND n.nspname NOT IN ('public', 'information_schema') AND n.nspname !~ '^pg_'`
    );
    if (tablas.length === 0) return 0;

    // Orden por llaves foraneas: primero las referenciadas.
    const { rows: fks } = await base.query(
        `SELECT conrelid AS hija, confrelid AS padre FROM pg_constraint
          WHERE contype = 'f' AND conrelid <> confrelid`
    );
    const orden = [];
    const pendientes = new Map(tablas.map(t => [t.oid, t]));
    while (pendientes.size) {
        const libres = [...pendientes.values()].filter(t =>
            !fks.some(f => f.hija === t.oid && pendientes.has(f.padre)));
        const lote = libres.length ? libres : [pendientes.values().next().value];
        for (const t of lote) { orden.push(t); pendientes.delete(t.oid); }
    }

    let total = 0;
    const client = await base.connect();
    try {
        await client.query('BEGIN');

        // Datos iniciales que dejo 001_base: se reemplazan por los reales.
        const conDatos = [];
        for (const t of orden) {
            const { rows } = await client.query(`SELECT 1 FROM "${t.esquema}"."${t.tabla}" LIMIT 1`);
            if (rows.length) conDatos.push(`"${t.esquema}"."${t.tabla}"`);
        }
        if (conDatos.length) await client.query(`TRUNCATE ${conDatos.join(', ')} CASCADE`);

        for (const t of orden) {
            const nombre = `"${t.esquema}"."${t.tabla}"`;
            const existe = await db.query('SELECT to_regclass($1) AS r', [`${t.esquema}.${t.tabla}`]);
            if (!existe.rows[0].r) continue;

            const { rows: columnas } = await client.query(
                `SELECT column_name FROM information_schema.columns
                  WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER'
                  ORDER BY ordinal_position`,
                [t.esquema, t.tabla]
            );
            const lista = columnas.map(c => `"${c.column_name}"`).join(', ');

            for (let desde = 0; ; desde += 1000) {
                const { rows: [{ lote }] } = await db.query(
                    `SELECT json_agg(x) AS lote FROM (SELECT * FROM ${nombre} ORDER BY 1 LIMIT 1000 OFFSET $1) x`,
                    [desde]
                );
                if (!lote) break;
                await client.query(
                    `INSERT INTO ${nombre} (${lista}) OVERRIDING SYSTEM VALUE
                     SELECT ${lista} FROM json_populate_recordset(NULL::${nombre}, $1::json)`,
                    [JSON.stringify(lote)]
                );
                total += lote.length;
                if (lote.length < 1000) break;
            }
        }

        // Las secuencias siguen desde el mayor id copiado.
        const { rows: secuencias } = await client.query(
            `SELECT s.oid::regclass::text AS secuencia, t.oid::regclass::text AS tabla, a.attname AS columna
               FROM pg_class s
               JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
               JOIN pg_class t ON t.oid = d.refobjid
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
              WHERE s.relkind = 'S'`
        );
        for (const s of secuencias) {
            await client.query(
                `SELECT setval($1::regclass, COALESCE(MAX("${s.columna}"), 1), MAX("${s.columna}") IS NOT NULL) FROM ${s.tabla}`,
                [s.secuencia]
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`copia de datos: ${err.message}`);
    } finally {
        client.release();
    }
    return total;
}

// Solo corre si se invoca directo (npm run migrate). Importarlo desde una
// prueba no dispara nada.
if (require.main === module) {
    migrar()
        .then(() => bases.cerrar())
        .then(() => process.exit(0))
        .catch(err => {
            console.error('\nNo se pudieron aplicar las migraciones:');
            console.error(`  ${err.message}\n`);

            // Los dos tropiezos mas comunes tienen una causa concreta y una
            // solucion de una linea. Decirla acá ahorra media hora.
            if (/ECONNREFUSED|ENOTFOUND|timeout/i.test(err.message)) {
                console.error('  Parece que la base no esta accesible.');
                console.error('  Si usas el Postgres local, levantalo con:  docker compose up -d');
                console.error('  Si usas Supabase, revisa DATABASE_URL en el .env.\n');
            } else if (/password authentication failed/i.test(err.message)) {
                console.error('  Usuario o contrasena incorrectos en DATABASE_URL.');
                console.error('  Ojo: si tenes PostgreSQL instalado en tu maquina, el puerto 5432 ya');
                console.error('  esta ocupado por el. El contenedor del proyecto usa el 5433.\n');
            } else if (/DATABASE_URL/i.test(err.message) || !process.env.DATABASE_URL) {
                console.error('  Falta DATABASE_URL. Copia .env.example a .env con:  npm run setup\n');
            }

            process.exit(1);
        });
}

module.exports = { migrar };
