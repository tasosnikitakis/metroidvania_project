import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        worldEditor: resolve(__dirname, 'editor/world.html'),
        gameEditor: resolve(__dirname, 'editor/game.html'),
      },
    },
  },
});
