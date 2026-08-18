import React, { useEffect, useState } from 'react';
import {
    ShieldCheck, ArrowLeft, TrendingUp, TrendingDown, Minus,
    AlertTriangle, BookOpen, Target, Lightbulb
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { api, getUsuarioActual } from '../lib/api';

/**
 * Pantalla "Mi desempeño" (mockups de la HU de recomendaciones):
 * areas de oportunidad, lista de refuerzos sugeridos con su motivo y
 * grafico de evolucion de puntajes.
 *
 * Todo llega calculado de GET /api/gamification/performance/:userId. El
 * frontend no deriva nada ni compara contra otros usuarios: solo dibuja.
 */
export default function Performance() {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        api.get(`/api/gamification/performance/${usuario.id}`)
            .then(({ data }) => { setDatos(data); setError(null); })
            .catch((e) => setError(e.response?.data?.msg || 'No se pudo cargar tu desempeño'));
    }, [usuario?.id]);

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-5xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>

                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <ShieldCheck className="h-8 w-8 text-brand-blue" />
                        Mi desempeño
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        En qué conviene que enfoques el esfuerzo, según tu propio historial.
                    </p>
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}
                {!error && !datos && <p className="text-text-secondary">Cargando…</p>}

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

function Resumen({ resumen }) {
    const items = [
        { etiqueta: 'Evaluaciones hechas', valor: resumen.evaluaciones_realizadas, color: 'text-text-primary' },
        { etiqueta: 'Promedio general', valor: resumen.promedio_general ?? '—', sufijo: '%', color: 'text-brand-blue' },
        { etiqueta: 'A reforzar', valor: resumen.areas_de_oportunidad, color: 'text-yellow-400' },
        { etiqueta: 'Sin intentar', valor: resumen.pendientes, color: 'text-text-secondary' }
    ];

    return (
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {items.map((i) => (
                <Card key={i.etiqueta} className="p-5">
                    <p className="text-sm text-text-secondary">{i.etiqueta}</p>
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
    const { serie, tendencia, promedio_reciente, promedio_previo, diferencia } = evolucion;

    const ICONO = {
        mejorando: <TrendingUp className="h-5 w-5 text-emerald-400" />,
        bajando: <TrendingDown className="h-5 w-5 text-red-400" />,
        estable: <Minus className="h-5 w-5 text-text-secondary" />,
        sin_datos: <Minus className="h-5 w-5 text-text-secondary" />
    };

    const TEXTO = {
        mejorando: `Vas mejorando: tus últimos intentos promedian ${promedio_reciente}%, contra ${promedio_previo}% antes.`,
        bajando: `Tus últimos intentos bajaron a ${promedio_reciente}%, contra ${promedio_previo}% antes.`,
        estable: `Te mantenés estable, alrededor de ${promedio_reciente}%.`,
        sin_datos: 'Todavía no hay suficientes intentos para comparar contra tu historial.'
    };

    if (serie.length === 0) {
        return (
            <Card className="mb-8 p-8 text-center">
                <Target className="mx-auto mb-3 h-8 w-8 text-text-secondary" />
                <p className="font-semibold">Todavía no hiciste ninguna evaluación</p>
                <p className="mt-1 text-sm text-text-secondary">
                    Cuando completes la primera, acá vas a ver tu evolución.
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
                <h2 className="text-lg font-bold">Evolución de tus puntajes</h2>
                {diferencia != null && (
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
                        diferencia > 0 ? 'bg-emerald-500/20 text-emerald-400'
                            : diferencia < 0 ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-700 text-text-secondary'
                    }`}>
                        {diferencia > 0 ? '+' : ''}{diferencia} pts
                    </span>
                )}
            </div>

            <p className="mb-4 text-sm text-text-secondary">{TEXTO[tendencia]}</p>

            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full min-w-[320px]" role="img"
                     aria-label="Grafico de evolucion de puntajes">
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
                            <title>{`${p.titulo}: ${p.score}% (${p.passed ? 'aprobada' : 'reprobada'})`}</title>
                        </circle>
                    ))}
                </svg>
            </div>

            <div className="mt-2 flex justify-between text-xs text-text-secondary">
                <span>Primer intento</span>
                <span className="opacity-60">línea punteada: 70%</span>
                <span>Último</span>
            </div>
        </Card>
    );
}

function Areas({ areas, umbral }) {
    return (
        <>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Áreas de oportunidad
            </h2>

            {areas.length === 0 ? (
                <Card className="mb-8 p-8 text-center">
                    <p className="font-semibold">Ninguna evaluación por debajo del {umbral}%</p>
                    <p className="mt-1 text-sm text-text-secondary">Seguí así.</p>
                </Card>
            ) : (
                <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
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
                            {a.curso && <p className="mb-2 text-xs text-text-secondary">Curso: {a.curso}</p>}
                            <p className="text-sm text-text-secondary">{a.motivo}</p>
                            <p className="mt-2 text-xs text-text-secondary">
                                {a.intentos} {a.intentos === 1 ? 'intento' : 'intentos'}
                                {a.mejor_puntaje !== a.ultimo_puntaje && <> · tu mejor marca fue {a.mejor_puntaje}%</>}
                                {' '}· mínimo para aprobar: {a.puntaje_minimo}%
                            </p>
                        </Card>
                    ))}
                </div>
            )}
        </>
    );
}

function Recomendaciones({ lista }) {
    if (lista.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <Lightbulb className="h-5 w-5 text-brand-blue" />
                Refuerzos sugeridos
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
                                {r.curso} · {r.content_type} · +{r.puntos} pts
                            </p>
                            <p className="mt-2 text-sm text-brand-light">{r.motivo}</p>
                        </div>
                    </Card>
                ))}
            </div>
        </>
    );
}

function Pendientes({ lista }) {
    if (lista.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 text-xl font-bold">Sin intentar todavía</h2>
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

function Cursos({ cursos }) {
    if (cursos.length === 0) return null;

    return (
        <>
            <h2 className="mb-4 text-xl font-bold">Avance en tus cursos</h2>
            <div className="space-y-3">
                {cursos.map((c) => (
                    <Card key={c.course_id} className="p-5">
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="font-bold">{c.curso}</h3>
                            <span className="text-sm text-text-secondary">
                                {c.lecciones_completadas} / {c.lecciones_totales} lecciones
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
