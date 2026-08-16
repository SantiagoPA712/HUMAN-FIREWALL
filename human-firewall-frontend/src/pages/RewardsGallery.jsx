import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft, Award, Lock, Trophy } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { api, getUsuarioActual } from '../lib/api';

const TEXTO_CONDICION = {
    points_total:      (n) => `Alcanzá ${n} puntos`,
    lessons_completed: (n) => `Completá ${n} ${n === 1 ? 'lección' : 'lecciones'}`,
    courses_completed: (n) => `Finalizá ${n} ${n === 1 ? 'curso' : 'cursos'}`,
    quizzes_approved:  (n) => `Aprobá ${n} ${n === 1 ? 'evaluación' : 'evaluaciones'}`,
    quiz_streak:       (n) => `Aprobá ${n} evaluaciones seguidas`
};

const ORIGEN = {
    lesson: 'lección', quiz: 'evaluación', course: 'curso',
    challenge: 'desafío', manual: 'asignación manual', points_assigned: 'puntos acumulados'
};

export default function RewardsGallery() {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }
        api.get(`/api/gamification/rewards/${usuario.id}`)
            .then(({ data }) => { setDatos(data); setError(null); })
            .catch((e) => setError(e.response?.data?.msg || 'No se pudieron cargar tus logros'));
    }, [usuario?.id]);

    const formatearFecha = (iso) =>
        new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' });

    const describir = (tipo, umbral) =>
        (TEXTO_CONDICION[tipo] || (() => 'Condición especial'))(umbral);

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-5xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>

                <header className="mb-8 flex items-end justify-between">
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl font-bold">
                            <ShieldCheck className="h-8 w-8 text-brand-blue" />
                            Mis logros
                        </h1>
                        <p className="mt-1 text-text-secondary">
                            Las insignias que ganaste y las que todavía podés desbloquear.
                        </p>
                    </div>
                    {datos && (
                        <div className="text-right">
                            <p className="text-sm text-text-secondary">Obtenidas</p>
                            <p className="text-3xl font-black text-brand-blue">{datos.total_obtenidas}</p>
                        </div>
                    )}
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}
                {!error && !datos && <p className="text-text-secondary">Cargando…</p>}

                {datos && (
                    <>
                        <h2 className="mb-4 text-xl font-bold">Obtenidas</h2>
                        {datos.obtenidas.length === 0 ? (
                            <Card className="mb-10 p-10 text-center">
                                <Trophy className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                                <p className="font-semibold">Todavía no desbloqueaste ninguna</p>
                                <p className="mt-1 text-sm text-text-secondary">
                                    Completá una lección para ganar tu primera insignia.
                                </p>
                            </Card>
                        ) : (
                            <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                                                    <h3 className="truncate font-bold">{r.reward_name}</h3>
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

                        <h2 className="mb-4 text-xl font-bold">Por desbloquear</h2>
                        {datos.bloqueadas.length === 0 ? (
                            <Card className="p-8 text-center">
                                <p className="font-semibold">Las ganaste todas</p>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {datos.bloqueadas.map((b) => (
                                    <Card key={b.reward_id} className="p-5 opacity-60">
                                        <div className="mb-3 flex items-center gap-3">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gray-700 bg-gray-800">
                                                <Lock className="h-5 w-5 text-text-secondary" />
                                            </div>
                                            <h3 className="min-w-0 truncate font-bold text-text-secondary">
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
                                <dt className="text-text-secondary">Obtenida el</dt>
                                <dd>{formatearFecha(detalle.earned_at)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-text-secondary">Origen</dt>
                                <dd>{ORIGEN[detalle.source_type] || detalle.source_type || '—'}</dd>
                            </div>
                            {detalle.condition_snapshot?.threshold != null && (
                                <div className="flex justify-between">
                                    <dt className="text-text-secondary">Condición</dt>
                                    <dd>{describir(detalle.condition_snapshot.condition_type, detalle.condition_snapshot.threshold)}</dd>
                                </div>
                            )}
                        </dl>
                        <button
                            onClick={() => setDetalle(null)}
                            className="mt-6 w-full rounded-lg border border-gray-700 px-4 py-2 hover:border-brand-blue/60"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
