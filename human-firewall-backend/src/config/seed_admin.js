const db = require('./db');
const { hashPassword } = require('../utils/hash');

async function createAdmin() {
    try {
        const email = 'admin@humanfirewall.com';
        const password = 'AdminPassword123!';
        
        console.log(`Intentando crear admin: ${email}`);
        const hashed = await hashPassword(password);

        const { rows } = await db.query(
            "INSERT INTO users (email, password, role) VALUES ($1, $2, 'admin') RETURNING id, email",
            [email, hashed]
        );

        console.log("✅ Admin creado correctamente:", rows[0]);
    } catch (error) {
        if (error.code === '23505') { // Unique violation en Postgres
            console.log("⚠️ El admin ya existe en la base de datos.");
        } else {
            console.error("❌ Error creando admin:", error.message);
        }
    } finally {
        process.exit();
    }
}

createAdmin();
