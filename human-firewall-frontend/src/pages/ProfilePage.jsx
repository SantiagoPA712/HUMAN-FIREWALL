import React, { useEffect, useState } from 'react';
import {
    ArrowLeft, UserCircle2, Pencil, Save, X, Lock, Mail, Shield, Users, CalendarDays,
    CheckCircle2, AlertTriangle, Info, Phone, Languages
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { ThemeToggle } from '../components/ThemeToggle';
import { api, getUsuarioActual } from '../lib/api';
import { formularioDesde, validarFormulario, cambiosRespectoDe } from '../lib/perfil';
import { useIdioma } from '../context/useIdioma';

// Los mapas guardan la CLAVE del texto, no el texto: asi se resuelven con t()
// en cada render y cambian de idioma solos.
const ROLES = ['admin', 'security', 'rh', 'manager', 'instructor', 'employee'];

// El nombre de cada idioma se escribe en ese idioma, asi que no se traduce.
const IDIOMAS = { es: 'Español', en: 'English' };

/**
 * Mi perfil (HU de perfil editable).
 *
 * Se consulta siempre desde el backend (GET /api/users/me) y no desde el
 * token: el token solo trae id y rol, y lo que se guardo tiene que verse al
 * volver (criterio de aceptacion 7).
 */
export default function ProfilePage() {
    const { t, idioma } = useIdioma();
    const [perfil, setPerfil] = useState(null);
    const [formulario, setFormulario] = useState(formularioDesde(null));
    const [editando, setEditando] = useState(false);
    const [errores, setErrores] = useState({});
    const [aviso, setAviso] = useState(null); // { tipo: 'exito' | 'info' | 'error', texto }
    const [guardando, setGuardando] = useState(false);
    const [errorDeCarga, setErrorDeCarga] = useState(null);
    const usuarioId = getUsuarioActual()?.id;

    const formatearFecha = (iso) => iso
        ? new Date(iso).toLocaleString(idioma, { day: '2-digit', month: 'long', year: 'numeric' })
        : '—';

    const nombreDeIdioma = (codigo) => IDIOMAS[codigo] || t('perfil.idioma_plataforma');
    const nombreDeRol = (rol) => (ROLES.includes(rol) ? t(`roles.${rol}`) : rol);

    useEffect(() => {
        if (!usuarioId) { window.location.href = '/login'; return; }

        api.get('/api/users/me')
            .then(({ data }) => {
                setPerfil(data);
                setFormulario(formularioDesde(data));
            })
            .catch((e) => setErrorDeCarga(e.response?.data?.msg || t('perfil.error_carga')));
    }, [usuarioId, t]);

    const { errores: erroresActuales, valores } = validarFormulario(formulario);
    const hayCambios = perfil && Object.keys(cambiosRespectoDe(perfil, valores)).length > 0;

    const cambiar = (campo) => (e) => {
        setFormulario((f) => ({ ...f, [campo]: e.target.value }));
        // El error de un campo se va en cuanto se corrige, sin esperar a guardar.
        setErrores((prev) => {
            if (!prev[campo]) return prev;
            const { [campo]: _, ...resto } = prev;
            return resto;
        });
    };

    // El formulario siempre arranca desde lo guardado, no desde lo que haya
    // quedado de una edicion anterior.
    const iniciarEdicion = () => {
        setFormulario(formularioDesde(perfil));
        setAviso(null);
        setErrores({});
        setEditando(true);
    };

    // Criterio de aceptacion 6: cancelar descarta lo que no se guardo. Antes
    // solo cerraba el formulario: lo escrito quedaba en el estado, volvia a
    // aparecer al pulsar "Editar perfil" y se podia guardar sin querer.
    const cancelar = () => {
        setFormulario(formularioDesde(perfil));
        setErrores({});
        setAviso(null);
        setEditando(false);
    };

    const guardar = async (e) => {
        e.preventDefault();
        setAviso(null);

        // Criterio de aceptacion 4: se avisa antes de enviar.
        if (Object.keys(erroresActuales).length > 0) {
            setErrores(erroresActuales);
            return;
        }

        // Criterio de aceptacion 5: sin cambios no hay solicitud.
        const cambios = cambiosRespectoDe(perfil, valores);
        if (Object.keys(cambios).length === 0) {
            setAviso({ tipo: 'info', texto: t('perfil.sin_cambios') });
            return;
        }

        setGuardando(true);
        try {
            const { data } = await api.patch('/api/users/me', cambios);
            setPerfil(data);
            setFormulario(formularioDesde(data));
            setEditando(false);
            // El backend manda su `msg` en espanol; aca se usa el del
            // diccionario para que siga al idioma de la pantalla. El caso lo
            // sigue decidiendo el servidor con `sin_cambios`.
            setAviso({
                tipo: data.sin_cambios ? 'info' : 'exito',
                texto: t(data.sin_cambios ? 'perfil.sin_cambios_servidor' : 'perfil.guardado')
            });
        } catch (err) {
            // Criterio de aceptacion 9: si no se guardo, no hay confirmacion.
            // El formulario queda como estaba para que no se pierda lo escrito.
            const cuerpo = err.response?.data;
            if (err.response?.status === 400 && Array.isArray(cuerpo?.errores)) {
                setErrores(Object.fromEntries(cuerpo.errores.map((x) => [x.campo, x.detalle])));
                setAviso({ tipo: 'error', texto: t('perfil.revisa_campos') });
            } else {
                setAviso({
                    tipo: 'error',
                    texto: cuerpo?.msg && err.response?.status !== 500
                        ? cuerpo.msg
                        : t('perfil.error_guardar')
                });
            }
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-3xl">
                <div className="mb-6 flex items-center justify-between">
                    <a href="/dashboard" className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                    </a>
                    <ThemeToggle />
                </div>

                <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-3 text-3xl font-bold">
                            <UserCircle2 className="h-8 w-8 text-brand-blue" />
                            {t('perfil.titulo')}
                        </h1>
                        <p className="mt-1 text-text-secondary">
                            {t('perfil.subtitulo')}
                        </p>
                    </div>
                    {perfil && !editando && (
                        <button
                            type="button"
                            onClick={iniciarEdicion}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-brand-light cursor-pointer"
                        >
                            <Pencil className="h-4 w-4" /> {t('perfil.editar')}
                        </button>
                    )}
                </header>

                {aviso && <Aviso {...aviso} onCerrar={() => setAviso(null)} />}

                {errorDeCarga && (
                    <Card className="border-l-4 border-l-red-500 p-6">
                        <p className="text-red-400">{errorDeCarga}</p>
                    </Card>
                )}

                {!errorDeCarga && !perfil && <p className="text-text-secondary">{t('comun.cargando')}</p>}

                {perfil && (
                    <>
                        <Card className="mb-6 p-6">
                            <h2 className="mb-1 text-lg font-bold">{t('perfil.datos_personales')}</h2>
                            <p className="mb-5 text-sm text-text-secondary">
                                {editando
                                    ? t('perfil.obligatorios')
                                    : t('perfil.puede_actualizar')}
                            </p>

                            {editando ? (
                                <form onSubmit={guardar} noValidate className="flex flex-col gap-5">
                                    <Campo
                                        id="full_name"
                                        etiqueta={t('perfil.nombre_completo_obligatorio')}
                                        icono={UserCircle2}
                                        error={errores.full_name && t(errores.full_name)}
                                    >
                                        <input
                                            id="full_name"
                                            type="text"
                                            maxLength={150}
                                            autoComplete="name"
                                            value={formulario.full_name}
                                            onChange={cambiar('full_name')}
                                            aria-invalid={!!errores.full_name}
                                            aria-describedby={errores.full_name ? 'full_name-error' : undefined}
                                            className={claseDeInput(errores.full_name)}
                                            placeholder={t('perfil.nombre_placeholder')}
                                        />
                                    </Campo>

                                    <Campo id="phone" etiqueta={t('perfil.telefono')} icono={Phone} error={errores.phone && t(errores.phone)} ayuda={t('perfil.telefono_ayuda')}>
                                        <input
                                            id="phone"
                                            type="tel"
                                            maxLength={30}
                                            autoComplete="tel"
                                            value={formulario.phone}
                                            onChange={cambiar('phone')}
                                            aria-invalid={!!errores.phone}
                                            aria-describedby={errores.phone ? 'phone-error' : undefined}
                                            className={claseDeInput(errores.phone)}
                                            placeholder={t('perfil.telefono_placeholder')}
                                        />
                                    </Campo>

                                    <Campo id="language" etiqueta={t('perfil.idioma_correos')} icono={Languages} error={errores.language && t(errores.language)}>
                                        <select
                                            id="language"
                                            value={formulario.language}
                                            onChange={cambiar('language')}
                                            className={claseDeInput(errores.language)}
                                        >
                                            <option value="">{t('perfil.idioma_plataforma')}</option>
                                            {Object.entries(IDIOMAS).map(([valor, texto]) => (
                                                <option key={valor} value={valor}>{texto}</option>
                                            ))}
                                        </select>
                                    </Campo>

                                    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-color pt-5">
                                        <button
                                            type="button"
                                            onClick={cancelar}
                                            disabled={guardando}
                                            className="inline-flex items-center gap-2 rounded-lg border border-border-color px-4 py-2 font-medium text-text-secondary transition-colors hover:bg-nav-hover hover:text-text-primary disabled:opacity-50 cursor-pointer"
                                        >
                                            <X className="h-4 w-4" /> {t('perfil.cancelar')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={guardando || !hayCambios}
                                            title={!hayCambios ? t('perfil.sin_cambios_titulo') : undefined}
                                            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                        >
                                            <Save className="h-4 w-4" />
                                            {guardando ? t('perfil.guardando') : t('perfil.guardar_cambios')}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                    <Dato icono={UserCircle2} etiqueta={t('perfil.nombre_completo')} valor={perfil.full_name} vacio={t('perfil.sin_registrar')} />
                                    <Dato icono={Phone} etiqueta={t('perfil.telefono')} valor={perfil.phone} vacio={t('perfil.sin_registrar')} />
                                    <Dato icono={Languages} etiqueta={t('perfil.idioma_correos')} valor={nombreDeIdioma(perfil.language)} />
                                </dl>
                            )}
                        </Card>

                        {/* Criterio de aceptacion 8: lo protegido se ve pero no se edita. */}
                        <Card className="p-6">
                            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
                                <Lock className="h-4 w-4 text-text-secondary" /> {t('perfil.datos_cuenta')}
                            </h2>
                            <p className="mb-5 text-sm text-text-secondary">
                                {t('perfil.datos_cuenta_ayuda')}
                            </p>
                            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                                <Dato icono={Mail} etiqueta={t('perfil.correo')} valor={perfil.email} />
                                <Dato icono={Shield} etiqueta={t('perfil.rol')} valor={nombreDeRol(perfil.role)} />
                                <Dato icono={Users} etiqueta={t('perfil.equipo')} valor={perfil.team_name} vacio={t('perfil.sin_equipo')} />
                                <Dato icono={CalendarDays} etiqueta={t('perfil.miembro_desde')} valor={formatearFecha(perfil.created_at)} />
                            </dl>
                        </Card>
                    </>
                )}
            </div>
        </div>
    );
}

const claseDeInput = (error) =>
    `w-full rounded-lg border bg-bg-card px-4 py-2.5 text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-1 transition-all ${
        error
            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
            : 'border-border-color focus:border-brand-blue focus:ring-brand-blue'
    }`;

function Campo({ id, etiqueta, icono, error, ayuda, children }) {
    const Icono = icono;
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Icono className="h-4 w-4 text-brand-blue" /> {etiqueta}
            </label>
            {children}
            {error ? (
                <p id={`${id}-error`} role="alert" className="flex items-start gap-1.5 text-sm text-red-500">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </p>
            ) : ayuda && <p className="text-xs text-text-secondary">{ayuda}</p>}
        </div>
    );
}

function Dato({ icono, etiqueta, valor, vacio = '—' }) {
    const Icono = icono;
    return (
        <div className="min-w-0">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <Icono className="h-3.5 w-3.5" /> {etiqueta}
            </dt>
            <dd className={`mt-1 break-words ${valor ? 'font-medium text-text-primary' : 'italic text-text-secondary'}`}>
                {valor || vacio}
            </dd>
        </div>
    );
}

const ESTILOS_AVISO = {
    exito: { clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500', icono: CheckCircle2 },
    info: { clase: 'border-brand-blue/40 bg-brand-blue/10 text-brand-blue', icono: Info },
    error: { clase: 'border-red-500/40 bg-red-500/10 text-red-500', icono: AlertTriangle }
};

function Aviso({ tipo, texto, onCerrar }) {
    const { t } = useIdioma();
    const { clase, icono: Icono } = ESTILOS_AVISO[tipo];
    return (
        <div role={tipo === 'error' ? 'alert' : 'status'} className={`mb-6 flex items-start gap-3 rounded-xl border p-4 ${clase}`}>
            <Icono className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex-1 font-medium">{texto}</p>
            <button type="button" onClick={onCerrar} aria-label={t('perfil.cerrar_aviso')} className="opacity-70 hover:opacity-100 cursor-pointer">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
