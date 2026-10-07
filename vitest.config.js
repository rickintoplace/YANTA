import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    // Sync scenarios boot several simulated devices; give them room.
    testTimeout: 30_000,
  },
});
