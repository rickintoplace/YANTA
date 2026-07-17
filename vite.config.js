import { defineConfig } from 'vite';

export default defineConfig({
  // Warum: der Semantic-Worker lädt transformers.js per dynamic import —
  // das klassische iife-Worker-Format kann keine Mehr-Chunk-Worker bündeln.
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      '/cloud-api': {
        target: 'https://yanta-cloud.rickintoplace.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cloud-api/, ''),
      },
    },
  },
});