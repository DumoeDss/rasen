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
  build: {
    outDir: 'dist',
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
