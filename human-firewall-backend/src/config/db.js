const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Forzar a Node.js a usar IPv4 en lugar de IPv6 (Evita ETIMEDOUT en redes de LATAM/Locales)
dns.setDefaultResultOrder('ipv4first');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Forzar evasión de SSL corporativo o antivirus

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

module.exports = pool;