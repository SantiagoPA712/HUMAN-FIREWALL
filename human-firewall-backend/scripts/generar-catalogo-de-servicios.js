/**
 * Genera docs/arquitectura/SERVICIOS.md: el catalogo de microservicios.
 *
 *     npm run docs:arquitectura
 *
 * Se arma a partir del codigo y no a mano, para que no pueda quedar
 * desactualizado: los manifiestos (responsabilidad, tablas, eventos,
 * dependencias), el contrato OpenAPI (endpoints), el index.js de cada
 * servicio (contrato interno) y el comentario de cabecera de cada archivo
 * (estructura de carpetas). tests/arquitectura.test.mjs falla si el archivo
 * del repositorio no coincide con lo que generaria este script.
 *
 * Uso como modulo: generar() devuelve el texto sin escribirlo.
 */

const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'solo-para-generar-documentacion';

const SRC = path.join(__dirname, '..', 'src');
const DESTINO = path.join(__dirname, '..', '..', 'docs', 'arquitectura', 'SERVICIOS.md');

const CAPAS = {
    api: 'Presentacion: rutas, controladores y DTO',
    aplicacion: 'Aplicacion: casos de uso',
    dominio: 'Dominio: reglas puras',
    infraestructura: 'Infraestructura: repositorios, clientes e integraciones',
    contrato: 'Contrato publico OpenAPI'
};

/** Primera oracion del comentario de cabecera de un archivo. */
function descripcion(archivo) {
    const texto = fs.readFileSync(archivo, 'utf8');
    const m = texto.match(/^\s*\/\*\*([\s\S]*?)\*\//);
    if (!m) return '';
    const plano = m[1]
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join(' ');
    const oracion = plano.match(/^(.+?\.)(\s|$)/);
    return (oracion ? oracion[1] : plano).replace(/\|/g, '\\|');
}

function acceso(op) {
    if (Array.isArray(op.security) && op.security.length === 0) return 'publica';
    const roles = op['x-roles'] || [];
    const base = roles.length ? roles.join(', ') : 'autenticado';
    return op['x-propietario'] ? `propio usuario, ${base}` : base;
}

function generar() {
    const silenciar = console.log;
    console.log = () => {};
    const { SERVICIOS } = require(path.join(SRC, 'servicios'));
    const contrato = require(path.join(SRC, 'compartido', 'contratos', 'openapi')).construir(SERVICIOS);
    const { analizarServicio } = require(path.join(SRC, 'compartido', 'arquitectura', 'analizador'));
    console.log = silenciar;

    const NO_PUBLICAS = new Set(['manifiesto', 'contrato', 'rutas', 'registrarHandlers', 'iniciarProcesos',
                                 'detenerProcesos', 'configurarAutenticacion']);
    const l = [];

    l.push('# Catalogo de microservicios');
    l.push('');
    l.push('> Archivo generado por `npm run docs:arquitectura` (human-firewall-backend/scripts/generar-catalogo-de-servicios.js).');
    l.push('> No editar a mano: se arma con los manifiestos, el contrato OpenAPI y el codigo de cada servicio,');
    l.push('> y `tests/arquitectura.test.mjs` falla si queda desactualizado.');
    l.push('');
    l.push(`Version del contrato publico: **${contrato.info.version}**. Contrato navegable en \`/api/docs\`.`);
    l.push('');
    l.push('| Servicio | Responsabilidad | Prefijos HTTP | Depende de |');
    l.push('|----------|-----------------|---------------|------------|');
    for (const s of SERVICIOS) {
        const m = s.manifiesto;
        l.push(`| [${m.nombre}](#${m.nombre}) | ${m.responsabilidad} | ${m.prefijos.map(p => `\`${p}\``).join('<br>')} | ${m.dependeDe.join(', ') || '-'} |`);
    }
    l.push('');

    for (const s of SERVICIOS) {
        const m = s.manifiesto;
        l.push('---');
        l.push('');
        l.push(`## ${m.nombre}`);
        l.push('');
        l.push(m.responsabilidad);
        l.push('');
        l.push(`- **Carpeta:** \`human-firewall-backend/src/servicios/${m.nombre}/\``);
        l.push(`- **Tablas propias:** ${m.tablas.map(t => `\`${t}\``).join(', ')}`);
        l.push(`- **Publica:** ${m.publica.map(e => `\`${e}\``).join(', ') || '-'}`);
        l.push(`- **Consume:** ${m.consume.map(e => `\`${e}\``).join(', ') || '-'}`);
        l.push(`- **Depende de (por contrato interno):** ${m.dependeDe.join(', ') || '-'}`);
        l.push(`- **Procesos de fondo:** ${m.procesos.join('; ') || '-'}`);
        l.push('');

        const excepciones = [
            ...m.lecturasCompartidas.map(d => ({ tipo: 'lee', ...d })),
            ...m.escriturasCompartidas.map(d => ({ tipo: 'escribe', ...d }))
        ];
        if (excepciones.length) {
            l.push('**Acceso declarado a datos de otros servicios** (verificado por las pruebas de arquitectura):');
            l.push('');
            l.push('| Tipo | Tablas | Dueno | Motivo |');
            l.push('|------|--------|-------|--------|');
            for (const d of excepciones) {
                const tablas = [].concat(d.tablas || d.tabla).map(t => `\`${t}\``).join(', ');
                const columnas = d.columnas ? ` (${d.columnas.join(', ')})` : '';
                l.push(`| ${d.tipo} | ${tablas}${columnas} | ${d.servicio} | ${d.motivo} |`);
            }
            l.push('');
        }

        l.push('### Endpoints');
        l.push('');
        l.push('| Metodo | Ruta | Acceso | Descripcion |');
        l.push('|--------|------|--------|-------------|');
        for (const [ruta, ops] of Object.entries(contrato.paths)) {
            for (const [metodo, op] of Object.entries(ops)) {
                if (op.tags?.[0] !== m.nombre) continue;
                l.push(`| ${metodo.toUpperCase()} | \`${ruta}\` | ${acceso(op)} | ${op.summary} |`);
            }
        }
        l.push('');

        const publicas = Object.keys(s).filter(k => !NO_PUBLICAS.has(k));
        l.push('### Contrato interno (index.js)');
        l.push('');
        l.push(publicas.length
            ? `Lo que otros servicios pueden usar, siempre a traves de un cliente en su \`infraestructura/clientes/\`: ${publicas.map(p => `\`${p}\``).join(', ')}.`
            : 'No expone funciones a otros servicios: su unico contrato es la API HTTP.');
        l.push('');

        l.push('### Estructura');
        l.push('');
        const orden = ['(raiz)', 'api', 'aplicacion', 'dominio', 'infraestructura', 'contrato'];
        const archivos = analizarServicio(m.nombre).sort((a, b) =>
            (orden.indexOf(a.capa) - orden.indexOf(b.capa)) || a.relativo.localeCompare(b.relativo));
        let capaActual = null;
        for (const f of archivos) {
            if (f.capa !== capaActual) {
                if (capaActual !== null) l.push('');
                capaActual = f.capa;
                l.push(capaActual === '(raiz)' ? '**Raiz del servicio**' : `**${capaActual}/** — ${CAPAS[capaActual] || ''}`);
                l.push('');
            }
            const nombre = f.relativo.replace(`servicios/${m.nombre}/`, '');
            l.push(`- \`${nombre}\` — ${descripcion(f.archivo) || '(sin descripcion)'}`);
        }
        l.push('');
    }

    return l.join('\n');
}

if (require.main === module) {
    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(DESTINO, generar());
    console.log(`Generado ${path.relative(process.cwd(), DESTINO)}`);
}

module.exports = { generar, DESTINO };
