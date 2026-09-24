/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT ?? '8787';

export default defineConfig({
  plugins: [react()],
  server: {
    // Браузер ходит только на свой origin (/api/*), Vite проксирует на Node-сервер.
    // Никакого CORS и никакого ключа на клиенте.
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
