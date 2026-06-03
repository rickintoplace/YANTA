import { defineConfig } from 'vite';

export default defineConfig({
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