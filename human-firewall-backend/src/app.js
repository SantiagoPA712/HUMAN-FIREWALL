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

// ID de correlacion (trace_id) para cada request. Va primero: cualquier log
// de auditoria y cualquier respuesta de error 500 lo llevan, incluso las de
// un cuerpo JSON mal formado. Ver compartido/middlewares/traceId.middleware.js.
const { asignarTraceId } = require('./compartido/middlewares/traceId.middleware');
app.use(asignarTraceId);

app.use(express.json());

const passport = require('passport');
const servicios = require('./servicios');

// Estrategia de Google (la usa /api/sso, que es del servicio de identidad).
servicios.servicio('identidad').configurarAutenticacion();
app.use(passport.initialize());

// --- API ---
//
// Cada servicio declara sus routers y el prefijo donde se montan (ver
// servicios/<servicio>/index.js). La lista completa, con el servicio dueno
// de cada prefijo, esta en servicios/index.js y en /api/docs.
//
// Todo lo que cuelga de /api va ANTES que los archivos estaticos y que el
// fallback de la SPA.
for (const { prefijo, router } of servicios.rutas()) {
    app.use(prefijo, router);
}

// Contratos de la API (OpenAPI 3.1) y su documentacion navegable.
//   GET /api/docs               interfaz Swagger UI
//   GET /api/docs/openapi.json  el contrato en JSON (importable en Postman)
// Ver compartido/contratos/openapi.js.
require('./compartido/contratos/openapi').montar(app, servicios.SERVICIOS);

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
        msg: `Endpoint no encontrado: ${req.method} ${req.originalUrl}`,
        codigo: 'NO_ENCONTRADO'
    });
});

// Manejador de errores de la API: lo que ningun controlador atrapo (JSON mal
// formado, validaciones de DTO, excepciones de middlewares) sale con el
// formato comun y sin detalles internos. Ver compartido/http/errores.js.
const { manejadorDeErrores } = require('./compartido/http/errores');
app.use('/api', manejadorDeErrores);

// --- Interfaz ---
//
// El build de React se sirve desde este mismo proceso. Eso es lo que hace al
// sistema un monolito de despliegue: un solo artefacto, un solo puerto, un
// solo origen. Antes hacian falta dos servidores corriendo a la vez.
const { DIR_FRONTEND_BUILD: RUTA_FRONTEND } = require('./compartido/config/rutas');
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
