import { defineConfig } from 'vite';

export default defineConfig({
  // Warum: der Semantic-Worker lädt transformers.js per dynamic import —
  // das klassische iife-Worker-Format kann keine Mehr-Chunk-Worker bündeln.
  worker: {
    format: 'es',
  },
  build: {
    // Warum: scripts/sw-precache.mjs leitet daraus die Boot-Assets für den
    // Service-Worker-Precache ab (Entry + statische Import-Hülle + CSS).
    manifest: true,
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