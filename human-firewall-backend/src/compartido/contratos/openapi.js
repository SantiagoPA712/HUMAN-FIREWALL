/**
 * Contrato OpenAPI de toda la API.
 *
 * Cada servicio publica el suyo en servicios/<servicio>/contrato/openapi.js
 * (sus paths, sus esquemas y su etiqueta). Este archivo los junta en un solo
 * documento OpenAPI 3.1, agrega lo comun (seguridad, formato de error) y lo
 * sirve:
 *
 *   GET /api/docs               Swagger UI, para leerlo y probarlo
 *   GET /api/docs/openapi.json  el JSON, para importarlo en Postman o generar clientes
 *
 * Esta habilitado por defecto. En produccion (NODE_ENV=production) se apaga,
 * salvo que API_DOCS=true: publicar el mapa completo de la API no tiene que
 * ser una decision por omision.
 *
 * La version del contrato y la politica de cambios estan en
 * docs/contratos/POLITICA.md y docs/contratos/CHANGELOG.md.
 */

const comunes = require('./esquemas-comunes');

/** Version del contrato publico. Ver docs/contratos/POLITICA.md antes de cambiarla. */
const VERSION_CONTRATO = '1.0.0';

const cache = new WeakMap();

/**
 * Construye (una vez por lista de servicios) el documento OpenAPI completo.
 *
 * Recibe los servicios en lugar de importarlos: compartido no depende de
 * ningun servicio (lo verifica tests/arquitectura.test.mjs). Quien compone
 * la aplicacion (app.js) se los pasa.
 *
 * @param {Array} servicios  la lista de servicios/index.js (SERVICIOS)
 */
function construir(servicios) {
    if (cache.has(servicios)) return cache.get(servicios);

    const doc = {
        openapi: '3.1.0',
        info: {
            title: 'Human Firewall API',
            version: VERSION_CONTRATO,
            description:
                'API de la plataforma de concientizacion en ciberseguridad Human Firewall.\n\n' +
                'El backend esta organizado en microservicios logicos por capas (identidad, cursos, ' +
                'evaluaciones, gamificacion, notificaciones, reportes, seguridad) que se despliegan ' +
                'juntos en un solo proceso. Cada etiqueta de esta documentacion es un servicio.\n\n' +
                '**Autenticacion:** `Authorization: Bearer <token>`, con el JWT de `POST /api/auth/login`. ' +
                '`x-roles` indica que roles pueden llamar cada operacion (vacio = cualquier usuario autenticado).\n\n' +
                '**Errores:** todos con el formato `{ msg, codigo?, errores?, traceId? }`. Un 500 nunca trae ' +
                'detalles internos, solo el `traceId` para buscarlo en los logs.'
        },
        servers: [{ url: '/', description: 'Mismo origen (monolito de despliegue)' }],
        tags: [],
        paths: {},
        components: {
            securitySchemes: {
                bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
            },
            schemas: { ...comunes.schemas },
            responses: { ...comunes.responses }
        }
    };

    for (const servicio of servicios) {
        const nombre = servicio.manifiesto.nombre;
        const contrato = servicio.contrato();

        doc.tags.push({
            name: nombre,
            description: servicio.manifiesto.responsabilidad
        });

        for (const [ruta, operaciones] of Object.entries(contrato.paths || {})) {
            doc.paths[ruta] = doc.paths[ruta] || {};
            for (const [metodo, op] of Object.entries(operaciones)) {
                if (doc.paths[ruta][metodo]) {
                    throw new Error(`Contrato duplicado: ${metodo.toUpperCase()} ${ruta} (${nombre})`);
                }
                doc.paths[ruta][metodo] = { tags: [nombre], operationId: `${nombre}.${metodo}${ruta}`, ...op };
            }
        }

        for (const [esquema, definicion] of Object.entries(contrato.schemas || {})) {
            if (doc.components.schemas[esquema]) {
                throw new Error(`Esquema duplicado en contratos: ${esquema} (${nombre})`);
            }
            doc.components.schemas[esquema] = definicion;
        }
    }

    cache.set(servicios, doc);
    return doc;
}

/** Monta /api/docs y /api/docs/openapi.json en la app, si corresponde. */
function montar(app, servicios) {
    const habilitado = process.env.API_DOCS
        ? process.env.API_DOCS === 'true'
        : process.env.NODE_ENV !== 'production';
    if (!habilitado) return;

    const swaggerUi = require('swagger-ui-express');

    app.get('/api/docs/openapi.json', (req, res) => res.json(construir(servicios)));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(null, {
        customSiteTitle: 'Human Firewall API',
        swaggerOptions: { url: '/api/docs/openapi.json', persistAuthorization: true }
    }));
}

module.exports = { VERSION_CONTRATO, construir, montar };
