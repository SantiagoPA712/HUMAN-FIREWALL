import React, { useCallback, useEffect, useState } from 'react';
import {
    ShieldAlert, ArrowLeft, AlertTriangle, Clock, User, FileText,
    CheckCircle, XCircle, Activity, ChevronRight
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

/**
 * Panel del area de seguridad.
 *
 * Los tres mockups de la HU: lista de anomalias con severidad y estado, vista
 * de detalle con la linea de tiempo del usuario involucrado, y log de
 * auditoria con filtros.
 *
 * Todo el analisis vive en el backend. Esta pantalla no decide que es anomalo
 * ni recalcula umbrales: pide y dibuja. Si manana cambian las reglas en
 * anomaly_rules, este archivo no se toca.
 */
export default function SecurityPanel() {
    const { t } = useIdioma();
    const usuario = getUsuarioActual();
    const autorizado = usuario && (usuario.role === 'security' || usuario.role === 'admin');

    const [vista, setVista] = useState('anomalias');   // anomalias | auditoria
    const [datos, setDatos] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [auditoria, setAuditoria] = useState(null);
    const [filtroEstado, setFiltroEstado] = useState('');
    const [error, setError] = useState(null);
    const [guardando, setGuardando] = useState(false);

    const cargarAnomalias = useCallback(async () => {
        try {
            const p = new URLSearchParams();
            if (filtroEstado) p.append('status', filtroEstado);
            const { data } = await api.get(`/api/gamification/security/anomalies?${p}`);
            setDatos(data);
            setError(null);
        } catch (e) {
            setError(e.response?.data?.msg || t('seguridad.error_anomalias'));
        }
    }, [filtroEstado, t]);

    const cargarAuditoria = useCallback(async () => {
        try {
            const { data } = await api.get('/api/gamification/security/audit');
            setAuditoria(data);
        } catch (e) {
            setError(e.response?.data?.msg || t('seguridad.error_auditoria'));
        }
    }, [t]);

    // Carga inicial y al cambiar de pestaña.
    //
    // La regla set-state-in-effect apunta a los setState en cascada durante el
    // render; aca es una carga de datos, el caso que la propia documentacion de
    // React acepta para un efecto. Mismo patron que ReportsPage y PuntosContext.
    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        if (!autorizado) return;
        /* eslint-disable-next-line react-hooks/set-state-in-effect */
        if (vista === 'anomalias') cargarAnomalias(); else cargarAuditoria();
    }, [autorizado, vista, cargarAnomalias, cargarAuditoria]);   // eslint-disable-line react-hooks/exhaustive-deps

    const abrirDetalle = async (id) => {
        try {
            const { data } = await api.get(`/api/gamification/security/anomalies/${id}`);
            setDetalle(data);
        } catch (e) {
            setError(e.response?.data?.msg || t('seguridad.error_abrir_alerta'));
        }
    };

    /** Cambia el estado y recarga: el historial lo lleva el backend. */
    const cambiarEstado = async (id, status) => {
        setGuardando(true);
        try {
            const nota = window.prompt(t('seguridad.prompt_nota')) || null;
            await api.patch(`/api/gamification/security/anomalies/${id}/status`, { status, note: nota });
            await cargarAnomalias();
            if (detalle?.id === id) await abrirDetalle(id);
        } catch (e) {
            setError(e.response?.data?.errores?.[0]?.detalle || e.response?.data?.msg || t('seguridad.error_cambiar_estado'));
        } finally {
            setGuardando(false);
        }
    };

    if (!autorizado) {
        return (
            <Marco>
                <Card className="border-l-4 border-l-red-500 p-8 text-center">
                    <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-500" />
                    <p className="font-bold">{t('seguridad.sin_permiso_titulo')}</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        {t('seguridad.sin_permiso_detalle')}
                    </p>
                </Card>
            </Marco>
        );
    }

    return (
        <Marco>
            <div className="mb-6 flex gap-2">
                <Pestana activa={vista === 'anomalias'} onClick={() => { setVista('anomalias'); setDetalle(null); }}>
                    {t('seguridad.tab_anomalias')}
                </Pestana>
                <Pestana activa={vista === 'auditoria'} onClick={() => { setVista('auditoria'); setDetalle(null); }}>
                    {t('seguridad.tab_auditoria')}
                </Pestana>
            </div>

            {error && (
                <Card className="mb-6 border-l-4 border-l-red-500 p-4">
                    <p className="text-sm text-red-400">{error}</p>
                </Card>
            )}

            {vista === 'anomalias' && datos && (
                <>
                    <Resumen resumen={datos.resumen} />

                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text-secondary">{t('seguridad.filtro_estado')}</span>
                        {[['', 'seguridad.todas'], ['pending', 'seguridad.pendientes'],
                          ['reviewed', 'seguridad.revisadas'], ['dismissed', 'seguridad.descartadas']]
                            .map(([valor, clave]) => (
                                <button
                                    key={valor || 'todas'}
                                    onClick={() => setFiltroEstado(valor)}
                                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                                        filtroEstado === valor
                                            ? 'bg-brand-blue text-white'
                                            : 'border border-gray-700 text-text-secondary hover:text-white'
                                    }`}
                                >
                                    {t(clave)}
                                </button>
                            ))}
                    </div>

                    {datos.resultados.length === 0 ? (
                        <Card className="p-12 text-center">
                            <CheckCircle className="mx-auto mb-4 h-10 w-10 text-emerald-400" />
                            <p className="font-semibold">{t('seguridad.vacio_titulo')}</p>
                            <p className="mt-1 text-sm text-text-secondary">
                                {t('seguridad.vacio_detalle')}
                            </p>
                        </Card>
                    ) : (
                        <div className="space-y-3">
                            {datos.resultados.map(a => (
                                <Card key={a.id} className={`p-5 border-l-4 ${COLOR_SEVERIDAD[a.severity] || 'border-l-gray-600'}`}>
                                    <div className="flex flex-wrap items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                                <Insignia severity={a.severity} />
                                                <EstadoChip status={a.status} />
                                                <span className="font-mono text-xs text-text-secondary">#{a.id}</span>
                                            </div>
                                            <p className="font-bold">{a.email}</p>
                                            <p className="text-sm text-text-secondary">
                                                <strong className="text-brand-light">{a.total_en_ventana}</strong>{' '}
                                                {t(a.movimientos === 1
                                                    ? 'seguridad.anomalia_resumen_uno'
                                                    : 'seguridad.anomalia_resumen_varios',
                                                   { umbral: a.umbral, movimientos: a.movimientos })}{' '}
                                                <code className="text-xs">{a.rule_triggered}</code>
                                            </p>
                                            <p className="mt-1 text-xs text-text-secondary">
                                                {new Date(a.detected_at).toLocaleString('es')}
                                            </p>
                                        </div>

                                        <div className="flex shrink-0 flex-wrap gap-2">
                                            <Button variant="outline" className="h-8 border-gray-700 text-xs"
                                                    onClick={() => abrirDetalle(a.id)}>
                                                {t('seguridad.ver_detalle')} <ChevronRight className="ml-1 h-3 w-3" />
                                            </Button>
                                            {a.status === 'pending' && (
                                                <>
                                                    <Button variant="outline" disabled={guardando}
                                                            className="h-8 border-emerald-600 text-xs text-emerald-400"
                                                            onClick={() => cambiarEstado(a.id, 'reviewed')}>
                                                        {t('seguridad.marcar_revisada')}
                                                    </Button>
                                                    <Button variant="outline" disabled={guardando}
                                                            className="h-8 border-gray-700 text-xs"
                                                            onClick={() => cambiarEstado(a.id, 'dismissed')}>
                                                        {t('seguridad.descartar')}
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}

            {vista === 'auditoria' && auditoria && <TablaAuditoria datos={auditoria} />}

            {detalle && <ModalDetalle detalle={detalle} onCerrar={() => setDetalle(null)} />}
        </Marco>
    );
}

const COLOR_SEVERIDAD = {
    critical: 'border-l-red-600',
    high: 'border-l-orange-500',
    medium: 'border-l-yellow-500',
    low: 'border-l-gray-500'
};

// Claves del diccionario, no textos: asi la insignia cambia de idioma sola.
const ETIQUETA_SEVERIDAD = {
    critical: 'seguridad.severidad_critical',
    high: 'seguridad.severidad_high',
    medium: 'seguridad.severidad_medium',
    low: 'seguridad.severidad_low'
};

function Insignia({ severity }) {
    const { t } = useIdioma();

    const clases = {
        critical: 'bg-red-500/20 text-red-400',
        high: 'bg-orange-500/20 text-orange-400',
        medium: 'bg-yellow-500/20 text-yellow-400',
        low: 'bg-gray-700 text-text-secondary'
    };
    return (
        <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${clases[severity] || clases.low}`}>
            {ETIQUETA_SEVERIDAD[severity] ? t(ETIQUETA_SEVERIDAD[severity]) : severity}
        </span>
    );
}

function EstadoChip({ status }) {
    const { t } = useIdioma();

    const mapa = {
        pending:   ['seguridad.estado_pending', 'bg-brand-blue/20 text-brand-light'],
        reviewed:  ['seguridad.estado_reviewed', 'bg-emerald-500/20 text-emerald-400'],
        dismissed: ['seguridad.estado_dismissed', 'bg-gray-700 text-text-secondary']
    };
    const [clave, clase] = mapa[status] || [null, 'bg-gray-700'];
    const texto = clave ? t(clave) : status;
    return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${clase}`}>{texto}</span>;
}

function Resumen({ resumen }) {
    const { t } = useIdioma();

    const items = [
        { clave: 'seguridad.total', valor: resumen.total, color: 'text-text-primary' },
        { clave: 'seguridad.pendientes', valor: resumen.pendientes, color: 'text-brand-light' },
        { clave: 'seguridad.revisadas', valor: resumen.revisadas, color: 'text-emerald-400' },
        { clave: 'seguridad.descartadas', valor: resumen.descartadas, color: 'text-text-secondary' }
    ];
    return (
        <div className="mb-6 grid grid-ajustable [--ancho-columna:10rem] gap-4">
            {items.map(i => (
                <Card key={i.clave} className="p-5">
                    <p className="text-sm text-text-secondary">{t(i.clave)}</p>
                    <p className={`text-3xl font-black ${i.color}`}>{i.valor}</p>
                </Card>
            ))}
        </div>
    );
}

/**
 * Detalle de una alerta (mockup 2).
 *
 * Los ajustes manuales van ARRIBA de la linea de tiempo a proposito: si
 * alguien acumulo puntos porque un administrador se los otorgo a mano, esa es
 * la explicacion de la alerta y tiene que verse primero, no despues de
 * cincuenta movimientos.
 */
function ModalDetalle({ detalle, onCerrar }) {
    const { t } = useIdioma();
    const fecha = (iso) => new Date(iso).toLocaleString('es');

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm"
             role="dialog" aria-modal="true" onClick={onCerrar}>
            <div className="my-8 w-full max-w-3xl rounded-2xl border border-gray-800 bg-bg-deep p-8"
                 onClick={(e) => e.stopPropagation()}>

                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <Insignia severity={detalle.severity} />
                            <EstadoChip status={detalle.status} />
                            <span className="font-mono text-xs text-text-secondary">#{detalle.id}</span>
                        </div>
                        <h2 className="text-2xl font-bold">{detalle.email}</h2>
                        <p className="text-sm text-text-secondary">
                            {t('seguridad.regla_etiqueta')} <code>{detalle.rule_triggered}</code> · {fecha(detalle.detected_at)}
                        </p>
                    </div>
                    <button onClick={onCerrar} className="text-text-secondary hover:text-white">✕</button>
                </div>

                {detalle.regla_descripcion && (
                    <Card className="mb-6 p-4">
                        <p className="text-sm text-text-secondary">{detalle.regla_descripcion}</p>
                    </Card>
                )}

                <Seccion icono={<AlertTriangle className="h-4 w-4 text-yellow-500" />} titulo={t('seguridad.evidencia')}>
                    <p className="mb-3 text-sm text-text-secondary">
                        <strong className="text-brand-light">{detalle.evidence.total_en_ventana}</strong>{' '}
                        {t('seguridad.evidencia_resumen', {
                            minutos: detalle.evidence.ventana_minutos,
                            umbral: detalle.evidence.umbral
                        })}
                    </p>
                    <div className="space-y-1">
                        {detalle.evidence.movimientos.map(m => (
                            <div key={m.ledger_id} className="flex items-center justify-between rounded bg-bg-card/60 px-3 py-2 text-sm">
                                <span>
                                    <code className="text-xs text-text-secondary">#{m.ledger_id}</code>{' '}
                                    <strong>{m.origen}</strong>
                                    {m.referencia && <span className="text-text-secondary"> · {m.referencia}</span>}
                                </span>
                                <span className="font-mono font-bold text-brand-light">+{m.puntos}</span>
                            </div>
                        ))}
                    </div>
                </Seccion>

                {detalle.ajustes_manuales.length > 0 && (
                    <Seccion icono={<User className="h-4 w-4 text-orange-400" />} titulo={t('seguridad.ajustes_sobre_usuario')}>
                        <div className="space-y-2">
                            {detalle.ajustes_manuales.map((a, i) => (
                                <div key={i} className="rounded border border-orange-500/30 bg-orange-500/5 p-3 text-sm">
                                    <p className="font-semibold">
                                        {a.change_type} · {t('seguridad.por')} {a.actor_email}
                                        <span className="ml-2 text-xs font-normal text-text-secondary">{fecha(a.created_at)}</span>
                                    </p>
                                    <p className="mt-1 text-text-secondary">{t('seguridad.motivo_etiqueta')} {a.reason}</p>
                                </div>
                            ))}
                        </div>
                    </Seccion>
                )}

                <Seccion icono={<Activity className="h-4 w-4 text-brand-blue" />} titulo={t('seguridad.linea_de_tiempo')}>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {detalle.linea_de_tiempo.map(m => (
                            <div key={m.id} className="flex items-center justify-between border-b border-gray-800 py-1.5 text-sm">
                                <span className="text-text-secondary">
                                    {fecha(m.created_at)} · <strong className="text-text-primary">{m.source_type}</strong>
                                    {m.source_id && ` (${m.source_id})`}
                                </span>
                                <span className="font-mono">{m.points > 0 ? '+' : ''}{m.points}</span>
                            </div>
                        ))}
                    </div>
                </Seccion>

                {detalle.historial_estados.length > 0 && (
                    <Seccion icono={<Clock className="h-4 w-4 text-text-secondary" />} titulo={t('seguridad.historial_estados')}>
                        <div className="space-y-2">
                            {detalle.historial_estados.map((h, i) => (
                                <div key={i} className="text-sm">
                                    <p>
                                        <EstadoChip status={h.previous_status} /> → <EstadoChip status={h.new_status} />
                                        <span className="ml-2 text-xs text-text-secondary">
                                            {t('seguridad.por')} {h.changed_by_email} · {fecha(h.changed_at)}
                                        </span>
                                    </p>
                                    {h.note && <p className="mt-1 text-text-secondary">{h.note}</p>}
                                </div>
                            ))}
                        </div>
                    </Seccion>
                )}
            </div>
        </div>
    );
}

function Seccion({ icono, titulo, children }) {
    return (
        <div className="mb-6">
            <h3 className="mb-3 flex items-center gap-2 font-bold">{icono}{titulo}</h3>
            {children}
        </div>
    );
}

/** Mockup 3: log de auditoria con filtros por actor y tipo de cambio. */
function TablaAuditoria({ datos }) {
    const { t } = useIdioma();

    if (datos.resultados.length === 0) {
        return (
            <Card className="p-12 text-center">
                <FileText className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                <p className="font-semibold">{t('seguridad.auditoria_vacia_titulo')}</p>
                <p className="mt-1 text-sm text-text-secondary">
                    {t('seguridad.auditoria_vacia_detalle')}
                </p>
            </Card>
        );
    }

    return (
        <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold">{t('seguridad.ajustes_manuales')}</h2>
                <span className="text-sm text-text-secondary">{t('seguridad.registros', { total: datos.paginacion.total })}</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[45rem] text-left text-sm">
                    <thead>
                        <tr className="border-b border-gray-700 text-text-secondary">
                            <th className="p-3 font-medium">{t('seguridad.col_cuando')}</th>
                            <th className="p-3 font-medium">{t('seguridad.col_quien')}</th>
                            <th className="p-3 font-medium">{t('seguridad.col_sobre')}</th>
                            <th className="p-3 font-medium">{t('seguridad.col_tipo')}</th>
                            <th className="p-3 font-medium">{t('seguridad.col_cambio')}</th>
                            <th className="p-3 font-medium">{t('seguridad.col_motivo')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {datos.resultados.map(l => (
                            <tr key={l.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                                <td className="p-3 text-text-secondary">{new Date(l.created_at).toLocaleString('es')}</td>
                                <td className="p-3">{l.actor_email}</td>
                                <td className="p-3 text-text-secondary">{l.target_email || '—'}</td>
                                <td className="p-3">
                                    <span className="rounded bg-brand-blue/15 px-2 py-0.5 text-xs font-semibold text-brand-light">
                                        {l.change_type}
                                    </span>
                                </td>
                                <td className="p-3 font-mono text-xs text-text-secondary">
                                    {l.previous_value?.puntos != null && l.new_value?.puntos != null
                                        ? t('seguridad.cambio_pts', { antes: l.previous_value.puntos, despues: l.new_value.puntos })
                                        : l.new_value?.reward_name || '—'}
                                </td>
                                <td className="p-3">{l.reason}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

function Pestana({ activa, onClick, children }) {
    return (
        <button onClick={onClick}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    activa ? 'bg-brand-blue text-white' : 'border border-gray-700 text-text-secondary hover:text-white'
                }`}>
            {children}
        </button>
    );
}

function Marco({ children }) {
    const { t } = useIdioma();

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-5xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                    </a>
                    <ThemeToggle />
                </div>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <ShieldAlert className="h-8 w-8 text-brand-blue" />
                        {t('seguridad.titulo')}
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        {t('seguridad.subtitulo')}
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
