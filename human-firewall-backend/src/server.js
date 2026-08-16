require('dotenv').config();

console.log("🧠 server iniciando...");

// Aviso de seguridad: auth.middleware cae a la cadena 'secret' si falta la
// variable. Con ese fallback cualquiera puede firmar un token de admin.
if (!process.env.JWT_SECRET) {
    console.warn("⚠️  JWT_SECRET no esta definido: se usara un valor por defecto INSEGURO. Definilo en .env antes de exponer el servidor.");
}

const app = require('./app');

// --- Gamificacion: cola de eventos asincrona ---
const eventBus = require('./services/eventBus');
const pointsService = require('./services/points.service');

pointsService.registrarHandlers();
eventBus.iniciarWorker();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});
