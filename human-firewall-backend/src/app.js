const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const app = express();

// --- CORS: solo en desarrollo ---
//
// En el monolito el navegador pide la interfaz y la API al MISMO origen, asi
// que no queda ninguna peticion cruzada que haya que permitir. CORS se
// mantiene unicamente para el servidor de desarrollo de Vite, que corre en
// otro puerto (5173) mientras se programa.
//
// Dejarlo abierto en produccion permitiria que cualquier sitio de internet
// llamara a esta API desde el navegador de un usuario logueado.
if (process.env.NODE_ENV !== 'production') {
    app.use(cors());
}

app.use(express.json());

require('./config/passport');
const passport = require('passport');

app.use(passport.initialize());

// --- API ---
// Todo lo que cuelga de /api lo resuelve el servidor. Va ANTES que los
// archivos estaticos y que el fallback de la SPA.
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/sso', require('./routes/sso.routes'));
app.use('/api/courses', require('./routes/course.routes'));
app.use('/api/simulations', require('./routes/simulation.routes'));
app.use('/api/gamification', require('./routes/gamification.routes'));

// 404 de la API en JSON.
//
// Cualquier /api/* que no haya coincidido con una ruta real cae aca. Sin esto
// responde el manejador por defecto de Express, que devuelve HTML
// ("Cannot GET /api/noexiste") con content-type text/html: un cliente que hace
// res.json() se lo come y falla con un error de parseo que no dice nada.
//
// Va DESPUES de las rutas reales y ANTES de la interfaz, para que un endpoint
// inexistente nunca termine sirviendo el HTML de la SPA.
app.use('/api', (req, res) => {
    res.status(404).json({
        msg: `Endpoint no encontrado: ${req.method} ${req.originalUrl}`
    });
});

// --- Interfaz ---
//
// El build de React se sirve desde este mismo proceso. Eso es lo que hace al
// sistema un monolito de despliegue: un solo artefacto, un solo puerto, un
// solo origen. Antes hacian falta dos servidores corriendo a la vez.
const RUTA_FRONTEND = path.join(__dirname, '..', '..', 'human-firewall-frontend', 'dist');
const hayBuild = fs.existsSync(path.join(RUTA_FRONTEND, 'index.html'));

if (hayBuild) {
    // Archivos compilados: JS, CSS, imagenes.
    app.use(express.static(RUTA_FRONTEND));

    // Fallback de la SPA.
    //
    // React Router resuelve /dashboard, /admin, /simulation/... dentro del
    // navegador, pero al RECARGAR una de esas URLs el navegador se la pide al
    // servidor, que no tiene ninguna ruta declarada para ellas. Sin este
    // fallback la respuesta seria 404 y la pagina quedaria rota al refrescar.
    //
    // El lookahead excluye /api para que un endpoint inexistente siga
    // devolviendo un 404 de verdad, y no el HTML de la SPA (que romperia a
    // cualquier cliente que espere JSON).
    //
    // Se usa una expresion regular y no la cadena '*' porque Express 5 cambio
    // el parser de rutas y ya no acepta el comodin suelto.
    app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(RUTA_FRONTEND, 'index.html'));
    });
} else {
    // Sin build todavia: se avisa que falta compilar, en vez de dejar un 404
    // silencioso que parece un error del servidor.
    app.get('/', (req, res) => {
        res.status(200).send(
            'API funcionando. La interfaz todavia no esta compilada: ejecuta "npm run build" en la raiz del repositorio.'
        );
    });
}

module.exports = app;
