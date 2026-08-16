import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft, BookOpen, Target, Trophy, Award } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { api, getUsuarioActual } from '../lib/api';

const ETIQUETAS = {
    lesson:     { texto: 'Lección',    icono: BookOpen, color: 'text-brand-light' },
    quiz:       { texto: 'Evaluación', icono: Target,   color: 'text-purple-400' },
    course:     { texto: 'Curso',      icono: Award,    color: 'text-emerald-400' },
    challenge:  { texto: 'Desafío',    icono: Trophy,   color: 'text-yellow-400' },
    simulation: { texto: 'Simulación', icono: Target,   color: 'text-purple-400' },
    manual:     { texto: 'Ajuste',     icono: Award,    color: 'text-text-secondary' }
};

const LIMITE = 15;

export default function PointsHistory() {
    const [datos, setDatos] = useState(null);
    const [pagina, setPagina] = useState(1);
    const [error, setError] = useState(null);
    const usuario = getUsuarioActual();

    useEffect(() => {
        if (!usuario) { window.location.href = '/login'; return; }

        api.get(`/api/gamification/points/${usuario.id}`, { params: { page: pagina, limit: LIMITE } })
            .then(({ data }) => { setDatos(data); setError(null); })
            .catch((e) => setError(e.response?.data?.msg || 'No se pudo cargar el historial'));
    }, [pagina, usuario?.id]);

    const formatearFecha = (iso) =>
        new Date(iso).toLocaleString('es', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-4xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-text-secondary hover:text-white">
                    <ArrowLeft className="h-4 w-4" /> Volver al panel
                </a>

                <header className="mb-8 flex items-end justify-between">
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl font-bold">
                            <ShieldCheck className="h-8 w-8 text-brand-blue" />
                            Historial de puntos
                        </h1>
                        <p className="mt-1 text-text-secondary">
                            Cada punto que ganaste y de dónde salió.
                        </p>
                    </div>
                    {datos && (
                        <div className="text-right">
                            <p className="text-sm text-text-secondary">Total acumulado</p>
                            <p className="text-3xl font-black text-brand-blue">
                                {datos.total_points.toLocaleString('es')}
                            </p>
                        </div>
                    )}
                </header>

                {error && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{error}</p>
                    </Card>
                )}

                {!error && !datos && <p className="text-text-secondary">Cargando…</p>}

                {datos && datos.historial.length === 0 && (
                    <Card className="p-10 text-center">
                        <Trophy className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                        <p className="font-semibold">Todavía no ganaste puntos</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            Completá una lección o superá un desafío para empezar.
                        </p>
                    </Card>
                )}

                {datos && datos.historial.length > 0 && (
                    <>
                        <Card className="overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b border-gray-800 text-text-secondary">
                                    <tr>
                                        <th className="px-5 py-3 font-medium">Fecha</th>
                                        <th className="px-5 py-3 font-medium">Origen</th>
                                        <th className="px-5 py-3 text-right font-medium">Puntos</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {datos.historial.map((m) => {
                                        const meta = ETIQUETAS[m.source_type] || ETIQUETAS.manual;
                                        const Icono = meta.icono;
                                        return (
                                            <tr key={m.id} className="border-b border-gray-800/60 last:border-0">
                                                <td className="px-5 py-3 text-text-secondary">
                                                    {formatearFecha(m.created_at)}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className={`inline-flex items-center gap-2 ${meta.color}`}>
                                                        <Icono className="h-4 w-4" />
                                                        {meta.texto}
                                                    </span>
                                                    {m.source_id && (
                                                        <span className="ml-2 text-xs text-text-secondary">
                                                            #{m.source_id}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className={`px-5 py-3 text-right font-bold ${m.points >= 0 ? 'text-brand-blue' : 'text-red-400'}`}>
                                                    {m.points >= 0 ? '+' : ''}{m.points}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </Card>

                        <div className="mt-4 flex items-center justify-between text-sm">
                            <span className="text-text-secondary">
                                Página {datos.paginacion.page} de {datos.paginacion.total_paginas}
                                {' · '}{datos.movimientos} movimientos
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                                    disabled={pagina <= 1}
                                    className="rounded-lg border border-gray-700 px-4 py-2 disabled:opacity-40 enabled:hover:border-brand-blue/60"
                                >
                                    Anterior
                                </button>
                                <button
                                    onClick={() => setPagina((p) => p + 1)}
                                    disabled={pagina >= datos.paginacion.total_paginas}
                                    className="rounded-lg border border-gray-700 px-4 py-2 disabled:opacity-40 enabled:hover:border-brand-blue/60"
                                >
                                    Siguiente
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
