import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { IdiomaContext } from './IdiomaContextDef';
import { api, getUsuarioActual } from '../lib/api';
import { traducir, hayDiccionario, DICCIONARIOS, IDIOMA_POR_DEFECTO } from '../i18n';

/**
 * Idioma de la interfaz.
 *
 * Donde vive la preferencia, y por que en dos lados a la vez:
 *
 *   - `users.language` en la base es la FUENTE DE VERDAD. Es lo que hace que
 *     la preferencia sobreviva a cerrar sesion y a cambiar de computador
 *     (criterio de aceptacion 4), y lo que permite que los correos salgan en
 *     el mismo idioma que la pantalla, porque los manda el backend.
 *   - localStorage es solo una COPIA para que la primera pintura ya salga en
 *     el idioma correcto. Sin ella la pantalla aparece en espanol y cambia
 *     sola medio segundo despues, cuando responde el perfil.
 *
 * Si las dos difieren, gana la base: el navegador puede tener la copia vieja
 * de otra sesion, la cuenta no.
 */

const CLAVE_LOCAL = 'human_firewall_idioma';

/** Idioma guardado en este navegador, si es uno para el que hay textos. */
function idiomaGuardado() {
    if (typeof window === 'undefined') return IDIOMA_POR_DEFECTO;
    try {
        const guardado = localStorage.getItem(CLAVE_LOCAL);
        if (guardado && hayDiccionario(guardado)) return guardado;
    } catch (e) {
        // Modo privado, almacenamiento lleno o bloqueado por el navegador.
        console.warn('No se pudo leer el idioma guardado:', e);
    }
    // Criterio de aceptacion 5: sin preferencia, el idioma por defecto.
    return IDIOMA_POR_DEFECTO;
}

function guardarLocal(codigo) {
    try {
        localStorage.setItem(CLAVE_LOCAL, codigo);
    } catch (e) {
        console.warn('No se pudo guardar el idioma en este navegador:', e);
    }
}

/** `lang` del documento: lectores de pantalla y correctores lo usan. */
function aplicarAlDocumento(codigo) {
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', codigo);
    }
}

// Antes de montar React, para que no haya un parpadeo de idioma.
if (typeof window !== 'undefined') {
    aplicarAlDocumento(idiomaGuardado());
}

/** Catalogo local, usado mientras no haya sesion o si la API no responde. */
const catalogoLocal = () =>
    Object.keys(DICCIONARIOS).map(codigo => ({
        codigo,
        nombre: codigo === 'es' ? 'Español' : codigo === 'en' ? 'English' : codigo
    }));

export function IdiomaProvider({ children }) {
    const [idioma, setIdioma] = useState(idiomaGuardado);
    const [idiomas, setIdiomas] = useState(catalogoLocal);
    const [porDefecto, setPorDefecto] = useState(IDIOMA_POR_DEFECTO);

    // `null` cuando el usuario no configuro nada: la interfaz usa el idioma
    // por defecto de la plataforma, pero no es lo mismo que haber elegido ese.
    const [configurado, setConfigurado] = useState(null);

    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState(null); // { tipo: 'ok'|'error'|'no_disponible' }

    // Evita avisar sobre una respuesta que llego despues de otro cambio.
    const cambioEnCurso = useRef(0);

    /**
     * Trae de la cuenta el idioma y el catalogo.
     *
     * Las dos llamadas van juntas y ninguna rompe la pantalla si falla: sin
     * catalogo se usa el local, y sin perfil se sigue con la copia del
     * navegador. Que no cargue la preferencia es molesto; que la aplicacion
     * no abra, no.
     */
    useEffect(() => {
        if (!getUsuarioActual()) return;
        let vigente = true;

        (async () => {
            try {
                const { data } = await api.get('/api/users/idiomas');
                if (!vigente || !Array.isArray(data?.idiomas)) return;

                // Un idioma que la plataforma declara pero para el que no hay
                // textos no se ofrece: elegirlo dejaria la pantalla en espanol
                // sin explicar por que.
                const conTextos = data.idiomas.filter(i => hayDiccionario(i.codigo));
                if (conTextos.length > 0) setIdiomas(conTextos);
                if (data.por_defecto) setPorDefecto(data.por_defecto);
            } catch (e) {
                console.warn('No se pudo leer el catalogo de idiomas:', e.message);
            }

            try {
                const { data } = await api.get('/api/users/me');
                if (!vigente) return;

                setConfigurado(data?.language ?? null);

                // La cuenta manda sobre la copia del navegador.
                if (data?.language && hayDiccionario(data.language)) {
                    setIdioma(data.language);
                    guardarLocal(data.language);
                    aplicarAlDocumento(data.language);
                }
            } catch (e) {
                console.warn('No se pudo leer el idioma de la cuenta:', e.message);
            }
        })();

        return () => { vigente = false; };
    }, []);

    /**
     * Cambia el idioma de la interfaz y lo guarda en la cuenta.
     *
     * `null` significa "sin preferencia propia": la interfaz pasa al idioma
     * por defecto de la plataforma y la cuenta deja de fijar uno. No es lo
     * mismo que elegir ese idioma a mano: si manana la plataforma cambia su
     * defecto, quien esta en null lo sigue y quien lo eligio no.
     *
     * El orden importa: primero se aplica en pantalla y despues se guarda.
     *
     *   - Criterio tecnico 4: el cambio tiene que verse ya, no cuando
     *     conteste el servidor.
     *   - Criterio tecnico 9: si guardar falla, el usuario NO pierde la
     *     seleccion; se le avisa que no quedo guardada para la proxima vez.
     *
     * Criterio de aceptacion 8 y tecnico 10: no se manda ningun userId. El
     * backend lo saca del token, asi que esta pantalla no puede tocar las
     * preferencias de otra persona ni equivocandose.
     */
    const cambiarIdioma = useCallback(async (codigo) => {
        const alPorDefecto = codigo === null;
        const efectivo = alPorDefecto ? porDefecto : codigo;

        const disponible = idiomas.some(i => i.codigo === efectivo) && hayDiccionario(efectivo);

        // Criterio de aceptacion 6: un idioma que no esta disponible no cambia
        // nada; se mantiene el actual y se explica.
        if (!disponible) {
            setAviso({ tipo: 'no_disponible' });
            return false;
        }

        if (efectivo === idioma && configurado === (alPorDefecto ? null : codigo)) {
            setAviso(null);
            return true;
        }

        const turno = ++cambioEnCurso.current;

        // Lo que habia antes, para poder volver si el backend lo rechaza.
        const idiomaPrevio = idioma;
        const configuradoPrevio = configurado;

        setIdioma(efectivo);
        guardarLocal(efectivo);
        aplicarAlDocumento(efectivo);
        setAviso(null);
        setGuardando(true);

        try {
            const { data } = await api.patch('/api/users/me', { language: alPorDefecto ? null : codigo });
            if (turno !== cambioEnCurso.current) return true; // llego tarde
            setConfigurado(alPorDefecto ? null : (data?.language ?? codigo));
            setAviso({ tipo: 'ok' });
            return true;
        } catch (e) {
            if (turno !== cambioEnCurso.current) return false;
            // El backend valida contra su propia lista: si la rechaza, el
            // idioma no esta habilitado en el sistema (criterio tecnico 7).
            const rechazado = e.response?.status === 400;

            if (rechazado) {
                // Criterio de aceptacion 6: un idioma que el sistema no tiene
                // habilitado NO cambia nada. El catalogo que llena esta
                // pantalla sale del mismo backend, asi que llegar aca
                // significa que los dos no coinciden (un idioma que se
                // deshabilito con la pantalla abierta, por ejemplo). Se
                // deshace lo que se habia aplicado optimistamente y se
                // explica, en vez de dejar la interfaz en un idioma que la
                // cuenta no acepta.
                setIdioma(idiomaPrevio);
                guardarLocal(idiomaPrevio);
                aplicarAlDocumento(idiomaPrevio);
                setConfigurado(configuradoPrevio);
                setAviso({ tipo: 'no_disponible' });
                return false;
            }

            // Criterio tecnico 9: si solo fallo el guardado, NO se pierde la
            // seleccion; se avisa que no quedo guardada para la proxima vez.
            setAviso({ tipo: 'error' });
            return false;
        } finally {
            if (turno === cambioEnCurso.current) setGuardando(false);
        }
    }, [idioma, idiomas, configurado, porDefecto]);

    const limpiarAviso = useCallback(() => setAviso(null), []);

    /**
     * `t('nav.desafios')`, o con variables: `t('nivel.faltan_puntos', { puntos: 40 })`.
     *
     * Se recrea cuando cambia el idioma, y eso es justo lo que hace que todas
     * las pantallas se repinten solas (criterio tecnico 4 y de aceptacion 7):
     * no hay que avisarle a cada componente.
     */
    const t = useCallback(
        (clave, variables) => traducir(idioma, clave, variables),
        [idioma]
    );

    const value = useMemo(() => ({
        idioma,
        idiomas,
        porDefecto,
        configurado,
        usandoPorDefecto: configurado === null,
        guardando,
        aviso,
        limpiarAviso,
        cambiarIdioma,
        t
    }), [idioma, idiomas, porDefecto, configurado, guardando, aviso, limpiarAviso, cambiarIdioma, t]);

    return <IdiomaContext.Provider value={value}>{children}</IdiomaContext.Provider>;
}

export default IdiomaProvider;
