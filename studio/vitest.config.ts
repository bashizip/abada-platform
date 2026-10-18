import path from 'path';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig({
  ...viteConfig,
  server: {
    ...viteConfig.server,
    // Layout tests read the engine's APL fixtures and the examples (`?raw`).
    fs: { allow: [path.resolve(import.meta.dirname, '..')] },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // The design-token test reads index.css as text (`?raw`); keep it intact.
    css: { include: [/src\/index\.css/] },
    // Timing tests (`*.perf.test.tsx`) run alone, after every other file, so
    // parallel workers do not compete with them for the CPU.
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], exclude: ['src/**/*.perf.test.tsx', 'node_modules/**'] },
      },
      { extends: true, test: { name: 'perf', include: ['src/**/*.perf.test.tsx'], sequence: { groupOrder: 1 } } },
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  },
});
