import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

/** GitHub Pages serves this project from https://mustafaobaidd1.github.io/deep-focus-earthquakes/ */
export const REPO = 'deep-focus-earthquakes';

export default defineConfig({
  // Same base path in dev, preview and production, so path bugs show up locally.
  base: `/${REPO}/`,
  plugins: [svelte()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is one intentional, lazily loaded chunk (~140 kB gzip).
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  server: { port: 5309, strictPort: true },
  preview: { port: 5409, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
