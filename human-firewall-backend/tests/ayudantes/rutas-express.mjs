/**
 * Lista las rutas reales que tiene montadas la API, con lo que aplica cada
 * una: si exige token, que roles, si valida un DTO.
 *
 * Se arma recorriendo los routers que declara cada servicio
 * (servicios/<servicio>/index.js -> rutas()), no leyendo la documentacion:
 * por eso sirve para compararla contra el contrato OpenAPI.
 */

/** '/:id/leida' -> '/{id}/leida' */
export const aOpenApi = (ruta) => ruta.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * @returns {Array<{servicio, metodo, ruta, autenticada, roles, propietario, dtos}>}
 */
export function listarRutas(require_) {
    const servicios = require_('./servicios');
    const salida = [];

    for (const { servicio, prefijo, router } of servicios.rutas()) {
        // Middlewares de router.use(): aplican a todas las rutas del router.
        const generales = router.stack.filter(l => !l.route).map(l => l.handle);

        for (const layer of router.stack.filter(l => l.route)) {
            const rutas = [].concat(layer.route.path);
            const handles = [...generales, ...layer.route.stack.map(l => l.handle)];
            const metodos = Object.keys(layer.route.methods).filter(m => m !== '_all');

            // router.all(): rechazo explicito de metodos (405), no es una operacion.
            if (layer.route.methods._all) continue;

            const autenticada = handles.some(h => h.requiereAutenticacion);
            const roles = [...new Set(handles.flatMap(h => h.roles || []))];
            const propietario = handles.find(h => h.propietario)?.propietario || null;
            const dtos = handles.filter(h => h.dto).map(h => h.dto);

            for (const r of rutas) {
                for (const metodo of metodos) {
                    const completa = (prefijo + (r === '/' ? '' : r)) || '/';
                    salida.push({
                        servicio,
                        metodo,
                        ruta: aOpenApi(completa),
                        autenticada,
                        roles,
                        propietario,
                        dtos
                    });
                }
            }
        }
    }
    return salida;
}
