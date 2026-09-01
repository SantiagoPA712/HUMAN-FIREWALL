import React, { useCallback, useEffect, useState } from 'react';
import {
    CalendarClock, ArrowLeft, Plus, Play, Pause, Download, AlertTriangle,
    CheckCircle2, XCircle, Users, RefreshCw
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Reportes automaticos periodicos.
 *
 * Los dos mockups de la HU en una sola pantalla:
 *   - Panel "Programacion de reportes": frecuencia, destinatarios, tipo.
 *   - Historico de reportes generados, con estado y enlace de descarga.
 *
 * Quien ve que:
 *   admin                       -> las dos secciones
 *   rh, seguridad, gerencia     -> solo el historico
 *
 * No es una decision de la pantalla: el backend responde 403 en
 * /reports/schedules a quien no sea admin. Aca solo se evita mostrar un panel
 * que no va a poder cargar.
 *
 * Ningun calculo vive en este archivo. La periodicidad, el periodo cubierto y
 * el estado de cada corrida los decide el backend; esto pide y dibuja.
 */
export default function ScheduledReportsPage() {
    const usuario = getUsuarioActual();
    const esAdmin = usuario?.role === 'admin';
    const autorizado = usuario && ['admin', 'rh', 'security', 'manager'].includes(usuario.role);

    const [config, setConfig] = useState(null);
    const [historial, setHistorial] = useState([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);
    const [erroresCampo, setErroresCampo] = useState([]);
    const [aviso, setAviso] = useState(null);
    const [mostrarFormulario, setMostrarFormulario] = useState(false);
    const [descargando, setDescargando] = useState(null);

    const [nueva, setNueva] = useState({
        name: '',
        report_type: 'performance',
        frequency: 'weekly',
        format: 'csv',
        subscriber_roles: ['rh']
    });

    const cargar = useCallback(async () => {
        if (!autorizado) return;
        setCargando(true);
        setError(null);

        try {
            // El historico lo puede ver todo destinatario; la configuracion,
            // solo admin. Se piden por separado para que un 403 en la segunda
            // no deje la pantalla en blanco.
            const historicoPedido = api.get('/api/gamification/reports/history');
            const configPedida = esAdmin
                ? api.get('/api/gamification/reports/schedules')
                : Promise.resolve(null);

            const [respHistorial, respConfig] = await Promise.all([historicoPedido, configPedida]);

            setHistorial(respHistorial.data.resultados || []);
            if (respConfig) setConfig(respConfig.data);

        } catch (e) {
            setError(e.response?.data?.msg || 'No se pudo cargar la informacion de reportes');
        } finally {
            setCargando(false);
        }
    }, [autorizado, esAdmin]);

    // Sin sesion no hay nada que pedir: se vuelve al login.
    useEffect(() => {
        if (!usuario) window.location.href = '/login';
    }, [usuario]);

    // Carga inicial. Mismas dos reglas desactivadas que en ReportsPage: la
    // dependencia real es `autorizado`, y el setState de una carga de datos
    // dentro de un efecto es el caso que React documenta como valido.
    /* eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
    useEffect(() => { cargar(); }, [autorizado]);

    const crear = async () => {
        setErroresCampo([]);
        setAviso(null);

        try {
            await api.post('/api/gamification/reports/schedules', nueva);
            setMostrarFormulario(false);
            setNueva({ name: '', report_type: 'performance', frequency: 'weekly', format: 'csv', subscriber_roles: ['rh'] });
            setAviso({ tipo: 'ok', mensaje: 'Programación creada. El sistema la ejecutará según su frecuencia.' });
            cargar();

        } catch (e) {
            if (e.response?.status === 400 && e.response.data?.errores) {
                setErroresCampo(e.response.data.errores);
            } else {
                setAviso({ tipo: 'error', mensaje: e.response?.data?.msg || 'No se pudo crear la programación' });
            }
        }
    };

    const alternarActiva = async (programacion) => {
        try {
            await api.patch(`/api/gamification/reports/schedules/${programacion.id}`, {
                is_active: !programacion.is_active
            });
            cargar();
        } catch (e) {
            setAviso({ tipo: 'error', mensaje: e.response?.data?.msg || 'No se pudo actualizar la programación' });
        }
    };

    /**
     * Descarga un reporte generado.
     *
     * Boton y no <a href>: una navegacion del navegador no manda la cabecera
     * Authorization, y el endpoint la exige. Mismo problema que ya se corrigio
     * en la pantalla de reportes de RH.
     */
    const descargar = async (fila) => {
        setDescargando(fila.id);
        try {
            const respuesta = await api.get(fila.descarga, { responseType: 'blob' });

            const cabecera = respuesta.headers['content-disposition'] || '';
            const nombre = /filename="?([^"]+)"?/.exec(cabecera)?.[1] || `reporte-${fila.id}`;

            const url = URL.createObjectURL(respuesta.data);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = nombre;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            URL.revokeObjectURL(url);

        } catch {
            setAviso({ tipo: 'error', mensaje: 'No se pudo descargar el archivo' });
        } finally {
            setDescargando(null);
        }
    };

    if (!autorizado) {
        return (
            <Marco>
                <Card className="border-l-4 border-l-red-500 p-8 text-center">
                    <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-500" />
                    <p className="font-bold">Esta sección es solo para RH, seguridad, gerencia y administración</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        Tu cuenta no está suscrita a los reportes automáticos.
                    </p>
                </Card>
            </Marco>
        );
    }

    const fecha = (iso) =>
        iso ? new Date(iso).toLocaleString('es', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '—';

    return (
        <Marco>
            {aviso && (
                <div className={`mb-6 rounded-lg border p-3 text-sm ${
                    aviso.tipo === 'error'
                        ? 'border-red-500/50 bg-red-500/10 text-red-400'
                        : 'border-brand-blue/40 bg-brand-blue/10 text-brand-light'
                }`}>
                    {aviso.mensaje}
                </div>
            )}

            {error && (
                <Card className="mb-6 border-l-4 border-l-red-500 p-6">
                    <p className="text-red-400">{error}</p>
                </Card>
            )}

            {/* --- Mockup 1: panel de configuracion --- */}
            {esAdmin && (
                <Card className="mb-6 p-6">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="flex items-center gap-2 font-bold">
                            <CalendarClock className="h-5 w-5 text-brand-blue" />
                            Programación de reportes
                        </h2>
                        <Button onClick={() => setMostrarFormulario(v => !v)} className="px-4 py-2 text-sm">
                            <Plus className="h-4 w-4" />
                            {mostrarFormulario ? 'Cancelar' : 'Nueva programación'}
                        </Button>
                    </div>

                    {mostrarFormulario && (
                        <div className="mb-6 rounded-xl border border-gray-700 p-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <Campo etiqueta="Nombre">
                                    <input value={nueva.name}
                                           onChange={e => setNueva({ ...nueva, name: e.target.value })}
                                           placeholder="Desempeño semanal para RH"
                                           className={entradaClase} />
                                </Campo>
                                <Campo etiqueta="Tipo de reporte">
                                    <select value={nueva.report_type}
                                            onChange={e => setNueva({ ...nueva, report_type: e.target.value })}
                                            className={entradaClase}>
                                        <option value="performance">Desempeño por usuario</option>
                                        <option value="organizational">Consolidado organizacional</option>
                                    </select>
                                </Campo>
                                <Campo etiqueta="Frecuencia">
                                    <select value={nueva.frequency}
                                            onChange={e => setNueva({ ...nueva, frequency: e.target.value })}
                                            className={entradaClase}>
                                        <option value="daily">Diaria</option>
                                        <option value="weekly">Semanal</option>
                                        <option value="monthly">Mensual</option>
                                    </select>
                                </Campo>
                                <Campo etiqueta="Formato">
                                    <select value={nueva.format}
                                            onChange={e => setNueva({ ...nueva, format: e.target.value })}
                                            className={entradaClase}>
                                        <option value="csv">CSV</option>
                                        {/* El consolidado organizacional solo existe en CSV; el
                                            backend lo rechaza y aca directamente no se ofrece. */}
                                        {nueva.report_type === 'performance' && <option value="pdf">PDF</option>}
                                    </select>
                                </Campo>
                            </div>

                            <div className="mt-4">
                                <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                    Destinatarios (roles suscritos)
                                </span>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {(config?.roles || ['rh', 'security', 'manager', 'admin']).map(rol => {
                                        const elegido = nueva.subscriber_roles.includes(rol);
                                        return (
                                            <button key={rol}
                                                    onClick={() => setNueva({
                                                        ...nueva,
                                                        subscriber_roles: elegido
                                                            ? nueva.subscriber_roles.filter(r => r !== rol)
                                                            : [...nueva.subscriber_roles, rol]
                                                    })}
                                                    className={`rounded-full border px-3 py-1 text-xs ${
                                                        elegido
                                                            ? 'border-brand-blue bg-brand-blue/20 text-brand-light'
                                                            : 'border-gray-700 text-text-secondary'
                                                    }`}>
                                                {rol}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="mt-2 text-xs text-text-secondary">
                                    Se guardan roles, no personas: quien entre después a ese rol recibe el reporte sin
                                    tener que agregarlo a mano.
                                </p>
                            </div>

                            {erroresCampo.length > 0 && (
                                <div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-3">
                                    {erroresCampo.map((er, i) => (
                                        <p key={i} className="text-sm text-red-400">
                                            <strong>{er.campo}:</strong> {er.detalle}
                                        </p>
                                    ))}
                                </div>
                            )}

                            <div className="mt-4">
                                <Button onClick={crear} className="px-4 py-2 text-sm">Guardar programación</Button>
                            </div>
                        </div>
                    )}

                    {!config ? (
                        <p className="text-sm text-text-secondary">Cargando programaciones…</p>
                    ) : config.programaciones.length === 0 ? (
                        <p className="py-6 text-center text-sm text-text-secondary">
                            No hay reportes programados todavía.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700 text-text-secondary">
                                        <th className="p-3 font-medium">Reporte</th>
                                        <th className="p-3 font-medium">Frecuencia</th>
                                        <th className="p-3 font-medium">Destinatarios</th>
                                        <th className="p-3 font-medium">Próxima ejecución</th>
                                        <th className="p-3 font-medium text-right">Generados</th>
                                        <th className="p-3 font-medium text-right">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {config.programaciones.map(p => (
                                        <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                                            <td className="p-3">
                                                <p className="font-medium">{p.name}</p>
                                                <p className="text-xs text-text-secondary">
                                                    {p.report_type} · {p.format.toUpperCase()}
                                                </p>
                                            </td>
                                            <td className="p-3 text-text-secondary">{FRECUENCIAS[p.frequency] || p.frequency}</td>
                                            <td className="p-3">
                                                <span className="inline-flex items-center gap-1 text-text-secondary">
                                                    <Users className="h-3.5 w-3.5" />
                                                    {(p.subscriber_roles || []).join(', ')}
                                                </span>
                                            </td>
                                            <td className="p-3 text-text-secondary">{fecha(p.next_run_at)}</td>
                                            <td className="p-3 text-right">{p.generados}</td>
                                            <td className="p-3 text-right">
                                                <button onClick={() => alternarActiva(p)}
                                                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                                                            p.is_active
                                                                ? 'border-green-500/40 text-green-400'
                                                                : 'border-gray-700 text-text-secondary'
                                                        }`}>
                                                    {p.is_active
                                                        ? <><Play className="h-3 w-3" /> Activa</>
                                                        : <><Pause className="h-3 w-3" /> Pausada</>}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            )}

            {/* --- Mockup 2: historico --- */}
            <Card className="p-6">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-bold">Reportes generados</h2>
                    <button onClick={cargar} disabled={cargando}
                            className="flex items-center gap-2 text-sm text-text-secondary hover:text-white disabled:opacity-50">
                        <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
                        Actualizar
                    </button>
                </div>

                {historial.length === 0 ? (
                    <div className="py-12 text-center">
                        <CalendarClock className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                        <p className="font-semibold">Todavía no se generó ningún reporte automático</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            Aparecerán acá en cuanto se cumpla la frecuencia de alguna programación.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-700 text-text-secondary">
                                    <th className="p-3 font-medium">Reporte</th>
                                    <th className="p-3 font-medium">Periodo</th>
                                    <th className="p-3 font-medium">Generado</th>
                                    <th className="p-3 font-medium">Estado</th>
                                    <th className="p-3 font-medium text-right">Archivo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {historial.map(h => (
                                    <tr key={h.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                                        <td className="p-3">
                                            <p className="font-medium">{h.schedule_name || h.type}</p>
                                            <p className="text-xs text-text-secondary">{h.type}</p>
                                        </td>
                                        <td className="p-3 font-mono text-text-secondary">{h.period}</td>
                                        <td className="p-3 text-text-secondary">{fecha(h.generated_at)}</td>
                                        <td className="p-3">
                                            {h.status === 'success' ? (
                                                <span className="inline-flex items-center gap-1 rounded bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Éxito
                                                </span>
                                            ) : (
                                                <div>
                                                    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                                                        <XCircle className="h-3.5 w-3.5" /> Error
                                                    </span>
                                                    {/* Mensaje genérico para todos; el detalle técnico
                                                        solo llega en la respuesta si sos admin. */}
                                                    <p className="mt-1 text-xs text-text-secondary">{h.mensaje}</p>
                                                    {h.detalle_tecnico && (
                                                        <p className="mt-1 font-mono text-[11px] text-red-300/80">
                                                            {h.detalle_tecnico} · log {h.referencia_log}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">
                                            {h.descarga ? (
                                                <button onClick={() => descargar(h)}
                                                        disabled={descargando === h.id}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800 disabled:opacity-40">
                                                    <Download className="h-3.5 w-3.5" />
                                                    {descargando === h.id ? 'Descargando…' : 'Descargar'}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-text-secondary">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </Marco>
    );
}

const FRECUENCIAS = { daily: 'Diaria', weekly: 'Semanal', monthly: 'Mensual' };

const entradaClase =
    'w-full rounded-lg border border-gray-700 bg-bg-deep/60 px-3 py-2 text-sm text-text-primary ' +
    'focus:border-brand-blue focus:outline-none';

function Campo({ etiqueta, children }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {etiqueta}
            </span>
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
                        <CalendarClock className="h-8 w-8 text-brand-blue" />
                        Reportes automáticos
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        Programación periódica y histórico de generaciones.
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
