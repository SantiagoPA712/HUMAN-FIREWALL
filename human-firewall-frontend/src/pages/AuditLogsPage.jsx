import React, { useCallback, useEffect, useState } from 'react';
import {
    ScrollText, ArrowLeft, AlertTriangle, Download, Filter, X,
    ArrowDownWideNarrow, ArrowUpWideNarrow, ChevronLeft, ChevronRight, SearchX, Cpu
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Panel de logs de auditoria (HU: registro centralizado data.logs).
 *
 * Criterios de aceptacion que cubre:
 *   1. listado con usuario, tipo de accion, recurso y fecha/hora, ordenable
 *      del mas reciente al mas antiguo
 *   2. filtros por fecha, usuario, modulo y tipo de accion, con estado vacio
 *   3. detalle con valor anterior/nuevo, IP y trace_id
 *   4. exportacion CSV con los filtros aplicados
 *
 * La pantalla no decide nada de seguridad: el backend responde 403 a quien no
 * sea admin sin tocar la base. El chequeo de rol de aca solo evita pintar una
 * pantalla que no va a poder cargar.
 */

// Textos de cada tipo de accion y modulo. Los valores son los de data.logs.
const ETIQUETA_ACCION = {
    create: 'Alta',
    update: 'Cambio de datos',
    delete: 'Borrado',
    deactivate: 'Baja de usuario',
    role_change: 'Cambio de rol',
    login_failed: 'Login fallido',
    password_reset: 'Cambio de clave',
    export: 'Exportado de datos',
    config_change: 'Cambio de ajustes',
    manual_adjustment: 'Ajuste manual',
    status_change: 'Cambio de estado',
    retention_purge: 'Purga programada'
};

const ETIQUETA_MODULO = {
    auth: 'Acceso',
    users: 'Usuarios',
    gamification: 'Puntos y premios',
    security: 'Seguridad',
    reports: 'Reportes',
    logs: 'Registro',
    system: 'Sistema'
};

// Acciones que merecen destacarse en el listado: son las primeras que se
// miran ante un incidente.
const COLOR_ACCION = {
    login_failed: 'bg-red-500/15 text-red-400',
    role_change: 'bg-orange-500/15 text-orange-400',
    password_reset: 'bg-orange-500/15 text-orange-400',
    export: 'bg-yellow-500/15 text-yellow-400',
    deactivate: 'bg-gray-700 text-text-secondary'
};

const FILTROS_VACIOS = { desde: '', hasta: '', user_id: '', module: '', action_type: '' };

const entradaClase =
    'w-full rounded-lg border border-gray-700 bg-bg-deep/60 px-3 py-2 text-sm text-text-primary ' +
    'focus:border-brand-blue focus:outline-none';

const fecha = (iso) => new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium', timeStyle: 'medium'
});

/**
 * Traduce los filtros de la pantalla a query string.
 *
 * Las fechas se mandan como instantes ISO calculados en la hora LOCAL del
 * navegador: "desde el 22" es desde las 00:00 del 22 en Colombia, no en UTC.
 * Si se mandara la fecha sola, el servidor la interpretaria en su propia zona
 * horaria y un log de las 8 p. m. podria caer en el dia siguiente.
 */
function aQuery(filtros, orden, extra = {}) {
    const p = new URLSearchParams();
    if (filtros.desde) p.append('from', new Date(`${filtros.desde}T00:00:00`).toISOString());
    if (filtros.hasta) p.append('to', new Date(`${filtros.hasta}T23:59:59.999`).toISOString());
    if (filtros.user_id) p.append('user_id', filtros.user_id);
    if (filtros.module) p.append('module', filtros.module);
    if (filtros.action_type) p.append('action_type', filtros.action_type);
    p.append('order', orden);
    for (const [k, v] of Object.entries(extra)) p.append(k, v);
    return p.toString();
}

export default function AuditLogsPage() {
    const usuario = getUsuarioActual();
    const autorizado = usuario?.role === 'admin';

    const [opciones, setOpciones] = useState(null);

    // Dos copias de los filtros: lo que se esta escribiendo y lo que ya se
    // aplico. El listado y la exportacion usan SIEMPRE los aplicados, asi el
    // CSV es exactamente lo que se ve en pantalla aunque alguien haya tocado
    // un campo sin darle a "Aplicar" (criterio de aceptacion 4).
    const [borrador, setBorrador] = useState(FILTROS_VACIOS);
    const [aplicados, setAplicados] = useState(FILTROS_VACIOS);
    const [orden, setOrden] = useState('desc');
    const [pagina, setPagina] = useState(1);

    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [detalle, setDetalle] = useState(null);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const { data } = await api.get(`/api/logs?${aQuery(aplicados, orden, { page: pagina })}`);
            setDatos(data);
            setError(null);
        } catch (e) {
            const errores = e.response?.data?.errores;
            setError(errores?.length
                ? errores.map(x => x.detalle).join(' ')
                : e.response?.data?.msg || 'No se pudo cargar el registro');
        } finally {
            setCargando(false);
        }
    }, [aplicados, orden, pagina]);

    // Carga de datos en un efecto: el caso que la propia documentacion de
    // React acepta. Mismo patron que SecurityPanel y ReportsPage.
    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        if (!autorizado) return;
        /* eslint-disable-next-line react-hooks/set-state-in-effect */
        cargar();
    }, [autorizado, cargar]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!autorizado) return;
        api.get('/api/logs/filtros')
            .then(({ data }) => setOpciones(data))
            .catch(() => setOpciones({ modulos: Object.keys(ETIQUETA_MODULO), acciones: Object.keys(ETIQUETA_ACCION), usuarios: [] }));
    }, [autorizado]);

    const aplicar = (e) => {
        e?.preventDefault();
        setAplicados(borrador);
        setPagina(1);
    };

    const limpiar = () => {
        setBorrador(FILTROS_VACIOS);
        setAplicados(FILTROS_VACIOS);
        setPagina(1);
    };

    const abrirDetalle = async (id) => {
        try {
            const { data } = await api.get(`/api/logs/${id}`);
            setDetalle(data);
        } catch (e) {
            setError(e.response?.data?.msg || 'No se pudo abrir el registro');
        }
    };

    /**
     * Descarga el CSV. Va por axios y no por un enlace porque el endpoint
     * pide el token en el encabezado. Se pide como blob, y si el backend
     * responde un error (JSON dentro del blob) hay que leerlo para mostrar
     * el mensaje real.
     */
    const exportar = async () => {
        setExportando(true);
        try {
            const respuesta = await api.get(`/api/logs/export?${aQuery(aplicados, orden)}`, { responseType: 'blob' });
            const cabecera = respuesta.headers['content-disposition'] || '';
            const nombre = /filename="?([^"]+)"?/.exec(cabecera)?.[1] || 'logs_auditoria.csv';

            const url = URL.createObjectURL(respuesta.data);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = nombre;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            URL.revokeObjectURL(url);
            setError(null);
        } catch (e) {
            let mensaje = 'No se pudo exportar';
            if (e.response?.data instanceof Blob) {
                try {
                    const cuerpo = JSON.parse(await e.response.data.text());
                    mensaje = cuerpo.errores?.[0]?.detalle || cuerpo.msg || mensaje;
                } catch { /* se queda el mensaje generico */ }
            }
            setError(mensaje);
        } finally {
            setExportando(false);
        }
    };

    if (!autorizado) {
        return (
            <Marco>
                <Card className="border-l-4 border-l-red-500 p-8 text-center">
                    <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-500" />
                    <p className="font-bold">Esta vista es solo para administradores</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        Tu cuenta no tiene permisos para ver el registro de acciones.
                    </p>
                </Card>
            </Marco>
        );
    }

    const hayFiltros = Object.values(aplicados).some(Boolean);
    const pag = datos?.paginacion;

    return (
        <Marco>
            {/* Filtros (criterio de aceptacion 2) */}
            <Card className="mb-6 p-5">
                <form onSubmit={aplicar} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <Campo etiqueta="Desde">
                        <input type="date" value={borrador.desde} className={entradaClase}
                               onChange={e => setBorrador({ ...borrador, desde: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="Hasta">
                        <input type="date" value={borrador.hasta} className={entradaClase}
                               onChange={e => setBorrador({ ...borrador, hasta: e.target.value })} />
                    </Campo>
                    <Campo etiqueta="Usuario">
                        <select value={borrador.user_id} className={entradaClase}
                                onChange={e => setBorrador({ ...borrador, user_id: e.target.value })}>
                            <option value="">Todos</option>
                            <option value="system">Sistema</option>
                            {(opciones?.usuarios || []).map(u => (
                                <option key={u.user_id} value={u.user_id}>{u.actor_email || `#${u.user_id}`}</option>
                            ))}
                        </select>
                    </Campo>
                    <Campo etiqueta="Origen">
                        <select value={borrador.module} className={entradaClase}
                                onChange={e => setBorrador({ ...borrador, module: e.target.value })}>
                            <option value="">Todos</option>
                            {(opciones?.modulos || []).map(m => (
                                <option key={m} value={m}>{ETIQUETA_MODULO[m] || m}</option>
                            ))}
                        </select>
                    </Campo>
                    <Campo etiqueta="Tipo">
                        <select value={borrador.action_type} className={entradaClase}
                                onChange={e => setBorrador({ ...borrador, action_type: e.target.value })}>
                            <option value="">Todos</option>
                            {(opciones?.acciones || []).map(a => (
                                <option key={a} value={a}>{ETIQUETA_ACCION[a] || a}</option>
                            ))}
                        </select>
                    </Campo>

                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
                        <Button type="submit" className="h-9 px-4 py-0 text-sm">
                            <Filter className="h-4 w-4" /> Aplicar filtros
                        </Button>
                        {hayFiltros && (
                            <Button type="button" variant="outline" onClick={limpiar}
                                    className="h-9 border-gray-700 px-4 py-0 text-sm text-text-secondary">
                                <X className="h-4 w-4" /> Limpiar
                            </Button>
                        )}

                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            {/* Orden (criterio de aceptacion 1) */}
                            <Button type="button" variant="outline"
                                    onClick={() => { setOrden(orden === 'desc' ? 'asc' : 'desc'); setPagina(1); }}
                                    className="h-9 border-gray-700 px-4 py-0 text-sm text-text-secondary">
                                {orden === 'desc'
                                    ? <><ArrowDownWideNarrow className="h-4 w-4" /> Recientes primero</>
                                    : <><ArrowUpWideNarrow className="h-4 w-4" /> Antiguos primero</>}
                            </Button>

                            {/* Exportacion (criterio de aceptacion 4) */}
                            <Button type="button" onClick={exportar}
                                    disabled={exportando || !pag || pag.total === 0}
                                    title="El archivo trae exactamente los filtros aplicados, todas las hojas"
                                    className="h-9 px-4 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-50">
                                <Download className="h-4 w-4" /> {exportando ? 'Generando...' : 'Exportar CSV'}
                            </Button>
                        </div>
                    </div>
                </form>
            </Card>

            {error && (
                <Card className="mb-6 border-l-4 border-l-red-500 p-4">
                    <p className="text-sm text-red-400">{error}</p>
                </Card>
            )}

            {datos && datos.resultados.length === 0 && (
                // Estado vacio claro, no un error (criterio de aceptacion 2).
                <Card className="p-12 text-center">
                    <SearchX className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                    <p className="font-semibold">
                        {hayFiltros ? 'Nada que mostrar con estos filtros' : 'Todavia no hay acciones registradas'}
                    </p>
                    <p className="mt-1 text-sm text-text-secondary">
                        {hayFiltros
                            ? 'Prueba con otro rango de fechas o limpia los filtros.'
                            : 'Los logins fallidos, cambios de rol, exportaciones y ajustes van a aparecer aqui.'}
                    </p>
                    {hayFiltros && (
                        <Button variant="outline" onClick={limpiar}
                                className="mx-auto mt-4 h-9 border-gray-700 px-4 py-0 text-sm text-text-secondary">
                            Limpiar filtros
                        </Button>
                    )}
                </Card>
            )}

            {datos && datos.resultados.length > 0 && (
                <Card className={`p-6 transition-opacity ${cargando ? 'opacity-60' : ''}`}>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-700 text-text-secondary">
                                    <th className="p-3 font-medium">Fecha y hora</th>
                                    <th className="p-3 font-medium">Usuario</th>
                                    <th className="p-3 font-medium">Tipo</th>
                                    <th className="p-3 font-medium">Origen</th>
                                    <th className="p-3 font-medium">Recurso</th>
                                </tr>
                            </thead>
                            <tbody>
                                {datos.resultados.map(l => (
                                    <tr key={l.id} onClick={() => abrirDetalle(l.id)}
                                        className="cursor-pointer border-b border-gray-800 hover:bg-gray-800/40">
                                        <td className="whitespace-nowrap p-3 text-text-secondary">{fecha(l.occurred_at)}</td>
                                        <td className="p-3"><Actor log={l} /></td>
                                        <td className="p-3"><ChipAccion accion={l.action_type} /></td>
                                        <td className="p-3 text-text-secondary">{ETIQUETA_MODULO[l.module] || l.module}</td>
                                        <td className="p-3">
                                            <code className="text-xs">{l.resource_type}</code>
                                            {l.resource_id && <span className="text-text-secondary"> #{l.resource_id}</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Paginacion (criterio tecnico 7) */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
                        <span>{pag.total} {pag.total === 1 ? 'registro' : 'registros'} · hoja {pag.page} de {pag.total_paginas}</span>
                        <div className="flex gap-2">
                            <Button variant="outline" disabled={pag.page <= 1 || cargando}
                                    onClick={() => setPagina(pag.page - 1)}
                                    className="h-8 border-gray-700 px-3 py-0 text-xs disabled:opacity-40">
                                <ChevronLeft className="h-4 w-4" /> Anterior
                            </Button>
                            <Button variant="outline" disabled={pag.page >= pag.total_paginas || cargando}
                                    onClick={() => setPagina(pag.page + 1)}
                                    className="h-8 border-gray-700 px-3 py-0 text-xs disabled:opacity-40">
                                Siguiente <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {detalle && <ModalDetalle log={detalle} onCerrar={() => setDetalle(null)} />}
        </Marco>
    );
}

function Actor({ log }) {
    if (log.actor_type === 'system') {
        return (
            <span className="inline-flex items-center gap-1 text-text-secondary">
                <Cpu className="h-3.5 w-3.5" /> Sistema
            </span>
        );
    }
    return <span>{log.actor_email || (log.user_id ? `#${log.user_id}` : 'desconocido')}</span>;
}

function ChipAccion({ accion }) {
    return (
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COLOR_ACCION[accion] || 'bg-brand-blue/15 text-brand-light'}`}>
            {ETIQUETA_ACCION[accion] || accion}
        </span>
    );
}

/**
 * Detalle completo (criterio de aceptacion 3).
 *
 * El antes/despues se muestra campo por campo y no como dos bloques de JSON:
 * lo que importa en una investigacion es QUE cambio, y en un bloque de JSON
 * hay que compararlo a ojo.
 */
function ModalDetalle({ log, onCerrar }) {
    const antes = log.old_value || {};
    const despues = log.new_value || {};
    const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])];
    const texto = (v) => (v === undefined ? '' : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm"
             role="dialog" aria-modal="true" onClick={onCerrar}>
            <div className="my-8 w-full max-w-3xl rounded-2xl border border-gray-800 bg-bg-deep p-8"
                 onClick={(e) => e.stopPropagation()}>

                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <ChipAccion accion={log.action_type} />
                            <span className="font-mono text-xs text-text-secondary">#{log.id}</span>
                        </div>
                        <h2 className="text-2xl font-bold"><Actor log={log} /></h2>
                        <p className="text-sm text-text-secondary">
                            {ETIQUETA_MODULO[log.module] || log.module} · <code>{log.resource_type}</code>
                            {log.resource_id && ` #${log.resource_id}`} · {fecha(log.occurred_at)}
                        </p>
                    </div>
                    <button onClick={onCerrar} className="text-text-secondary hover:text-white" aria-label="Cerrar">✕</button>
                </div>

                <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Dato titulo="IP de origen" valor={log.ip_address || (log.actor_type === 'system' ? 'no aplica (sistema)' : 'no registrada')} />
                    <Dato titulo="trace_id (correlacion)" valor={log.trace_id || 'sin traza'} mono />
                    <Dato titulo="Hora del servidor" valor={fecha(log.occurred_at)} />
                    <Dato titulo="Guardado en el log" valor={fecha(log.recorded_at)} />
                </div>

                <h3 className="mb-3 font-bold">Valores</h3>
                {claves.length === 0 ? (
                    <p className="text-sm text-text-secondary">Este registro no tiene valor anterior ni nuevo.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-700 text-text-secondary">
                                    <th className="p-2 font-medium">Campo</th>
                                    <th className="p-2 font-medium">Valor anterior</th>
                                    <th className="p-2 font-medium">Valor nuevo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claves.map(k => {
                                    const cambio = log.old_value && texto(antes[k]) !== texto(despues[k]);
                                    return (
                                        <tr key={k} className={`border-b border-gray-800 ${cambio ? 'bg-brand-blue/5' : ''}`}>
                                            <td className="p-2 font-mono text-xs">{k}</td>
                                            <td className="p-2 font-mono text-xs text-text-secondary break-all">{texto(antes[k]) || '—'}</td>
                                            <td className={`p-2 font-mono text-xs break-all ${cambio ? 'text-brand-light' : ''}`}>
                                                {texto(despues[k]) || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="mt-4 text-xs text-text-secondary">
                    Las claves y tokens nunca se guardan: aparecen como [REDACTED].
                </p>
            </div>
        </div>
    );
}

function Dato({ titulo, valor, mono = false }) {
    return (
        <div className="rounded-lg border border-gray-800 bg-bg-card/40 p-3">
            <p className="text-xs uppercase tracking-wide text-text-secondary">{titulo}</p>
            <p className={`mt-1 break-all text-sm ${mono ? 'font-mono' : ''}`}>{valor}</p>
        </div>
    );
}

function Campo({ etiqueta, children }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{etiqueta}</span>
            {children}
        </label>
    );
}

function Marco({ children }) {
    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-6xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <ScrollText className="h-8 w-8 text-brand-blue" />
                        Registro de acciones
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        Las acciones sensibles de la plataforma, con su autor, el recurso afectado y la hora del servidor.
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
