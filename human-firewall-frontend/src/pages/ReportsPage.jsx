import React, { useCallback, useEffect, useState } from 'react';
import {
    ShieldCheck, ArrowLeft, Filter, Download, Users, Trophy,
    AlertTriangle, ChevronLeft, ChevronRight, FileText, FileSpreadsheet
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Reportes de desempeno para RH.
 *
 * Los tres bloques del mockup: panel de filtros arriba, tabla de desempeno por
 * usuario, y boton de exportacion con selector de formato.
 *
 * Todo el calculo vive en el backend. Esta pantalla no suma puntos ni deduce
 * niveles: pide /reports/performance y dibuja lo que llega. Si manana cambian
 * los umbrales de nivel o las reglas de puntuacion, este archivo no se toca.
 */
export default function ReportsPage() {
    const usuario = getUsuarioActual();

    const [filtros, setFiltros] = useState({ from: '', to: '', team_id: '', course_id: '' });
    const [opciones, setOpciones] = useState({ equipos: [], cursos: [] });
    const [datos, setDatos] = useState(null);
    const [page, setPage] = useState(1);

    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);
    const [erroresCampo, setErroresCampo] = useState([]);
    const [exportando, setExportando] = useState(null);
    const [avisoExport, setAvisoExport] = useState(null);

    // Solo RH y admin. El backend igual lo rechaza con 403; esto evita
    // mostrarle a un empleado una pantalla que no va a poder cargar.
    const autorizado = usuario && (usuario.role === 'rh' || usuario.role === 'admin');

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        if (!autorizado) return;

        api.get('/api/gamification/reports/filters')
            .then(({ data }) => setOpciones(data))
            .catch(() => { /* el panel funciona igual sin las listas */ });
    }, [usuario?.id, autorizado]);

    /** Arma el query string con los filtros que tienen valor. */
    const parametros = useCallback((extra = {}) => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries({ ...filtros, ...extra })) {
            if (v !== '' && v != null) p.append(k, v);
        }
        return p;
    }, [filtros]);

    const consultar = useCallback(async (paginaPedida = 1) => {
        if (!autorizado) return;
        setCargando(true);
        setError(null);
        setErroresCampo([]);

        try {
            const { data } = await api.get(
                `/api/gamification/reports/performance?${parametros({ page: paginaPedida })}`
            );
            setDatos(data);
            setPage(paginaPedida);
        } catch (e) {
            // El backend devuelve 400 con el detalle por campo: se muestra tal
            // cual, que es mas util que un "parametros invalidos" generico.
            if (e.response?.status === 400 && e.response.data?.errores) {
                setErroresCampo(e.response.data.errores);
            } else {
                setError(e.response?.data?.msg || 'No se pudo cargar el reporte');
            }
            setDatos(null);
        } finally {
            setCargando(false);
        }
    }, [autorizado, parametros]);

    // Primera carga. Los cambios de filtro se aplican con el boton, no al
    // teclear: una consulta por cada tecla en un campo de fecha seria una
    // consulta pesada por cada digito.
    //
    // Las dos reglas desactivadas, y por que:
    //
    //   exhaustive-deps: la dependencia real es `autorizado`. Agregar
    //   `consultar` haria que el efecto se repita cada vez que cambia un
    //   filtro (porque `consultar` se recrea con ellos), y volveriamos a
    //   consultar en cada tecla, que es justo lo que se quiere evitar.
    //
    //   set-state-in-effect: la regla apunta a los setState en cascada
    //   durante el render. Aca es una carga inicial de datos, el caso que la
    //   propia documentacion de React acepta para un efecto. Mismo patron que
    //   usa PuntosContext.
    /* eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
    useEffect(() => { consultar(1); }, [autorizado]);

    /**
     * Descarga el reporte.
     *
     * Se pide con responseType blob porque la respuesta puede ser un CSV o un
     * PDF binario; si se dejara como texto, el PDF llegaria corrupto.
     *
     * Con volumen alto el backend responde 202 y un export_id en vez del
     * archivo: ahi no hay nada que descargar todavia y se avisa.
     */
    const exportar = async (formato) => {
        setExportando(formato);
        setAvisoExport(null);

        try {
            const respuesta = await api.post(
                `/api/gamification/reports/performance/export?${parametros()}`,
                { format: formato },
                { responseType: 'blob' }
            );

            if (respuesta.status === 202) {
                // Vino JSON dentro de un blob: hay que leerlo para sacar el id.
                const texto = await respuesta.data.text();
                const info = JSON.parse(texto);
                setAvisoExport({
                    tipo: 'encolado',
                    mensaje: `El reporte tiene ${info.registros} registros y se está generando en segundo plano.`,
                    exportId: info.export_id
                });
                return;
            }

            // El nombre lo decide el servidor; el navegador solo lo usa.
            const cabecera = respuesta.headers['content-disposition'] || '';
            const nombre = /filename="?([^"]+)"?/.exec(cabecera)?.[1] || `reporte.${formato}`;

            const url = URL.createObjectURL(respuesta.data);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = nombre;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            URL.revokeObjectURL(url);

            setAvisoExport({ tipo: 'listo', mensaje: `Descargado ${nombre}` });
        } catch (e) {
            setAvisoExport({ tipo: 'error', mensaje: e.response?.data?.msg || 'No se pudo exportar' });
        } finally {
            setExportando(null);
        }
    };

    /** Consulta el estado de una exportacion encolada. */
    const revisarExportacion = async (exportId) => {
        try {
            const { data } = await api.get(`/api/gamification/reports/exports/${exportId}`);
            if (data.listo) {
                setAvisoExport({ tipo: 'descargable', mensaje: `Listo: ${data.registros} registros.`, exportId });
            } else {
                setAvisoExport({ tipo: 'encolado', mensaje: `Todavía se está generando (${data.estado}).`, exportId });
            }
        } catch {
            setAvisoExport({ tipo: 'error', mensaje: 'No se pudo consultar el estado' });
        }
    };

    if (!autorizado) {
        return (
            <Marco>
                <Card className="border-l-4 border-l-red-500 p-8 text-center">
                    <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-500" />
                    <p className="font-bold">Esta sección es solo para Recursos Humanos</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        Tu cuenta no tiene permisos para ver reportes de la organización.
                    </p>
                </Card>
            </Marco>
        );
    }

    const fecha = (iso) =>
        iso ? new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'Sin actividad';

    return (
        <Marco>
            {/* --- Panel de filtros --- */}
            <Card className="mb-6 p-6">
                <div className="mb-4 flex items-center gap-2">
                    <Filter className="h-5 w-5 text-brand-blue" />
                    <h2 className="font-bold">Filtros</h2>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Campo etiqueta="Desde">
                        <input type="date" value={filtros.from}
                               onChange={e => setFiltros({ ...filtros, from: e.target.value })}
                               className={entradaClase} />
                    </Campo>
                    <Campo etiqueta="Hasta">
                        <input type="date" value={filtros.to}
                               onChange={e => setFiltros({ ...filtros, to: e.target.value })}
                               className={entradaClase} />
                    </Campo>
                    <Campo etiqueta="Equipo">
                        <select value={filtros.team_id}
                                onChange={e => setFiltros({ ...filtros, team_id: e.target.value })}
                                className={entradaClase}>
                            <option value="">Todos</option>
                            {opciones.equipos.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </Campo>
                    <Campo etiqueta="Curso">
                        <select value={filtros.course_id}
                                onChange={e => setFiltros({ ...filtros, course_id: e.target.value })}
                                className={entradaClase}>
                            <option value="">Todos</option>
                            {opciones.cursos.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                    </Campo>
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

                <div className="mt-4 flex flex-wrap gap-3">
                    <Button onClick={() => consultar(1)} disabled={cargando}>
                        {cargando ? 'Consultando…' : 'Aplicar filtros'}
                    </Button>
                    <Button variant="outline" className="border-gray-700"
                            onClick={() => { setFiltros({ from: '', to: '', team_id: '', course_id: '' }); setErroresCampo([]); }}>
                        Limpiar
                    </Button>

                    <div className="ml-auto flex gap-2">
                        <Button variant="outline" className="border-gray-700"
                                onClick={() => exportar('csv')} disabled={!!exportando}>
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            {exportando === 'csv' ? 'Generando…' : 'CSV'}
                        </Button>
                        <Button variant="outline" className="border-gray-700"
                                onClick={() => exportar('pdf')} disabled={!!exportando}>
                            <FileText className="mr-2 h-4 w-4" />
                            {exportando === 'pdf' ? 'Generando…' : 'PDF'}
                        </Button>
                    </div>
                </div>

                {avisoExport && (
                    <div className={`mt-4 rounded-lg border p-3 text-sm ${
                        avisoExport.tipo === 'error'
                            ? 'border-red-500/50 bg-red-500/10 text-red-400'
                            : 'border-brand-blue/40 bg-brand-blue/10 text-brand-light'
                    }`}>
                        <div className="flex items-center gap-3">
                            <Download className="h-4 w-4 shrink-0" />
                            <span>{avisoExport.mensaje}</span>
                            {avisoExport.exportId && avisoExport.tipo === 'encolado' && (
                                <button onClick={() => revisarExportacion(avisoExport.exportId)}
                                        className="ml-auto underline">
                                    Revisar estado
                                </button>
                            )}
                            {avisoExport.exportId && avisoExport.tipo === 'descargable' && (
                                <a className="ml-auto underline"
                                   href={`/api/gamification/reports/exports/${avisoExport.exportId}/download`}>
                                    Descargar
                                </a>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            {error && (
                <Card className="border-l-4 border-l-red-500 p-6">
                    <p className="text-red-400">{error}</p>
                </Card>
            )}

            {datos && (
                <>
                    {/* --- Agregados --- */}
                    {!datos.vacio && (
                        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card className="p-6">
                                <h3 className="mb-4 flex items-center gap-2 font-bold">
                                    <Users className="h-5 w-5 text-brand-blue" /> Por equipo
                                </h3>
                                <div className="space-y-2">
                                    {datos.agregados.por_equipo.map(e => (
                                        <div key={e.equipo} className="flex items-center justify-between text-sm">
                                            <span>{e.equipo}</span>
                                            <span className="text-text-secondary">
                                                {e.usuarios} pers. · <strong className="text-brand-light">{e.puntos}</strong> pts
                                                · prom. {e.promedio_puntos ?? 0}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </Card>

                            <Card className="p-6">
                                <h3 className="mb-4 flex items-center gap-2 font-bold">
                                    <Trophy className="h-5 w-5 text-brand-blue" /> Por curso
                                </h3>
                                {datos.agregados.por_curso.length === 0
                                    ? <p className="text-sm text-text-secondary">Sin cursos asignados en este recorte.</p>
                                    : (
                                        <div className="space-y-2">
                                            {datos.agregados.por_curso.map(c => (
                                                <div key={c.course_id} className="flex items-center justify-between text-sm">
                                                    <span className="truncate pr-3">{c.curso}</span>
                                                    <span className="shrink-0 text-text-secondary">
                                                        {c.completados}/{c.usuarios} ·{' '}
                                                        <strong className="text-brand-light">{c.porcentaje_completado}%</strong>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                            </Card>
                        </div>
                    )}

                    {/* --- Tabla --- */}
                    <Card className="p-6">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="font-bold">Desempeño por usuario</h2>
                            <span className="text-sm text-text-secondary">
                                {datos.paginacion.total} {datos.paginacion.total === 1 ? 'registro' : 'registros'}
                            </span>
                        </div>

                        {/* Criterio de aceptacion 2: estado vacio claro, no un error. */}
                        {datos.vacio ? (
                            <div className="py-12 text-center">
                                <Filter className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                                <p className="font-semibold">No hay datos para los filtros aplicados</p>
                                <p className="mt-1 text-sm text-text-secondary">
                                    Probá ampliar el rango de fechas o quitar el filtro de equipo o curso.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[720px] text-left text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-700 text-text-secondary">
                                                <th className="p-3 font-medium">Usuario</th>
                                                <th className="p-3 font-medium">Equipo</th>
                                                <th className="p-3 font-medium text-right">Puntos</th>
                                                <th className="p-3 font-medium">Nivel</th>
                                                <th className="p-3 font-medium text-right">Insignias</th>
                                                <th className="p-3 font-medium">Última actividad</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {datos.resultados.map(r => (
                                                <tr key={r.user_id} className="border-b border-gray-800 hover:bg-gray-800/40">
                                                    <td className="p-3">
                                                        <p className="font-medium">{r.email}</p>
                                                        <p className="text-xs text-text-secondary">{r.rol}</p>
                                                    </td>
                                                    <td className="p-3 text-text-secondary">{r.equipo}</td>
                                                    <td className="p-3 text-right font-mono font-bold text-brand-light">
                                                        {r.puntos}
                                                    </td>
                                                    <td className="p-3">
                                                        {r.nivel != null ? (
                                                            <span className="rounded bg-brand-blue/15 px-2 py-0.5 text-xs font-semibold text-brand-light">
                                                                {r.nivel} · {r.nivel_nombre}
                                                            </span>
                                                        ) : '—'}
                                                    </td>
                                                    <td className="p-3 text-right">{r.insignias}</td>
                                                    <td className="p-3 text-text-secondary">{fecha(r.ultima_actividad)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* --- Paginacion --- */}
                                <div className="mt-4 flex items-center justify-between text-sm">
                                    <span className="text-text-secondary">
                                        Página {datos.paginacion.page} de {datos.paginacion.total_paginas}
                                        {' · '}{datos.paginacion.page_size} por página
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => consultar(page - 1)}
                                            disabled={page <= 1 || cargando}
                                            className="flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 disabled:opacity-40"
                                        >
                                            <ChevronLeft className="h-4 w-4" /> Anterior
                                        </button>
                                        <button
                                            onClick={() => consultar(page + 1)}
                                            disabled={page >= datos.paginacion.total_paginas || cargando}
                                            className="flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 disabled:opacity-40"
                                        >
                                            Siguiente <ChevronRight className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </Card>
                </>
            )}
        </Marco>
    );
}

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
                        <ShieldCheck className="h-8 w-8 text-brand-blue" />
                        Reportes de desempeño
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        Puntos, niveles e insignias por usuario, equipo y curso.
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
