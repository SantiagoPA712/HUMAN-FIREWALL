import React, { useCallback, useEffect, useState } from 'react';
import {
    Bell, ArrowLeft, CheckCheck, RotateCcw, BookOpen, Mail, Monitor,
    ShieldAlert, RefreshCw, CheckCircle2, XCircle, Lock, Languages
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { useIdioma } from '../context/useIdioma';

/**
 * Centro de notificaciones de resultados.
 *
 * Criterio de aceptacion 3: listado cronologico de resultados notificados,
 * marcados como leidos o no leidos, y un boton para marcar todas de una vez.
 *
 * Tres bloques:
 *   - la lista de resultados, con sus opciones de reintento cuando reprobo,
 *   - los canales que el usuario tiene habilitados (criterio tecnico 3),
 *   - y, solo para RH, que cursos disparan alerta (criterio de aceptacion 2).
 *
 * La pantalla no decide nada: no sabe que es un curso critico ni a quien se
 * le avisa. Pide y dibuja; la resolucion de destinatarios vive en el backend,
 * como exige el criterio tecnico 2.
 */
export default function NotificationsPage() {
    const usuario = getUsuarioActual();
    const esRh = usuario?.role === 'rh' || usuario?.role === 'admin';
    const { t, idioma, cambiarIdioma: cambiarIdiomaDeLaCuenta } = useIdioma();

    const [centro, setCentro] = useState(null);
    const [preferencias, setPreferencias] = useState(null);
    const [cursos, setCursos] = useState(null);
    const [correo, setCorreo] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);

        try {
            // Se piden por separado para que un fallo en la parte de RH no
            // deje sin bandeja al usuario.
            const [resCentro, resPrefs, resCorreo] = await Promise.all([
                api.get('/api/notifications/resultados'),
                api.get('/api/notifications/preferencias'),
                api.get('/api/notifications/correo/preferencias')
            ]);
            setCentro(resCentro.data);
            setPreferencias(resPrefs.data.canales);
            setCorreo(resCorreo.data);

            if (esRh) {
                const { data } = await api.get('/api/notifications/cursos-criticos');
                setCursos(data);
            }
        } catch (e) {
            setError(e.response?.data?.msg || t('notificaciones.error_cargar'));
        } finally {
            setCargando(false);
        }
    }, [esRh, t]);

    useEffect(() => {
        if (!usuario) window.location.href = '/login';
    }, [usuario]);

    /* eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
    useEffect(() => { cargar(); }, []);

    const marcarTodas = async () => {
        try {
            await api.patch('/api/notifications/leidas');
            cargar();
        } catch {
            setError(t('notificaciones.error_marcar'));
        }
    };

    const cambiarCanal = async (canal, valor) => {
        try {
            const { data } = await api.patch('/api/notifications/preferencias', { [canal]: valor });
            setPreferencias(data.canales);
            // El canal de correo apagado tambien corta los correos por tipo:
            // se recarga ese bloque para que no muestre algo que no va a pasar.
            if (canal === 'email') {
                const { data: prefsCorreo } = await api.get('/api/notifications/correo/preferencias');
                setCorreo(prefsCorreo);
            }
        } catch {
            setError(t('notificaciones.error_canal'));
        }
    };

    // HU de notificaciones por correo (criterio de aceptacion 2). El backend
    // rechaza con 400 desactivar un critico; la pantalla ni lo ofrece.
    const cambiarTipoDeCorreo = async (tipo, valor) => {
        try {
            const { data } = await api.patch('/api/notifications/correo/preferencias', {
                tipos: { [tipo]: valor }
            });
            setCorreo(data);
        } catch (e) {
            setError(e.response?.data?.errores?.[0]?.detalle || t('notificaciones.error_correo'));
        }
    };

    // Criterio de aceptacion 3: el idioma es de la cuenta, no de esta pantalla.
    // '' vuelve a "sin configurar" y los correos siguen al idioma de la plataforma.
    //
    // Se delega en el contexto de idioma en vez de llamar a la API a mano. Es
    // el MISMO PATCH a /api/users/me de antes y deja la cuenta igual, pero
    // ademas repinta la interfaz: `users.language` ahora manda sobre los dos
    // (los correos y la pantalla), asi que cambiarlo aca sin avisarle al
    // contexto dejaria la pantalla en el idioma viejo hasta recargar.
    const cambiarIdioma = async (valor) => {
        const ok = await cambiarIdiomaDeLaCuenta(valor || null);
        if (!ok) {
            setError(t('notificaciones.error_idioma'));
            return;
        }
        try {
            const { data } = await api.get('/api/notifications/correo/preferencias');
            setCorreo(data);
        } catch {
            setError(t('notificaciones.error_idioma'));
        }
    };

    const cambiarCritico = async (curso) => {
        try {
            await api.patch(`/api/notifications/cursos-criticos/${curso.id}`, {
                is_critical: !curso.is_critical
            });
            const { data } = await api.get('/api/notifications/cursos-criticos');
            setCursos(data);
        } catch {
            setError(t('notificaciones.error_curso'));
        }
    };

    // Estos tres se resuelven ACA y no dentro del map de abajo: ese map usa `t`
    // como nombre del tipo de correo, que taparia la funcion de traduccion.
    // Se deja el map como estaba y se le pasan los textos ya resueltos.
    const textoObligatorio = t('notificaciones.obligatorio');
    const textoActivado = t('correo.activado');
    const textoDesactivado = t('correo.desactivado');


    const fecha = (iso) =>
        iso ? new Date(iso).toLocaleString(idioma, {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : '';

    return (
        <Marco>
            {error && (
                <Card className="mb-6 border-l-4 border-l-red-500 p-4">
                    <p className="text-red-400">{error}</p>
                </Card>
            )}

            {/* --- Canales (criterio tecnico 3) --- */}
            <Card className="mb-6 p-6">
                <h2 className="mb-1 flex items-center gap-2 font-bold">
                    <Monitor className="h-5 w-5 text-brand-blue" /> {t('notificaciones.canales_titulo')}
                </h2>
                <p className="mb-4 text-sm text-text-secondary">
                    {t('notificaciones.canales_ayuda')}
                </p>

                <div className="flex flex-wrap gap-3">
                    <Canal
                        icono={<Monitor className="h-4 w-4" />}
                        etiqueta={t('notificaciones.canal_app')}
                        activo={preferencias?.in_app !== false}
                        onClick={() => cambiarCanal('in_app', preferencias?.in_app === false)}
                    />
                    <Canal
                        icono={<Mail className="h-4 w-4" />}
                        etiqueta={t('notificaciones.canal_correo')}
                        activo={preferencias?.email !== false}
                        onClick={() => cambiarCanal('email', preferencias?.email === false)}
                    />
                </div>
            </Card>

            {/* --- Correos por tipo e idioma (HU de notificaciones por correo) --- */}
            {correo && (
                <Card className="mb-6 p-6">
                    <h2 className="mb-1 flex items-center gap-2 font-bold">
                        <Mail className="h-5 w-5 text-brand-blue" /> {t('notificaciones.correos_titulo')}
                    </h2>
                    <p className="mb-4 text-sm text-text-secondary">
                        {correo.canal_email
                            ? t('notificaciones.correos_ayuda')
                            : t('notificaciones.correos_ayuda_canal_apagado')}
                    </p>

                    <label className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                        <span className="flex items-center gap-2 text-text-secondary">
                            <Languages className="h-4 w-4" /> {t('notificaciones.idioma_correos')}
                        </span>
                        <select
                            value={correo.idioma || ''}
                            onChange={e => cambiarIdioma(e.target.value)}
                            className="min-w-0 max-w-full rounded-lg border border-gray-700 bg-bg-deep px-3 py-1.5 text-sm"
                        >
                            <option value="">
                                {t('notificaciones.idioma_predeterminado', { idioma: correo.idioma_por_defecto })}
                            </option>
                            <option value="es">{t('notificaciones.idioma_es')}</option>
                            <option value="en">{t('notificaciones.idioma_en')}</option>
                        </select>
                    </label>

                    <div className="space-y-2">
                        {correo.tipos.map(t => (
                            <div key={t.tipo} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-3 py-2">
                                <span className="flex items-center gap-2 text-sm">
                                    {t.critico
                                        ? <Lock className="h-4 w-4 text-amber-400" />
                                        : <Mail className="h-4 w-4 text-text-secondary" />}
                                    {t.descripcion}
                                </span>
                                {t.critico ? (
                                    <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
                                        {textoObligatorio}
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => cambiarTipoDeCorreo(t.tipo, !t.habilitado)}
                                        disabled={!correo.canal_email}
                                        className={`rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${
                                            t.habilitado
                                                ? 'border-brand-blue bg-brand-blue/15 text-brand-light'
                                                : 'border-gray-700 text-text-secondary'
                                        }`}
                                    >
                                        {t.habilitado ? textoActivado : textoDesactivado}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* --- Cursos criticos: solo RH (criterio de aceptacion 2) --- */}
            {esRh && cursos && (
                <Card className="mb-6 p-6">
                    <h2 className="mb-1 flex items-center gap-2 font-bold">
                        <ShieldAlert className="h-5 w-5 text-brand-blue" /> {t('notificaciones.cursos_criticos')}
                    </h2>
                    <p className="mb-4 text-sm text-text-secondary">
                        {t('notificaciones.cursos_criticos_ayuda')}{' '}
                        {t('notificaciones.marcados', { marcados: cursos.criticos, total: cursos.total })}
                    </p>

                    <div className="space-y-2">
                        {cursos.cursos.map(c => (
                            <div key={c.id} className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
                                <span className="flex items-center gap-2 text-sm">
                                    <BookOpen className="h-4 w-4 text-text-secondary" />
                                    {c.title}
                                </span>
                                <button
                                    onClick={() => cambiarCritico(c)}
                                    className={`rounded-full border px-3 py-1 text-xs ${
                                        c.is_critical
                                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                            : 'border-gray-700 text-text-secondary'
                                    }`}
                                >
                                    {c.is_critical ? t('notificaciones.critico') : t('notificaciones.normal')}
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* --- Listado cronologico (criterio de aceptacion 3) --- */}
            <Card className="p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-bold">
                        {t('notificaciones.resultados')}
                        {centro?.no_leidas > 0 && (
                            <span className="ml-2 rounded-full bg-brand-blue px-2 py-0.5 text-xs font-semibold text-white">
                                {centro.no_leidas} {t('notificaciones.no_leidas')}
                            </span>
                        )}
                    </h2>

                    <div className="flex flex-wrap items-center gap-3">
                        <button onClick={cargar} disabled={cargando}
                                className="flex items-center gap-2 text-sm text-text-secondary hover:text-white disabled:opacity-50">
                            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
                            {t('comun.actualizar')}
                        </button>
                        <Button onClick={marcarTodas} className="px-3 py-1.5 text-sm"
                                disabled={!centro || centro.no_leidas === 0}>
                            <CheckCheck className="h-4 w-4" />
                            {t('notificaciones.marcar_leidas')}
                        </Button>
                    </div>
                </div>

                {!centro ? (
                    <p className="py-8 text-center text-sm text-text-secondary">{t('comun.cargando')}</p>
                ) : centro.resultados.length === 0 ? (
                    <div className="py-12 text-center">
                        <Bell className="mx-auto mb-4 h-10 w-10 text-text-secondary" />
                        <p className="font-semibold">{t('notificaciones.sin_resultados')}</p>
                        <p className="mt-1 text-sm text-text-secondary">
                            {t('notificaciones.sin_resultados_ayuda')}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {centro.resultados.map(n => <Aviso key={n.id} n={n} fecha={fecha} />)}
                    </div>
                )}
            </Card>
        </Marco>
    );
}

/** Una notificacion, con su estado por canal y sus opciones de reintento. */
function Aviso({ n, fecha }) {
    const { t } = useIdioma();

    // El estado de lectura sale de la entrega in_app, no del campo global del
    // aviso: el correo se marca leido por su cuenta (criterio tecnico 3).
    const leida = !!n.leida_en_app;
    const reprobado = n.payload?.resultado === 'reprobado' || n.payload?.resultado === 'reprobada';

    return (
        <div className={`rounded-xl border p-4 ${
            leida ? 'border-gray-800' : 'border-brand-blue/40 bg-brand-blue/5'
        }`}>
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                    {reprobado
                        ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                        : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />}
                    <div>
                        <p className={`font-semibold ${leida ? '' : 'text-brand-light'}`}>{n.title}</p>
                        {/* El cuerpo trae saltos de linea del servidor. */}
                        <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{n.body}</p>
                    </div>
                </div>

                <div className="shrink-0 text-right">
                    <p className="text-xs text-text-secondary">{fecha(n.created_at)}</p>
                    {!leida && (
                        <span className="mt-1 inline-block rounded bg-brand-blue/20 px-2 py-0.5 text-2xs font-semibold text-brand-light">
                            {t('notificaciones.sin_leer')}
                        </span>
                    )}
                </div>
            </div>

            {/* Criterio de aceptacion 1: si reprobo, las opciones para reintentar. */}
            {reprobado && (n.payload?.reintentar_en || n.payload?.reforzar_en) && (
                <div className="mt-3 flex flex-wrap gap-2 pl-8">
                    {n.payload.reintentar_en && (
                        <a href={n.payload.reintentar_en}
                           className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800">
                            <RotateCcw className="h-3.5 w-3.5" /> {t('notificaciones.reintentar_desafio')}
                        </a>
                    )}
                    {n.payload.reforzar_en && (
                        <a href={n.payload.reforzar_en}
                           className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800">
                            <BookOpen className="h-3.5 w-3.5" /> {t('notificaciones.ver_refuerzos')}
                        </a>
                    )}
                </div>
            )}

            {/* Estado por canal (criterios tecnicos 3 y 5). */}
            {n.canales?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 pl-8">
                    {n.canales.map(c => (
                        <span key={c.canal}
                              className="inline-flex items-center gap-1 rounded border border-gray-800 px-2 py-0.5 font-mono text-2xs text-text-secondary">
                            {c.canal === 'email' ? <Mail className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                            {c.canal} · {c.estado}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function Canal({ icono, etiqueta, activo, onClick }) {
    const { t } = useIdioma();

    return (
        <button onClick={onClick}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
                    activo
                        ? 'border-brand-blue bg-brand-blue/15 text-brand-light'
                        : 'border-gray-700 text-text-secondary'
                }`}>
            {icono}
            {etiqueta}
            <span className="text-xs">
                · {activo ? t('notificaciones.activado') : t('notificaciones.desactivado')}
            </span>
        </button>
    );
}

function Marco({ children }) {
    const { t } = useIdioma();

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-4xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                    </a>
                    <ThemeToggle />
                </div>
                <header className="mb-8">
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <Bell className="h-8 w-8 text-brand-blue" />
                        {t('notificaciones.titulo')}
                    </h1>
                    <p className="mt-1 text-text-secondary">
                        {t('notificaciones.subtitulo')}
                    </p>
                </header>
                {children}
            </div>
        </div>
    );
}
