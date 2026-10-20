/**
 * Levanta la API completa contra una base PostgreSQL en memoria (PGlite).
 *
 * Lo usan las pruebas de contrato: arrancan app.js de verdad, en un puerto
 * libre, con todas las migraciones aplicadas y un usuario por rol, y le
 * hablan por HTTP. Asi lo que se verifica es la cadena real de middlewares
 * (autenticacion, rol, validacion, controlador, manejador de errores) y no
 * una copia armada a mano.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';

export const ROLES = ['employee', 'instructor', 'admin', 'rh', 'security', 'manager'];

export async function levantarApi() {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-prueba';
    process.env.JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';
    process.env.NODE_ENV = 'test';

    const DIR = fileURLToPath(new URL('../../../', import.meta.url));
    const require_ = createRequire(`${DIR}human-firewall-backend/src/server.js`);

    const pg = new PGlite();

    // Adaptador del pool con dos ganchos: contar consultas (para comprobar
    // que un 401/403/400 no toca la base) y simular una base caida (para
    // comprobar que un 500 no filtra detalles internos).
    const estado = { consultas: 0, caida: false };
    const ejecutar = (t, p) => {
        estado.consultas++;
        if (estado.caida) {
            return Promise.reject(Object.assign(
                new Error('connect ECONNREFUSED 10.9.9.9:5432 relation "users" password=supersecreta'),
                { code: 'ECONNREFUSED' }
            ));
        }
        return pg.query(t, p);
    };
    const adapter = {
        query: ejecutar,
        connect: async () => ({ query: ejecutar, release: () => {} })
    };
    const dbPath = require_.resolve('./compartido/config/db');
    require_.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: adapter };

    await pg.exec(readFileSync(`${DIR}schema.sql`, 'utf8'));
    for (const archivo of readdirSync(`${DIR}migrations`).filter(f => f.endsWith('.sql')).sort()) {
        await pg.exec(readFileSync(`${DIR}migrations/${archivo}`, 'utf8'));
    }

    // Silencia los logs de arranque de los servicios.
    const log = console.log;
    console.log = () => {};
    const app = require_('./app');
    require_('./servicios/suscriptores').conectarTodo({ iniciarWorker: false });
    console.log = log;

    const jwt = require_('jsonwebtoken');

    // Un usuario por rol.
    const ids = {};
    for (const rol of ROLES) {
        const { rows } = await pg.query(
            `INSERT INTO users (email, password, role) VALUES ($1, 'x', $2) RETURNING id`,
            [`${rol}.contrato@hf.com`, rol]
        );
        ids[rol] = rows[0].id;
    }
    const tokens = Object.fromEntries(
        ROLES.map(rol => [rol, jwt.sign({ id: ids[rol], role: rol }, process.env.JWT_SECRET, { expiresIn: '1h' })])
    );

    const servidor = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${servidor.address().port}`;

    /** Solicitud HTTP real. Devuelve { estado, cuerpo, headers }. */
    async function pedir(metodo, ruta, { token, body, crudo, headers = {} } = {}) {
        const r = await fetch(`${base}${ruta}`, {
            method: metodo,
            redirect: 'manual',
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body !== undefined || crudo !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers
            },
            body: crudo !== undefined ? crudo : (body !== undefined ? JSON.stringify(body) : undefined)
        });
        const tipo = r.headers.get('content-type') || '';
        const cuerpo = tipo.includes('json') ? await r.json() : await r.text();
        return { estado: r.status, cuerpo, headers: r.headers };
    }

    const cerrar = () => new Promise(r => servidor.close(r));

    return { pg, app, require_, ids, tokens, pedir, estado, cerrar, base };
}
