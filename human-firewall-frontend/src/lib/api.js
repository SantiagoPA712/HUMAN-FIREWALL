import axios from 'axios';

/**
 * Cliente HTTP unico de la aplicacion.
 *
 * Antes cada pagina escribia 'http://localhost:3000' a mano (estaba repetido
 * en 6 archivos), asi que la app no se podia desplegar en ningun otro lado.
 * Ahora la URL sale de VITE_API_URL, definida en .env.
 */
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL: API_URL });

// Adjunta el token en cada request sin tener que repetirlo en cada llamada.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Si el token venció, vuelve al login en lugar de dejar la pantalla rota.
api.interceptors.response.use(
    (res) => res,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            if (!window.location.pathname.startsWith('/login')) {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

/**
 * Lee el payload del JWT guardado. El backend firma { id, role }.
 * Solo sirve para pintar la interfaz: la autorizacion real la valida el backend.
 */
export function getUsuarioActual() {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
            atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
        );
        const payload = JSON.parse(json);
        return { id: payload.id, role: payload.role };
    } catch {
        return null;
    }
}

export default api;
