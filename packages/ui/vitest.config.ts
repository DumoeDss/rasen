import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Separate from vite.config.ts (design.md D9): default environment is
 * 'node' since most tests are pure-logic (grouping, client, token handling)
 * with mocked fetch; individual files opt into jsdom via a
 * `// @vitest-environment jsdom` docblock only where a DOM is unavoidable.
 */
export default defineConfig({
  plugins: [preact()],
  // Mirrors vite.config.ts's app-wide preact/compat aliasing (pipeline-canvas-view
  // design D2) so a test that imports `@xyflow/react` (or anything importing
  // React) resolves the same way it does under `vite build`/`vite dev`.
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
