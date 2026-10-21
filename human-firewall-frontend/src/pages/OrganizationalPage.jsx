import React, { useCallback, useEffect, useState } from 'react';
import {
    Building2, ArrowLeft, TrendingUp, TrendingDown, Minus, AlertTriangle,
    Clock, Filter, RefreshCw
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

/**
 * Resultados organizacionales para gerencia.
 *
 * Los tres mockups de la HU:
 *   - tarjetas de KPIs con la variacion contra el periodo anterior,
 *   - selector de comparacion de periodos y filtro por area,
 *   - grafico de tendencia de engagement.
 *
 * La pantalla no calcula NADA: ni los KPIs, ni la variacion, ni el color de la
 * flecha. Todo llega resuelto desde /reports/organizational, que a su vez lee
 * snapshots precalculados. Si el backend dice "pendiente_de_calculo", eso es
 * lo que se muestra: un cero inventado seria peor que decir la verdad.
 */
export default function OrganizationalPage() {
    const { t } = useIdioma();
    const usuario = getUsuarioActual();
    const autorizado = usuario && (usuario.role === 'manager' || usuario.role === 'admin');

    const [periodo, setPeriodo] = useState(mesActual());
    const [comparadoCon, setComparadoCon] = useState(mesAnterior(mesActual()));
    const [areaId, setAreaId] = useState('');

    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);

    const consultar = useCallback(async (filtros = {}) => {
        if (!autorizado) return;
        setCargando(true);
        setError(null);

        const p = new URLSearchParams();
        const consulta = { period: periodo, compare_to: comparadoCon, area_id: areaId, ...filtros };
        for (const [k, v] of Object.entries(consulta)) {
            if (v !== '' && v != null) p.append(k, v);
        }

        try {
            const { data } = await api.get(`/api/gamification/reports/organizational?${p}`);
            setDatos(data);
        } catch (e) {
            // El 404 de un area inexistente trae el area_id: se muestra tal
            // cual, que es mas util que "no se pudo cargar".
            setError(e.response?.data?.msg || t('organizacional.error_cargar'));
            setDatos(null);
        } finally {
            setCargando(false);
        }
    }, [autorizado, periodo, comparadoCon, areaId, t]);

    // Sin sesion no hay nada que pedir: se vuelve al login.
    useEffect(() => {
        if (!usuario) window.location.href = '/login';
    }, [usuario]);

    // Carga inicial. Los cambios de periodo o area se aplican con el boton y
    // no al teclear: cada consulta lee snapshots de dos periodos y no tiene
    // sentido dispararla por cada digito de un campo de mes.
    //
    // Las dos reglas desactivadas son las mismas que en ReportsPage: la
    // dependencia real es `autorizado` (agregar `consultar` repetiria el
    // efecto en cada cambio de filtro), y el setState de una carga inicial de
    // datos es el caso que la propia documentacion de React acepta.
    /* eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
    useEffect(() => { consultar(); }, [autorizado]);

    /** Vuelve al consolidado general (criterio de aceptacion 3). */
    const verConsolidado = () => {
        setAreaId('');
        consultar({ area_id: '' });
    };

    if (!autorizado) {
        return (
            <Marco>
                <Card className="border-l-4 border-l-red-500 p-8 text-center">
                    <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-red-500" />
                    <p className="font-bold">{t('organizacional.sin_permiso_titulo')}</p>
                    <p className="mt-1 text-sm text-text-secondary">
                        {t('organizacional.sin_permiso_detalle')}
                    </p>
                </Card>
            </Marco>
        );
    }

    const areas = datos?.areas_disponibles || [];

    return (
        <Marco>
            {/* --- Mockup 2: selector de periodos y filtro por area --- */}
            <Card className="mb-6 p-6">
                <div className="mb-4 flex items-center gap-2">
                    <Filter className="h-5 w-5 text-brand-blue" />
                    <h2 className="font-bold">{t('organizacional.filtros_titulo')}</h2>
                </div>

                <div className="grid grid-ajustable [--ancho-columna:12rem] gap-4">
                    <Campo etiqueta={t('organizacional.periodo')}>
                        <input type="month" value={periodo}
                               onChange={e => setPeriodo(e.target.value)}
                               className={entradaClase} />
                    </Campo>
                    <Campo etiqueta={t('organizacional.comparar')}>
                        <input type="month" value={comparadoCon}
                               onChange={e => setComparadoCon(e.target.value)}
                               className={entradaClase} />
                    </Campo>
                    <Campo etiqueta={t('organizacional.area')}>
                        <select value={areaId}
                                onChange={e => setAreaId(e.target.value)}
                                className={entradaClase}>
                            <option value="">{t('organizacional.toda_organizacion')}</option>
                            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </Campo>
                    <div className="flex items-end gap-2">
                        <Button onClick={() => consultar()} disabled={cargando} className="px-4 py-2 text-sm">
                            {cargando ? t('organizacional.consultando') : t('organizacional.aplicar')}
                        </Button>
                        {/* Criterio de aceptacion 3: "debo poder volver a la
                            vista consolidada general facilmente". */}
                        {areaId && (
                            <Button variant="outline" onClick={verConsolidado}
                                    className="border-gray-700 px-4 py-2 text-sm">
                                {t('organizacional.ver_consolidado')}
                            </Button>
                        )}
                    </div>
                </div>

                {datos && (
                    <p className="mt-4 flex items-center gap-2 text-xs text-text-secondary">
                        <Clock className="h-3.5 w-3.5" />
                        {datos.area
                            ? <>{t('organizacional.segmentado_por')} <strong className="text-brand-light">{datos.area.name}</strong>.</>
                            : <>{t('organizacional.consolidado_general')}</>}
                        {datos.calculado_en
                            ? <> {t('organizacional.ultimo_calculo')} {new Date(datos.calculado_en).toLocaleString('es')}.</>
                            : null}
                    </p>
                )}
            </Card>

            {error && (
                <Card className="border-l-4 border-l-red-500 p-6">
                    <p className="text-red-400">{error}</p>
                </Card>
            )}

            {/* Criterio tecnico 2: estado explicito, no un error ni ceros. */}
            {datos?.estado === 'pendiente_de_calculo' && (
                <Card className="border-l-4 border-l-yellow-500 p-8 text-center">
                    <RefreshCw className="mx-auto mb-4 h-10 w-10 text-yellow-500" />
                    <p className="font-bold">{t('organizacional.pendiente_titulo')}</p>
                    <p className="mt-1 text-sm text-text-secondary">{datos.mensaje}</p>
                </Card>
            )}

            {datos?.estado === 'listo' && (
                <>
                    {/* --- Mockup 1: tarjetas de KPIs con variacion --- */}
                    <div className="mb-6 grid grid-ajustable [--ancho-columna:12rem] gap-4">
                        {datos.kpis.map(k => <TarjetaKpi key={k.kpi_type} kpi={k} comparado={datos.compare_to} />)}
                    </div>

                    {/* --- Mockup 3: tendencia --- */}
                    <Card className="p-6">
                        <h2 className="mb-1 flex items-center gap-2 font-bold">
                            <TrendingUp className="h-5 w-5 text-brand-blue" />
                            {t('organizacional.tendencia_titulo')}
                        </h2>
                        <p className="mb-6 text-sm text-text-secondary">
                            {t('organizacional.tendencia_subtitulo')}
                        </p>
                        <GraficoTendencia serie={datos.tendencia} />
                    </Card>
                </>
            )}
        </Marco>
    );
}

/**
 * Tarjeta de un KPI.
 *
 * La variacion puede no existir (no hay snapshot del periodo base, o el base
 * era 0). En ese caso NO se pinta un 0% ni una flecha: se dice "sin datos
 * comparables", que es lo que el backend devuelve y lo unico honesto.
 */
function TarjetaKpi({ kpi, comparado }) {
    const { t } = useIdioma();

    const sinComparacion = kpi.variacion == null;
    const sube = kpi.tendencia === 'positiva';
    const baja = kpi.tendencia === 'negativa';

    const color = sinComparacion ? 'text-text-secondary' : (sube ? 'text-green-400' : (baja ? 'text-red-400' : 'text-text-secondary'));
    const Icono = sinComparacion ? Minus : (sube ? TrendingUp : (baja ? TrendingDown : Minus));

    return (
        <Card className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                {kpi.etiqueta}
            </p>

            <p className="mt-2 text-3xl font-bold text-brand-light">
                {kpi.valor == null ? '—' : kpi.valor}
                <span className="ml-1 text-base font-normal text-text-secondary">
                    {kpi.unidad === '%' ? '%' : ''}
                </span>
            </p>

            <div className={`mt-2 flex items-center gap-1 text-sm ${color}`}>
                <Icono className="h-4 w-4" />
                {sinComparacion
                    ? <span>{t('organizacional.sin_comparacion')}</span>
                    : <span>
                        {kpi.variacion_porcentaje > 0 ? '+' : ''}
                        {t('organizacional.variacion', { pct: kpi.variacion_porcentaje, comparado })}
                    </span>}
            </div>

            <p className="mt-3 text-xs text-text-secondary">{kpi.descripcion}</p>

            {kpi.detalle && (
                <p className="mt-2 font-mono text-2xs text-text-secondary">
                    {Object.entries(kpi.detalle).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </p>
            )}
        </Card>
    );
}

/**
 * Grafico de barras en SVG, sin librerias.
 *
 * Agregar una dependencia de graficos para cuatro barras seria mas peso de
 * descarga que el resto de la pantalla junta. Si en algun momento hacen falta
 * ejes, tooltips y zoom, ahi si conviene una libreria.
 */
function GraficoTendencia({ serie = [] }) {
    const { t } = useIdioma();

    if (serie.length === 0) {
        return (
            <p className="py-8 text-center text-sm text-text-secondary">
                {t('organizacional.tendencia_vacia')}
            </p>
        );
    }

    const maximo = Math.max(...serie.map(p => p.valor), 1);

    // Alto util del area de barras, en pixeles.
    //
    // En pixeles y no en porcentaje: una altura porcentual se calcula contra la
    // altura del contenedor, y la de un item flex en columna no esta definida
    // hasta que el navegador termina de repartir el espacio. El resultado era
    // que las barras se dibujaban con altura 0 y el grafico salia vacio, con
    // los numeros y los meses pero sin nada en el medio. Con pixeles no hay
    // contra que resolver: la altura es la que se pide.
    const ALTO_MAXIMO = 170;

    return (
        <div className="flex items-end gap-3">
            {serie.map(punto => {
                // Minimo 4px: una barra de valor 0 tiene que verse al ras y no
                // desaparecer del grafico.
                const alto = Math.max(4, Math.round((punto.valor / maximo) * ALTO_MAXIMO));
                return (
                    <div key={punto.period} className="flex flex-1 flex-col items-center gap-2">
                        <span className="text-xs font-semibold text-brand-light">{punto.valor}</span>
                        <div className="w-full rounded-t bg-brand-blue/70 transition-all"
                             style={{ height: `${alto}px` }}
                             title={`${punto.period}: ${punto.valor}`} />
                        <span className="text-2xs text-text-secondary">{punto.period}</span>
                    </div>
                );
            })}
        </div>
    );
}

/** Mes actual en formato YYYY-MM, que es el que espera el backend. */
function mesActual() {
    const hoy = new Date();
    return `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mesAnterior(periodo) {
    const [anio, mes] = periodo.split('-').map(Number);
    const d = new Date(Date.UTC(anio, mes - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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
    const { t } = useIdioma();

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-6xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                    </a>
                    <ThemeToggle />
                </div>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <Building2 className="h-8 w-8 text-brand-blue" />
                        {t('organizacional.titulo')}
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        {t('organizacional.subtitulo')}
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
