import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

/**
 * Root-absolute asset base (design.md D3): `static.ts` always serves `dist/`
 * at the server root and falls back to `index.html` for unresolvable paths,
 * so `index.html` must reference assets absolutely (`/assets/...`) — relative
 * URLs would 404 once the index-fallback serves a deep route like `/config`.
 *
 * The dev-only `/api` proxy (design.md D5) points at a locally running
 * `rasen config ui --no-open` instance. The proxy never touches the CLI: it
 * exists purely so `vite dev` can talk to a real config API without CORS.
 * Set VITE_DEV_API_TARGET / VITE_DEV_TOKEN to use it.
 */
export default defineConfig({
  plugins: [preact()],
  base: '/',
  resolve: {
    /**
     * App-wide preact/compat aliasing (pipeline-canvas-view design D2), proven
     * in `rasen/office-hours/canvas-demos/react-flow/`: only a module that
     * imports React resolves through this — today that is exactly
     * `@xyflow/react` (+ its internals) — every Preact-authored module in this
     * app imports `preact`/`preact/hooks` directly and is unaffected. This
     * keeps React Flow v12 on its native API without shipping a second React
     * runtime. Vitest inherits this via the shared vite config.
     */
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  build: {
    outDir: 'dist',
    // The build-split test (pipeline-canvas-view design D6) reads this to
    // assert the canvas chunk is not statically reachable from the entry
    // chunk — the manifest is the only artifact that names chunk imports.
    manifest: true,
  },
  server: {
    proxy: process.env.VITE_DEV_API_TARGET
      ? {
          '/api': {
            target: process.env.VITE_DEV_API_TARGET,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});
