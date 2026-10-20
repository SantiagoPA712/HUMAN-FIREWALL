const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Forzar IPv4 en lugar de IPv6 (evita ETIMEDOUT en algunas redes locales).
dns.setDefaultResultOrder('ipv4first');

// SSL solo cuando la base es remota.
//
// Antes esto estaba fijo en { rejectUnauthorized: false }, lo que rompe contra
// un PostgreSQL local (no acepta conexiones SSL) y obligaba a desactivar la
// verificacion de certificados de TODO el proceso Node con
// NODE_TLS_REJECT_UNAUTHORIZED = '0'. Eso dejaba sin verificar tambien las
// llamadas a servicios externos, como el login con Google.
//
// Ahora el ajuste queda acotado al pool de la base: los proveedores en la nube
// siguen funcionando y el entorno local no necesita SSL.
const url = process.env.DATABASE_URL || '';
const esRemota = /supabase|neon\.tech|render\.com|amazonaws\.com|azure|heroku/i.test(url);
const forzarSSL = process.env.DB_SSL === 'true';

const pool = new Pool({
    connectionString: url,
    ssl: (esRemota || forzarSSL) ? { rejectUnauthorized: false } : false
});

module.exports = pool;
