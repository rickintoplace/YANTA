import { defineConfig } from 'vite';

/*
  Excalidraw lists every font twice: under window.EXCALIDRAW_ASSET_PATH (our
  self-hosted copy, see scripts/copy-excalidraw-assets.mjs) and under a
  hard-coded esm.sh fallback. Our CSP rightly blocks esm.sh, so Chrome logged
  a CSP violation per font face on every drawing — dozens of red errors — and
  a font missing locally would have tried a third-party host. The fallback
  points at our own copy instead — as an absolute URL, because Excalidraw
  uses it as the base of new URL().
*/
function selfHostedExcalidrawFonts() {
  return {
    name: 'yanta-self-hosted-excalidraw-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@excalidraw/excalidraw') || !code.includes('esm.sh/')) return null;

      const next = code.replace(/`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/(?:prod|dev)\/`/g, '(location.origin + "/excalidraw-assets/")');
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [selfHostedExcalidrawFonts()],
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
        /*
          Warum konfigurierbar: public/landing-gate.js ist eine unverarbeitete
          Datei und kann import.meta.env nicht lesen, postet ihren Funnel-Beacon
          also fest auf /cloud-api. Ohne diesen Override liefe der Beacon im
          lokalen Test gegen den Produktions-Worker.
        */
        target:
          process.env.YANTA_CLOUD_PROXY_TARGET ||
          'https://yanta-cloud.rickintoplace.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cloud-api/, ''),
      },
    },
  },
});