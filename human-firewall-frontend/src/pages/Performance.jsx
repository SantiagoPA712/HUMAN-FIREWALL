import React, { useEffect, useState } from 'react';
import {
    ShieldCheck, ArrowLeft, TrendingUp, TrendingDown, Minus,
    AlertTriangle, BookOpen, Target, Lightbulb
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

/**
 * Pantalla "Mi desempeño" (mockups de la HU de recomendaciones):
 * areas de oportunidad, lista de refuerzos sugeridos con su motivo y
 * grafico de evolucion de puntajes.
 *
 * Todo llega calculado de GET /api/gamification/performance/:userId. El
 * frontend no deriva nada ni compara contra otros usuarios: solo dibuja.
 */
export default function Performance() {
    const { t } = useIdioma();
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        api.get(`/api/gamification/performance/${usuario.id}`)
            .then(({ data }) => { setDatos(data); setError(null); })
            .catch((e) => setError(e.response?.data?.msg || t('desempeno.error_carga')));
    }, [usuario?.id, t]);

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
                        <ShieldCheck className="h-8 w-8 text-brand-blue" />
                        {t('desempeno.titulo')}
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        {t('desempeno.subtitulo')}
                    </p>
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}
                {!error && !datos && <p className="text-text-secondary">{t('comun.cargando')}</p>}

                {datos && (
                    <>
                        <Resumen resumen={datos.resumen} />
                        <Evolucion evolucion={datos.evolucion} />
                        <Areas areas={datos.areas_de_oportunidad} umbral={datos.regla.umbral} />
                        <Recomendaciones lista={datos.recomendaciones} />
                        <Pendientes lista={datos.pendientes} />
                        <Cursos cursos={datos.cursos} />
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Cuatro numeros de cabecera.
 *
 * "A reforzar" y "Sin intentar" se muestran juntos a proposito: uno dice
 * donde flaqueaste y el otro que te falta empezar. Son las dos preguntas que
 * responde esta pantalla.
 */
function Resumen({ resumen }) {
    const { t } = useIdioma();

    // La lista guarda la CLAVE de la etiqueta, no el texto: asi se resuelve
    // con t() en cada render y cambia de idioma sola.
    const items = [
        { etiqueta: 'desempeno.evaluaciones_hechas', valor: resumen.evaluaciones_realizadas, color: 'text-text-primary' },
        { etiqueta: 'desempeno.promedio_general', valor: resumen.promedio_general ?? '—', sufijo: '%', color: 'text-brand-blue' },
        { etiqueta: 'desempeno.a_reforzar', valor: resumen.areas_de_oportunidad, color: 'text-yellow-400' },
        { etiqueta: 'desempeno.sin_intentar', valor: resumen.pendientes, color: 'text-text-secondary' }
    ];

    return (
        <div className="mb-8 grid grid-ajustable [--ancho-columna:10rem] gap-4">
            {items.map((i) => (
                <Card key={i.etiqueta} className="p-5">
                    <p className="text-sm text-text-secondary">{t(i.etiqueta)}</p>
                    <p className={`text-3xl font-black ${i.color}`}>
                        {i.valor}{i.sufijo || ''}
                    </p>
                </Card>
            ))}
        </div>
    );
}

/**
 * Grafico de evolucion de puntajes.
 *
 * Es un SVG escrito a mano: el proyecto no tiene ninguna libreria de graficos
 * instalada y sumar una dependencia entera para una sola linea no se justifica.
 */
function Evolucion({ evolucion }) {
    const { t } = useIdioma();
    const { serie, tendencia, promedio_reciente, promedio_previo, diferencia } = evolucion;

    const ICONO = {
        mejorando: <TrendingUp className="h-5 w-5 text-emerald-400" />,
        bajando: <TrendingDown className="h-5 w-5 text-red-400" />,
        estable: <Minus className="h-5 w-5 text-text-secondary" />,
        sin_datos: <Minus className="h-5 w-5 text-text-secondary" />
    };

    const TEXTO = {
        mejorando: t('desempeno.tendencia_mejorando', { reciente: promedio_reciente, previo: promedio_previo }),
        bajando: t('desempeno.tendencia_bajando', { reciente: promedio_reciente, previo: promedio_previo }),
        estable: t('desempeno.tendencia_estable', { reciente: promedio_reciente }),
        sin_datos: t('desempeno.sin_tendencia')
    };

    if (serie.length === 0) {
        return (
            <Card className="mb-8 p-8 text-center">
                <Target className="mx-auto mb-3 h-8 w-8 text-text-secondary" />
                <p className="font-semibold">{t('desempeno.sin_evaluaciones')}</p>
                <p className="mt-1 text-sm text-text-secondary">
                    {t('desempeno.sin_evaluaciones_ayuda')}
                </p>
            </Card>
        );
    }

    // Coordenadas del grafico. El eje Y va de 0 a 100 (los puntajes ya son
    // porcentajes), asi que no hace falta escalar por el maximo.
    const W = 640, H = 160, PAD = 8;
    const puntos = serie.map((p, i) => {
        const x = serie.length === 1
            ? W / 2
            : PAD + (i * (W - PAD * 2)) / (serie.length - 1);
        const y = H - PAD - ((p.score / 100) * (H - PAD * 2));
        return { x, y, ...p };
    });

    const linea = puntos.map((p) => `${p.x},${p.y}`).join(' ');

    return (
        <Card className="mb-8 p-6">
            <div className="mb-4 flex items-center gap-2">
                {ICONO[tendencia]}
                <h2 className="text-lg font-bold">{t('desempeno.evolucion_titulo')}</h2>
                {diferencia != null && (
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
                        diferencia > 0 ? 'bg-emerald-500/20 text-emerald-400'
                            : diferencia < 0 ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-700 text-text-secondary'
                    }`}>
                        {diferencia > 0 ? '+' : ''}{diferencia} {t('desempeno.pts')}
                    </span>
                )}
            </div>

            <p className="mb-4 text-sm text-text-secondary">{TEXTO[tendencia]}</p>

            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full min-w-[20rem]" role="img"
                     aria-label={t('desempeno.grafico_aria')}>
                    {/* Referencia del 70%, el umbral por defecto */}
                    <line x1={PAD} y1={H - PAD - 0.7 * (H - PAD * 2)} x2={W - PAD}
                          y2={H - PAD - 0.7 * (H - PAD * 2)}
                          stroke="#94A3B8" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />

                    <polyline points={linea} fill="none" stroke="#2563EB" strokeWidth="2"
                              strokeLinejoin="round" strokeLinecap="round" />

                    {puntos.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r="4"
                                fill={p.passed ? '#10B981' : '#EF4444'}
                                stroke="#0B1120" strokeWidth="2">
                            <title>{`${p.titulo}: ${p.score}% (${p.passed ? t('desempeno.aprobada') : t('desempeno.reprobada')})`}</title>
                        </circle>
                    ))}
                </svg>
            </div>

            <div className="mt-2 flex justify-between text-xs text-text-secondary">
                <span>{t('desempeno.primer_intento')}</span>
                <span className="opacity-60">{t('desempeno.linea_umbral')}</span>
                <span>{t('desempeno.ultimo_intento')}</span>
            </div>
        </Card>
    );
}

/**
 * Areas de oportunidad: donde conviene enfocar el esfuerzo.
 *
 * El badge muestra el ULTIMO puntaje y no el mejor. Al reves se producia el
 * caso absurdo de marcar algo como area de oportunidad y mostrarle al lado un
 * 100%, que era la marca historica y no reflejaba el intento reciente.
 *
 * Un retroceso (aprobo antes, fallo ahora) se pinta en naranja para
 * distinguirlo de algo que nunca se aprobo, en amarillo.
 */
function Areas({ areas, umbral }) {
    const { t } = useIdioma();

    return (
        <>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                {t('desempeno.areas_oportunidad')}
            </h2>

            {areas.length === 0 ? (
                <Card className="mb-8 p-8 text-center">
                    <p className="font-semibold">{t('desempeno.sin_areas', { umbral })}</p>
                    <p className="mt-1 text-sm text-text-secondary">{t('desempeno.sin_areas_ayuda')}</p>
                </Card>
            ) : (
                <div className="mb-8 grid grid-ajustable [--ancho-columna:20rem] gap-4">
                    {areas.map((a) => (
                        <Card key={`${a.quiz_type}-${a.quiz_ref}`} className={`border-l-4 p-5 ${
                            a.retrocedio ? 'border-l-orange-500' : 'border-l-yellow-500'
                        }`}>
                            <div className="mb-2 flex items-start justify-between gap-3">
                                <h3 className="font-bold">{a.titulo}</h3>
                                {/* Se muestra el ULTIMO puntaje, no el mejor: es el que
                                    refleja como esta el usuario hoy. */}
                                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${
                                    a.ultimo_puntaje >= umbral ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                    {a.ultimo_puntaje}%
                                </span>
                            </div>
                            {a.curso && (
                                <p className="mb-2 text-xs text-text-secondary">
                                    {t('desempeno.curso', { curso: a.curso })}
                                </p>
                            )}
                            <p className="text-sm text-text-secondary">{a.motivo}</p>
                            <p className="mt-2 text-xs text-text-secondary">
                                {a.intentos} {a.intentos === 1 ? t('desempeno.intento') : t('desempeno.intentos')}
                                {a.mejor_puntaje !== a.ultimo_puntaje && <> · {t('desempeno.mejor_marca', { puntaje: a.mejor_puntaje })}</>}
                                {' '}· {t('desempeno.minimo_aprobar', { puntaje: a.puntaje_minimo })}
                            </p>
                        </Card>
                    ))}
                </div>
            )}
        </>
    );
}

/**
 * Lecciones de refuerzo sugeridas.
 *
 * Cada una lleva su motivo escrito ("Sugerido porque tu ultimo intento en X
 * bajo a 0%"). Sin ese texto la lista pareceria contenido al azar, y el
 * criterio de aceptacion 2 de la HU pide justamente que se entienda de donde
 * sale la sugerencia.
 *
 * Si no hay nada que sugerir la seccion no se dibuja, en lugar de mostrar un
 * titulo con un vacio debajo.
 */
function Recomendaciones({ lista }) {
    const { t } = useIdioma();

    if (lista.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <Lightbulb className="h-5 w-5 text-brand-blue" />
                {t('desempeno.recomendaciones')}
            </h2>
            <div className="mb-8 space-y-3">
                {lista.map((r) => (
                    <Card key={r.content_id} className="flex items-start gap-4 p-5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue/10">
                            <BookOpen className="h-5 w-5 text-brand-blue" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold">{r.extracto}</p>
                            <p className="text-xs text-text-secondary">
                                {r.curso} · {r.content_type} · +{r.puntos} {t('desempeno.pts')}
                            </p>
                            <p className="mt-2 text-sm text-brand-light">{r.motivo}</p>
                        </div>
                    </Card>
                ))}
            </div>
        </>
    );
}

/**
 * Evaluaciones que el usuario todavia no intento ni una vez.
 *
 * Van como etiquetas sueltas y no como tarjetas: no son un problema a
 * corregir, solo contenido disponible. Darles el mismo peso visual que a las
 * areas de oportunidad diluiria el mensaje de la pantalla.
 */
function Pendientes({ lista }) {
    const { t } = useIdioma();

    if (lista.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 text-xl font-bold">{t('desempeno.pendientes_titulo')}</h2>
            <div className="mb-8 flex flex-wrap gap-2">
                {lista.map((p) => (
                    <span key={`${p.quiz_type}-${p.quiz_ref}`}
                          className="rounded-full border border-gray-700 px-3 py-1 text-sm text-text-secondary">
                        {p.titulo}
                    </span>
                ))}
            </div>
        </>
    );
}

/**
 * Avance de lecciones por curso asignado.
 *
 * Es el contrapeso de las areas de oportunidad: estas miden como te fue en las
 * evaluaciones, esto mide cuanto material recorriste. Un usuario puede tener
 * buen puntaje y poco avance, o al reves, y las dos cosas importan.
 */
function Cursos({ cursos }) {
    const { t } = useIdioma();

    if (cursos.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 text-xl font-bold">{t('desempeno.cursos_titulo')}</h2>
            <div className="space-y-3">
                {cursos.map((c) => (
                    <Card key={c.course_id} className="p-5">
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="font-bold">{c.curso}</h3>
                            <span className="text-sm text-text-secondary">
                                {c.lecciones_completadas} / {c.lecciones_totales} {t('desempeno.lecciones')}
                            </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                            <div className="h-full rounded-full bg-brand-blue transition-all"
                                 style={{ width: `${c.porcentaje}%` }} />
                        </div>
                    </Card>
                ))}
            </div>
        </>
    );
}
