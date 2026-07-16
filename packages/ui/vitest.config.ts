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
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
