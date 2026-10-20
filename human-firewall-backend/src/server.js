require('dotenv').config();

console.log("🧠 server iniciando...");

// Configuracion obligatoria. Antes, sin JWT_SECRET el servidor arrancaba
// igual y firmaba los tokens con la cadena 'secret': cualquiera podia
// fabricarse un token de admin. Ahora no arranca y dice que falta.
const { faltantes } = require('./compartido/config/entorno');
const sinDefinir = faltantes();
if (sinDefinir.length > 0) {
    console.error(
        `❌ Faltan variables de entorno obligatorias: ${sinDefinir.join(', ')}.\n` +
        '   Corre "npm run setup" en la raiz (genera el .env) o definilas en human-firewall-backend/.env.'
    );
    process.exit(1);
}

const app = require('./app');

// --- Arquitectura basada en eventos ---
//
// Los modulos no se llaman entre si: publican hechos en el bus y quien tenga
// algo que hacer con ellos reacciona. Esta linea es la unica que los conecta,
// y el detalle de quien escucha que vive en cada servicios/<servicio>/index.js.
//
// Si esta llamada no corriera, la aplicacion arrancaria igual y responderia
// todos los endpoints: simplemente nadie asignaria puntos, ni subiria niveles,
// ni mandaria avisos. Ese es el precio del desacoplamiento y por eso el
// arranque loguea cuantos handlers quedaron registrados.
const { conectarTodo } = require('./servicios/suscriptores');

conectarTodo();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});
