import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

/** The Studio dev server for e2e runs: port 5605 (allowed by the dev realm), API to the e2e engine. */
export default mergeConfig(base, defineConfig({
  server: {
    host: 'localhost',
    port: 5605,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.E2E_ENGINE_URL ?? 'http://localhost:5611', changeOrigin: true },
    },
  },
}));
