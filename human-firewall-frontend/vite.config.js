import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // En produccion la interfaz y la API viajan por el mismo origen porque las
  // sirve el mismo proceso Express. En desarrollo se conserva el servidor de
  // Vite para no perder el hot reload, asi que hace falta un proxy que reenvie
  // /api al backend.
  //
  // Gracias a esto el codigo del frontend escribe siempre rutas relativas
  // ('/api/auth/login') y funciona igual en los dos modos, sin condicionales.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
