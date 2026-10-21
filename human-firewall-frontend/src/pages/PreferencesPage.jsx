import React, { useCallback, useEffect, useState } from 'react';
import {
    ArrowLeft, Languages, Check, AlertTriangle, Info, Monitor, Moon, Sun, Mail, Lock
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { api } from '../lib/api';
import { useIdioma } from '../context/useIdioma';
import { useTheme } from '../context/useTheme';

/**
 * Preferencias de la cuenta.
 *
 * Reune las dos HU de configuracion personal:
 *   - idioma de la plataforma,
 *   - correos que recibe el usuario (canales y categorias).
 *
 * Las de correo vivian dentro del centro de notificaciones. Se movieron aca
 * porque la HU las pide "desde la configuracion de mi cuenta": el centro es
 * para LEER resultados, no para configurar la cuenta. No se duplicaron: el
 * mismo control en dos pantallas son dos estados que se desincronizan.
 *
 * Todo es de cada usuario sobre si mismo, asi que no hay restriccion de rol.
 * El backend lo refuerza igual sacando el id del token: esta pantalla no manda
 * ningun userId, asi que no puede tocar la configuracion de otra persona.
 *
 * Nada de esto agrega backend: las rutas de preferencias de correo ya existian
 * de la HU de notificaciones por correo (criterios tecnicos 1, 3 y 8).
 */

/** Franja de aviso: confirmacion de guardado, fallo o error de carga. */
function Aviso({ datos, onClick }) {
    if (!datos) return null;
    return (
        <div
            role="status"
            onClick={onClick}
            className={`mt-4 flex cursor-pointer items-start gap-2 rounded-lg border px-4 py-3 text-sm ${datos.clase}`}
        >
            <datos.icono className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{datos.texto}</span>
        </div>
    );
}

/** Interruptor de encendido/apagado, con estado bloqueado para lo obligatorio. */
function Interruptor({ activo, onClick, disabled, etiquetaActivo, etiquetaInactivo }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={activo}
            disabled={disabled}
            onClick={onClick}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                activo
                    ? 'border-brand-blue bg-brand-blue/15 text-brand-light'
                    : 'border-border-color text-text-secondary hover:text-text-primary'
            }`}
        >
            {activo ? etiquetaActivo : etiquetaInactivo}
        </button>
    );
}

export default function PreferencesPage() {
    const {
        idioma, idiomas, porDefecto, usandoPorDefecto,
        guardando: guardandoIdioma, aviso: avisoIdioma, limpiarAviso, cambiarIdioma, t
    } = useIdioma();
    const { theme, setTheme } = useTheme();

    // --- correo ---
    const [canales, setCanales] = useState(null);
    const [correo, setCorreo] = useState(null);
    const [cargandoCorreo, setCargandoCorreo] = useState(true);
    const [avisoCorreo, setAvisoCorreo] = useState(null); // { tipo: 'ok'|'error'|'carga' }
    const [guardandoCorreo, setGuardandoCorreo] = useState(false);

    // No pone `cargando` en true al empezar: arranca en true y el reintento,
    // que es un manejador de evento y no un efecto, lo vuelve a levantar. Asi
    // el efecto de montaje no hace un setState sincrono.
    const cargar = useCallback(async () => {
        try {
            const [resCanales, resCorreo] = await Promise.all([
                api.get('/api/notifications/preferencias'),
                api.get('/api/notifications/correo/preferencias')
            ]);
            setCanales(resCanales.data.canales);
            setCorreo(resCorreo.data);
            setAvisoCorreo(null);
        } catch {
            // Criterio tecnico 7: tambien hay que avisar cuando no se pudo
            // RECUPERAR la configuracion, no solo cuando no se pudo guardar.
            setAvisoCorreo({ tipo: 'carga' });
        } finally {
            setCargandoCorreo(false);
        }
    }, []);

    useEffect(() => {
        // Carga inicial. El disable es el mismo que usan AuditLogsPage y
        // SecurityPanel para este caso: `cargar` es async, asi que sus
        // setState no corren de forma sincrona, pero el linter no lo ve.
        /* eslint-disable-next-line react-hooks/set-state-in-effect */
        cargar();
    }, [cargar]);

    /** Reintento manual tras un fallo de carga (criterio tecnico 7). */
    const reintentarCarga = () => {
        setCargandoCorreo(true);
        cargar();
    };

    /**
     * Enciende o apaga un canal entero (in-app / correo).
     *
     * El canal de correo apagado corta TODO correo opcional, por eso al
     * cambiarlo se recarga el bloque de categorias: lo que se puede tocar
     * depende de el.
     */
    const cambiarCanal = async (canal, valor) => {
        setGuardandoCorreo(true);
        try {
            const { data } = await api.patch('/api/notifications/preferencias', { [canal]: valor });
            setCanales(data.canales);
            if (canal === 'email') {
                const { data: prefs } = await api.get('/api/notifications/correo/preferencias');
                setCorreo(prefs);
            }
            setAvisoCorreo({ tipo: 'ok' });
        } catch {
            // Criterio de aceptacion 6: no se confirma una operacion fallida.
            // El estado local no se toca, asi que el interruptor vuelve solo a
            // como estaba de verdad en la cuenta.
            setAvisoCorreo({ tipo: 'error' });
        } finally {
            setGuardandoCorreo(false);
        }
    };

    /**
     * Enciende o apaga una categoria de correo.
     *
     * Las obligatorias ni siquiera ofrecen el control: el backend las rechaza
     * con 400, y mostrar un interruptor que no se puede mover seria mentirle
     * al usuario (criterio de aceptacion 9).
     */
    const cambiarCategoria = async (tipo, valor) => {
        setGuardandoCorreo(true);
        try {
            const { data } = await api.patch('/api/notifications/correo/preferencias', {
                tipos: { [tipo]: valor }
            });
            setCorreo(data);
            setAvisoCorreo({ tipo: 'ok' });
        } catch {
            setAvisoCorreo({ tipo: 'error' });
        } finally {
            setGuardandoCorreo(false);
        }
    };

    const nombreDe = (codigo) => idiomas.find(i => i.codigo === codigo)?.nombre || codigo;

    /**
     * Texto de una categoria de correo.
     *
     * La descripcion que manda el servidor esta en espanol: es un dato de
     * `email_notification_types`, no una cadena de interfaz. Se traduce por
     * codigo, y si aparece una categoria nueva que el diccionario todavia no
     * conoce se usa la del servidor: mejor en espanol que en blanco.
     */
    const describirCategoria = (categoria) => {
        const clave = `correo.cat_${categoria.tipo}`;
        const traducida = t(clave);
        return traducida === clave ? categoria.descripcion : traducida;
    };

    const AVISOS_IDIOMA = {
        ok: { icono: Check, texto: t('preferencias.guardado'), clase: 'border-green-500/40 bg-green-500/10 text-green-400' },
        error: { icono: AlertTriangle, texto: t('preferencias.no_se_pudo_guardar'), clase: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
        no_disponible: { icono: Info, texto: t('preferencias.idioma_no_disponible'), clase: 'border-brand-blue/40 bg-brand-blue/10 text-brand-light' }
    };
    const AVISOS_CORREO = {
        ok: { icono: Check, texto: t('correo.guardado'), clase: 'border-green-500/40 bg-green-500/10 text-green-400' },
        error: { icono: AlertTriangle, texto: t('correo.no_se_pudo_guardar'), clase: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
        carga: { icono: AlertTriangle, texto: t('correo.no_se_pudo_cargar'), clase: 'border-red-500/40 bg-red-500/10 text-red-400' }
    };

    const correoEncendido = canales?.email !== false;

    return (
        <div className="min-h-screen bg-bg-deep p-6 text-text-primary md:p-10">
            <div className="mx-auto max-w-3xl">
                <a href="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
                    <ArrowLeft className="h-4 w-4" /> {t('nav.volver_al_panel')}
                </a>

                <h1 className="flex items-center gap-3 text-3xl font-bold">
                    <Languages className="h-8 w-8 text-brand-blue" />
                    {t('preferencias.titulo')}
                </h1>
                <p className="mt-1 text-text-secondary">{t('preferencias.subtitulo')}</p>

                {/* ---------------------------------------------------------
                    Idioma de la plataforma
                    --------------------------------------------------------- */}
                <Card className="mt-8">
                    <h2 className="flex items-center gap-2 text-xl font-bold">
                        <Languages className="h-5 w-5 text-brand-blue" />
                        {t('preferencias.idioma_titulo')}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary">{t('preferencias.idioma_ayuda')}</p>

                    {/* Lista de opciones, no un <select>: con dos o tres idiomas
                        se ven todas de una y el estado actual no queda escondido
                        detras de un desplegable. */}
                    <div
                        role="radiogroup"
                        aria-label={t('preferencias.idioma_titulo')}
                        className="mt-5 flex flex-col gap-2"
                    >
                        {idiomas.map(opcion => {
                            const activo = opcion.codigo === idioma;
                            return (
                                <button
                                    key={opcion.codigo}
                                    role="radio"
                                    aria-checked={activo}
                                    disabled={guardandoIdioma}
                                    onClick={() => cambiarIdioma(opcion.codigo)}
                                    className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                                        activo
                                            ? 'border-brand-blue bg-brand-blue/10 text-brand-light'
                                            : 'border-border-color text-text-secondary hover:border-brand-blue/50 hover:text-text-primary'
                                    }`}
                                >
                                    <span className="flex items-center gap-3">
                                        <span className="font-semibold">{opcion.nombre}</span>
                                        <span className="font-mono text-xs uppercase opacity-60">{opcion.codigo}</span>
                                        {opcion.codigo === porDefecto && (
                                            <span className="rounded border border-border-color bg-nav-hover px-2 py-0.5 text-[11px] text-text-secondary">
                                                {t('preferencias.por_defecto_etiqueta')}
                                            </span>
                                        )}
                                    </span>
                                    {activo && <Check className="h-5 w-5 shrink-0" />}
                                </button>
                            );
                        })}

                        {/* Volver a "sin preferencia propia".
                            El <select> que esta pantalla reemplazo tenia esta
                            opcion y hay que conservarla: no es lo mismo elegir
                            espanol que no elegir nada. Quien no elige nada
                            sigue a la plataforma si esta cambia su defecto.
                            Solo se ofrece si hoy hay una preferencia fijada. */}
                        {!usandoPorDefecto && (
                            <button
                                type="button"
                                disabled={guardandoIdioma}
                                onClick={() => cambiarIdioma(null)}
                                className="mt-1 rounded-lg border border-dashed border-border-color px-4 py-3 text-left text-sm text-text-secondary transition-colors hover:border-brand-blue/50 hover:text-text-primary disabled:opacity-60"
                            >
                                <span className="font-semibold">{t('preferencias.usar_por_defecto')}</span>
                                <span className="mt-0.5 block text-xs">{t('preferencias.usar_por_defecto_ayuda')}</span>
                            </button>
                        )}
                    </div>

                    <p className="mt-4 text-xs text-text-secondary">
                        {t('preferencias.idioma_actual')}: <strong className="text-text-primary">{nombreDe(idioma)}</strong>
                        {guardandoIdioma && <span className="ml-2">· {t('comun.guardando')}</span>}
                    </p>

                    {usandoPorDefecto && !avisoIdioma && (
                        <p className="mt-1 text-xs text-text-secondary">{t('preferencias.usando_por_defecto')}</p>
                    )}

                    <Aviso datos={avisoIdioma ? AVISOS_IDIOMA[avisoIdioma.tipo] : null} onClick={limpiarAviso} />
                </Card>

                {/* ---------------------------------------------------------
                    Correos (HU de preferencias de correo)
                    --------------------------------------------------------- */}
                <Card className="mt-6">
                    <h2 className="flex items-center gap-2 text-xl font-bold">
                        <Mail className="h-5 w-5 text-brand-blue" />
                        {t('correo.titulo')}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary">{t('correo.ayuda')}</p>

                    {cargandoCorreo ? (
                        <p className="mt-5 text-sm text-text-secondary">{t('comun.cargando')}</p>
                    ) : (
                        <>
                            {/* Canales: el de correo manda sobre todas las categorias */}
                            {canales && (
                                <div className="mt-6">
                                    <h3 className="text-sm font-semibold">{t('correo.canal_titulo')}</h3>
                                    <p className="mt-1 text-xs text-text-secondary">{t('correo.canal_ayuda')}</p>

                                    <div className="mt-3 flex flex-col gap-2">
                                        {[
                                            { clave: 'in_app', icono: Monitor, etiqueta: t('correo.canal_app') },
                                            { clave: 'email', icono: Mail, etiqueta: t('correo.canal_correo') }
                                        ].map(canal => (
                                            <div
                                                key={canal.clave}
                                                className="flex items-center justify-between gap-3 rounded-lg border border-border-color px-4 py-3"
                                            >
                                                <span className="flex items-center gap-2 text-sm">
                                                    <canal.icono className="h-4 w-4 text-text-secondary" />
                                                    {canal.etiqueta}
                                                </span>
                                                <Interruptor
                                                    activo={canales[canal.clave] !== false}
                                                    disabled={guardandoCorreo}
                                                    onClick={() => cambiarCanal(canal.clave, canales[canal.clave] === false)}
                                                    etiquetaActivo={t('correo.activado')}
                                                    etiquetaInactivo={t('correo.desactivado')}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Categorias (criterios de aceptacion 1, 2 y 9) */}
                            {correo && (
                                <div className="mt-6">
                                    <h3 className="text-sm font-semibold">{t('correo.categorias_titulo')}</h3>

                                    {!correoEncendido && (
                                        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                                            {t('correo.canal_apagado')}
                                        </p>
                                    )}

                                    <div className="mt-3 flex flex-col gap-2">
                                        {correo.tipos.length === 0 && (
                                            <p className="text-sm text-text-secondary">{t('correo.sin_categorias')}</p>
                                        )}

                                        {correo.tipos.map(categoria => (
                                            <div
                                                key={categoria.tipo}
                                                className="flex items-center justify-between gap-3 rounded-lg border border-border-color px-4 py-3"
                                            >
                                                <span className="flex items-start gap-2 text-sm">
                                                    {categoria.critico
                                                        ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                                        : <Mail className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />}
                                                    <span>
                                                        {describirCategoria(categoria)}
                                                        {categoria.critico && (
                                                            <span className="mt-0.5 block text-xs text-text-secondary">
                                                                {t('correo.obligatorio_ayuda')}
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>

                                                {categoria.critico ? (
                                                    <span className="shrink-0 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                                                        {t('correo.obligatorio')}
                                                    </span>
                                                ) : (
                                                    <Interruptor
                                                        activo={categoria.habilitado}
                                                        disabled={guardandoCorreo || !correoEncendido}
                                                        onClick={() => cambiarCategoria(categoria.tipo, !categoria.habilitado)}
                                                        etiquetaActivo={t('correo.activado')}
                                                        etiquetaInactivo={t('correo.desactivado')}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* El idioma de los correos es el mismo de la plataforma: una
                                        sola preferencia, para que no haya dos que se contradigan. */}
                                    <p className="mt-4 text-xs text-text-secondary">
                                        {t('correo.idioma_compartido')}
                                    </p>
                                </div>
                            )}
                        </>
                    )}

                    <Aviso
                        datos={avisoCorreo ? AVISOS_CORREO[avisoCorreo.tipo] : null}
                        onClick={() => (avisoCorreo?.tipo === 'carga' ? reintentarCarga() : setAvisoCorreo(null))}
                    />
                </Card>

                {/* ---------------------------------------------------------
                    Tema: preferencia del navegador, no de la cuenta
                    --------------------------------------------------------- */}
                <Card className="mt-6">
                    <h2 className="flex items-center gap-2 text-xl font-bold">
                        <Monitor className="h-5 w-5 text-brand-blue" />
                        {t('preferencias.tema_titulo')}
                    </h2>
                    <p className="mt-1 text-sm text-text-secondary">{t('preferencias.tema_ayuda')}</p>

                    <div className="mt-5 flex gap-2">
                        {[
                            { valor: 'light', icono: Sun, etiqueta: t('preferencias.tema_claro') },
                            { valor: 'dark', icono: Moon, etiqueta: t('preferencias.tema_oscuro') }
                        ].map(opcion => (
                            <button
                                key={opcion.valor}
                                onClick={() => setTheme(opcion.valor)}
                                aria-pressed={theme === opcion.valor}
                                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
                                    theme === opcion.valor
                                        ? 'border-brand-blue bg-brand-blue/10 text-brand-light'
                                        : 'border-border-color text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                <opcion.icono className="h-4 w-4" />
                                {opcion.etiqueta}
                            </button>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}
