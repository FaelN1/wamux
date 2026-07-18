import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, o painel chama /api relativo; o Vite faz proxy para o gateway,
// evitando CORS (mesmo comportamento do nginx em produção).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.WAMUX_API ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      // WebSocket de eventos (tempo real do Inbox) — EventsWsGateway em
      // /events, fora de /api. `ws: true` faz o Vite tratar o upgrade.
      '/events': {
        target: process.env.WAMUX_API ?? 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
