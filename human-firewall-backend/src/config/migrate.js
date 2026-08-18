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

// config -> src -> human-firewall-backend -> raiz del repositorio
const RAIZ = path.join(__dirname, '..', '..', '..');
const DIR_MIGRACIONES = path.join(RAIZ, 'migrations');
const SCHEMA = path.join(RAIZ, 'schema.sql');

// schema.sql se trata como la migracion cero: crea las tablas originales del
// proyecto, sobre las que despues aplican todas las demas.
const NOMBRE_SCHEMA = '000_schema.sql';

async function asegurarTablaDeControl() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function yaAplicadas() {
    const { rows } = await db.query('SELECT filename FROM schema_migrations');
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
async function aplicar(nombre, rutaCompleta) {
    const sql = fs.readFileSync(rutaCompleta, 'utf8');
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [nombre]
        );
        await client.query('COMMIT');
        console.log(`  aplicada  ${nombre}`);
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

    if (nuevas === 0) {
        console.log('Base de datos al dia: no habia migraciones pendientes.');
    } else {
        console.log(`Listo: ${nuevas} ${nuevas === 1 ? 'migracion aplicada' : 'migraciones aplicadas'}.`);
    }
}

// Solo corre si se invoca directo (npm run migrate). Importarlo desde una
// prueba no dispara nada.
if (require.main === module) {
    migrar()
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
