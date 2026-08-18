/**
 * Crea el archivo .env listo para usar.
 *
 * Copiar .env.example a mano dejaba dos campos que el integrante nuevo no
 * sabia con que llenar:
 *
 *   - JWT_SECRET, que hay que inventar. Si queda vacio el servidor arranca
 *     igual pero firma los tokens con la cadena 'secret', y con eso cualquiera
 *     puede fabricarse un token de admin.
 *   - DATABASE_URL, que depende de donde corra la base.
 *
 * Este script resuelve los dos: genera un secreto aleatorio y deja apuntada la
 * base del docker-compose del repositorio.
 *
 *     npm run setup
 *
 * Si el .env ya existe no lo toca, para no pisarle a nadie su configuracion
 * (por ejemplo si apunta a Supabase en vez de al contenedor local).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DESTINO = path.join(__dirname, '..', '.env');

// Coincide con el puerto que publica docker-compose.yml.
const URL_LOCAL = 'postgresql://postgres:postgres@localhost:5433/postgres';

if (fs.existsSync(DESTINO)) {
    console.log('El archivo .env ya existe: no se toca.');
    console.log('Si queres regenerarlo, borralo y volve a correr npm run setup.');
    process.exit(0);
}

const secreto = crypto.randomBytes(32).toString('hex');

const contenido = `# Generado por "npm run setup". No se sube al repositorio.

# --- Base de datos ---
# Por defecto apunta al contenedor de docker-compose.yml del repositorio.
# Para levantarlo, desde la raiz:  docker compose up -d
#
# El puerto es el 5433 y no el 5432 porque, si tenes PostgreSQL instalado en
# tu maquina, ese ya ocupa el 5432 y las conexiones terminan yendo ahi.
#
# Si en cambio usas Supabase, reemplaza esta linea por la cadena que te da el
# panel en Settings > Database > Connection string (modo URI).
DATABASE_URL=${URL_LOCAL}

# --- Servidor ---
PORT=3000

# --- Autenticacion JWT ---
# Generado al azar para esta instalacion. No hace falta que coincida con el de
# tus companeros: cada uno firma los tokens de su propio entorno.
JWT_SECRET=${secreto}
JWT_EXPIRES=1d

# --- Google OAuth (SSO) ---
# Opcionales. Sin ellos todo funciona salvo el boton de "entrar con Google".
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
`;

fs.writeFileSync(DESTINO, contenido, 'utf8');

console.log('.env creado con un JWT_SECRET nuevo.');
console.log(`Base de datos: ${URL_LOCAL}`);
console.log('\nSi todavia no levantaste la base, desde la raiz del repositorio:');
console.log('  docker compose up -d');
