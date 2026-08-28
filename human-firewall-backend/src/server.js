require('dotenv').config();

console.log("🧠 server iniciando...");

// Aviso de seguridad: auth.middleware cae a la cadena 'secret' si falta la
// variable. Con ese fallback cualquiera puede firmar un token de admin.
if (!process.env.JWT_SECRET) {
    console.warn("⚠️  JWT_SECRET no esta definido: se usara un valor por defecto INSEGURO. Definilo en .env antes de exponer el servidor.");
}

const app = require('./app');

// --- Arquitectura basada en eventos ---
//
// Los modulos no se llaman entre si: publican hechos en el bus y quien tenga
// algo que hacer con ellos reacciona. Esta linea es la unica que los conecta,
// y el detalle de quien escucha que vive en events/suscriptores.js.
//
// Si esta llamada no corriera, la aplicacion arrancaria igual y responderia
// todos los endpoints: simplemente nadie asignaria puntos, ni subiria niveles,
// ni mandaria avisos. Ese es el precio del desacoplamiento y por eso el
// arranque loguea cuantos handlers quedaron registrados.
const { conectarTodo } = require('./events/suscriptores');

conectarTodo();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});
