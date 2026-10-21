/**
 * Tamanos de texto disponibles (HU de tamano de texto, criterio tecnico 1).
 *
 * Es un conjunto cerrado a proposito: cualquier otro valor se descarta
 * (criterio tecnico 10). La escala de cada uno esta en index.css
 * (--hf-escala-texto: 87.5%, 100% y 125%) y se aplica al font-size de
 * <html>. Como Tailwind trabaja en rem, crecen juntos el texto, los
 * espacios, los iconos y los anchos de la interfaz. Por eso un texto grande
 * no se sale de su boton: el boton crece con el.
 *
 * Los porcentajes son sobre el tamano que la persona tenga configurado en el
 * navegador (16 px por defecto), no sobre 16 px fijos: si ya lo agrando
 * ahi, esta opcion suma sobre eso en vez de pisarlo.
 */
export const TAMANOS_TEXTO = [
    { id: 'pequeno', etiqueta: 'Pequeño', descripcion: 'Más contenido en pantalla' },
    { id: 'normal', etiqueta: 'Normal', descripcion: 'Tamaño predeterminado' },
    { id: 'grande', etiqueta: 'Grande', descripcion: 'Lectura más cómoda' }
];

/** Criterio tecnico 9: sin preferencia guardada se usa el normal. */
export const TAMANO_PREDETERMINADO = 'normal';

export const CLAVE_TAMANO_TEXTO = 'human_firewall_text_size';

const IDS = new Set(TAMANOS_TEXTO.map((t) => t.id));

export const esTamanoValido = (valor) => typeof valor === 'string' && IDS.has(valor);

/** Lee la preferencia guardada. Un valor ausente o adulterado vuelve al predeterminado. */
export function leerTamanoGuardado() {
    if (typeof window === 'undefined') return TAMANO_PREDETERMINADO;
    try {
        const guardado = localStorage.getItem(CLAVE_TAMANO_TEXTO);
        if (esTamanoValido(guardado)) return guardado;
    } catch (e) {
        console.warn('No se pudo leer la preferencia de tamaño de texto:', e);
    }
    return TAMANO_PREDETERMINADO;
}

export function guardarTamano(tamano) {
    try {
        localStorage.setItem(CLAVE_TAMANO_TEXTO, tamano);
    } catch (e) {
        // Sin almacenamiento (modo privado, cuota llena) el cambio se aplica
        // igual en esta sesion; solo no se recuerda la proxima vez.
        console.warn('No se pudo guardar la preferencia de tamaño de texto:', e);
    }
}

/** Marca <html> con el tamano: el CSS de index.css hace el resto. */
export function aplicarTamanoAlDocumento(tamano) {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-text-size', tamano);
}
