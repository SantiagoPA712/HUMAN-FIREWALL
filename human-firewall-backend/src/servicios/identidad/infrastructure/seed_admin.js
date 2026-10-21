/**
 * Script que crea una cuenta admin con credenciales tomadas del entorno.
 *
 *     node src/servicios/identidad/infraestructura/seed_admin.js
 *
 * Antes el correo y la contrasena estaban escritos en este archivo
 * (AdminPassword123!), o sea publicados en el repositorio. Ahora salen del
 * entorno y no hay ningun valor por defecto: sin ADMIN_PASSWORD no se crea
 * nada.
 *
 *   ADMIN_EMAIL=admin@empresa.com ADMIN_PASSWORD='...' node src/servicios/identidad/infraestructura/seed_admin.js
 *
 * La cuenta admin de desarrollo la crea la migracion 027; este script es
 * para entornos donde se quiera otra.
 */
require('dotenv').config();
const db = require('../../../compartido/config/db');
const { hashPassword } = require('../../../compartido/utils/hash');
const entorno = require('../../../compartido/config/entorno');

async function crearAdmin() {
    try {
        const email = entorno.obligatoria('ADMIN_EMAIL');
        const password = entorno.obligatoria('ADMIN_PASSWORD');

        console.log(`Intentando crear admin: ${email}`);
        const hashed = await hashPassword(password);

        const { rows } = await db.query(
            "INSERT INTO users (email, password, role) VALUES ($1, $2, 'admin') RETURNING id, email",
            [email, hashed]
        );

        console.log('Admin creado correctamente:', rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            console.log('El admin ya existe en la base de datos.');
        } else {
            console.error('Error creando admin:', error.message);
            process.exitCode = 1;
        }
    } finally {
        await db.end?.();
    }
}

crearAdmin();
