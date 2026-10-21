import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft, Award, Lock, Trophy } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

// Los mapas guardan la CLAVE del texto, no el texto: asi se resuelven con t()
// en cada render y cambian de idioma solos.
//
// `claveUno` es la forma en singular, para los umbrales de 1.
const CONDICION = {
    points_total:      { clave: 'recompensas.condicion_puntos' },
    lessons_completed: { clave: 'recompensas.condicion_lecciones',    claveUno: 'recompensas.condicion_leccion' },
    courses_completed: { clave: 'recompensas.condicion_cursos',       claveUno: 'recompensas.condicion_curso' },
    quizzes_approved:  { clave: 'recompensas.condicion_evaluaciones', claveUno: 'recompensas.condicion_evaluacion' },
    quiz_streak:       { clave: 'recompensas.condicion_racha' }
};

const ORIGEN = {
    lesson: 'recompensas.origen_leccion',
    quiz: 'recompensas.origen_evaluacion',
    course: 'recompensas.origen_curso',
    challenge: 'recompensas.origen_desafio',
    manual: 'recompensas.origen_manual',
    points_assigned: 'recompensas.origen_puntos'
};

export default function RewardsGallery() {
    const { t, idioma } = useIdioma();
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        api.get(`/api/gamification/rewards/${usuario.id}`)
            .then(({ data }) => { setDatos(data); setError(null); })
            .catch((e) => setError(e.response?.data?.msg || t('recompensas.error_carga')));
    }, [usuario?.id, t]);

    const formatearFecha = (iso) =>
        new Date(iso).toLocaleDateString(idioma, { day: '2-digit', month: 'long', year: 'numeric' });

    const describir = (tipo, umbral) => {
        const condicion = CONDICION[tipo];
        if (!condicion) return t('recompensas.condicion_especial');
        const clave = (umbral === 1 && condicion.claveUno) ? condicion.claveUno : condicion.clave;
        return t(clave, { n: umbral });
    };

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-5xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                    </a>
                    <ThemeToggle />
                </div>

                <header className="mb-8 flex items-end justify-between">
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl font-bold">
                            <ShieldCheck className="h-8 w-8 text-brand-blue" />
                            {t('recompensas.titulo')}
                        </h1>
                        <p className="mt-1 text-text-secondary">
                            {t('recompensas.subtitulo')}
                        </p>
                    </div>
                    {datos && (
                        <div className="text-right">
                            <p className="text-sm text-text-secondary">{t('recompensas.obtenidas')}</p>
                            <p className="text-3xl font-black text-brand-blue">{datos.total_obtenidas}</p>
                        </div>
                    )}
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}
                {!error && !datos && <p className="text-text-secondary">{t('comun.cargando')}</p>}

                {datos && (
                    <>
                        <h2 className="mb-4 text-xl font-bold">{t('recompensas.obtenidas')}</h2>
                        {datos.obtenidas.length === 0 ? (
                            <Card className="mb-10 p-10 text-center">
                                <Trophy className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                                <p className="font-semibold">{t('recompensas.sin_recompensas')}</p>
                                <p className="mt-1 text-sm text-text-secondary">
                                    {t('recompensas.sin_recompensas_ayuda')}
                                </p>
                            </Card>
                        ) : (
                            <div className="mb-10 grid grid-ajustable [--ancho-columna:16rem] gap-4">
                                {/* Columnas por ancho minimo (ver grid-ajustable en index.css) y
                                    nombres que se envuelven en vez de truncarse: con el texto
                                    grande, tres columnas fijas cortaban el nombre de cada insignia. */}
                                {datos.obtenidas.map((r) => (
                                    <button
                                        key={r.id}
                                        onClick={() => setDetalle(r)}
                                        className="text-left"
                                    >
                                        <Card className="h-full border-l-4 border-l-brand-blue p-5 transition-colors hover:border-brand-blue/60">
                                            <div className="mb-3 flex items-center gap-3">
                                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/10">
                                                    {r.reward_icon_url
                                                        ? <img src={r.reward_icon_url} alt="" className="h-7 w-7" />
                                                        : <Award className="h-6 w-6 text-brand-blue" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="break-words font-bold">{r.reward_name}</h3>
                                                    <p className="text-xs text-text-secondary">
                                                        {formatearFecha(r.earned_at)}
                                                    </p>
                                                </div>
                                            </div>
                                            {r.reward_description && (
                                                <p className="line-clamp-2 text-sm text-text-secondary">
                                                    {r.reward_description}
                                                </p>
                                            )}
                                        </Card>
                                    </button>
                                ))}
                            </div>
                        )}

                        <h2 className="mb-4 text-xl font-bold">{t('recompensas.bloqueadas')}</h2>
                        {datos.bloqueadas.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="font-semibold">{t('recompensas.todas_obtenidas')}</p>
                            </Card>
                        ) : (
                            <div className="grid grid-ajustable [--ancho-columna:16rem] gap-4">
                                {datos.bloqueadas.map((b) => (
                                    <Card key={b.reward_id} className="p-5 opacity-60">
                                        <div className="mb-3 flex items-center gap-3">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gray-700 bg-gray-800">
                                                <Lock className="h-5 w-5 text-text-secondary" />
                                            </div>
                                            <h3 className="min-w-0 break-words font-bold text-text-secondary">
                                                {b.name}
                                            </h3>
                                        </div>

                                        <p className="mb-3 text-sm text-text-secondary">
                                            {describir(b.condition_type, b.threshold)}
                                        </p>

                                        <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                                            <div
                                                className="h-full rounded-full bg-brand-blue/60 transition-all"
                                                style={{ width: `${b.porcentaje}%` }}
                                            />
                                        </div>
                                        <p className="mt-1 text-right text-xs text-text-secondary">
                                            {b.progreso} / {b.threshold}
                                        </p>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {detalle && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
                    onClick={() => setDetalle(null)}
                    role="dialog"
                    aria-modal="true"
                >
                    <div
                        className="w-full max-w-sm rounded-2xl border border-brand-blue/40 bg-bg-deep p-8 text-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/10">
                            {detalle.reward_icon_url
                                ? <img src={detalle.reward_icon_url} alt="" className="h-12 w-12" />
                                : <Award className="h-10 w-10 text-brand-blue" />}
                        </div>
                        <h2 className="mb-2 text-2xl font-bold">{detalle.reward_name}</h2>
                        {detalle.reward_description && (
                            <p className="mb-4 text-sm text-text-secondary">{detalle.reward_description}</p>
                        )}
                        <dl className="space-y-1 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-text-secondary">{t('recompensas.obtenida_el')}</dt>
                                <dd>{formatearFecha(detalle.earned_at)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-text-secondary">{t('recompensas.origen')}</dt>
                                <dd>
                                    {ORIGEN[detalle.source_type]
                                        ? t(ORIGEN[detalle.source_type])
                                        : detalle.source_type || '—'}
                                </dd>
                            </div>
                            {detalle.condition_snapshot?.threshold != null && (
                                <div className="flex justify-between">
                                    <dt className="text-text-secondary">{t('recompensas.condicion')}</dt>
                                    <dd>{describir(detalle.condition_snapshot.condition_type, detalle.condition_snapshot.threshold)}</dd>
                                </div>
                            )}
                        </dl>
                        <button
                            onClick={() => setDetalle(null)}
                            className="mt-6 w-full rounded-lg border border-gray-700 px-4 py-2 hover:border-brand-blue/60"
                        >
                            {t('comun.cerrar')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
