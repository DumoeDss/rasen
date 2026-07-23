/**
 * Build-split assertion (pipeline-canvas-view design D6, task 5.3): after a
 * real `vite build`, the entry chunk's STATIC import graph must not reach the
 * canvas module — only a `dynamicImports` edge is allowed, which is exactly
 * what `preact-iso`'s `lazy()` produces at the route boundary (app.tsx). Runs
 * a real build into a scratch `outDir` (kept out of `dist/` so it never
 * collides with a developer's own build) and reads Vite's own manifest,
 * walking ONLY `imports` (never `dynamicImports`) from the HTML entry.
 * Filesystem paths use `path.join` (Windows-safe); manifest KEYS are always
 * POSIX-style source paths from Vite itself, matched as plain strings.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}

type Manifest = Record<string, ManifestChunk>;

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join('test-dist', 'build-split');

describe('canvas chunk build split', () => {
  it('is reachable only via a dynamicImport from the entry, never a static import', async () => {
    await build({
      root: ROOT,
      configFile: path.join(ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir: OUT_DIR, manifest: true },
    });

    const manifestPath = path.join(ROOT, OUT_DIR, '.vite', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
    expect(entryKey).toBeDefined();

    // Vite's manifest keys are always POSIX-style source paths regardless of
    // platform (`src/canvas/PipelineCanvasPage.tsx`) — no `path.join` here,
    // that would produce a backslash on Windows that never matches.
    const canvasKey = Object.keys(manifest).find((key) => key.includes('canvas/PipelineCanvasPage'));
    expect(canvasKey).toBeDefined();

    // BFS over STATIC imports only, starting at the entry.
    const reachable = new Set<string>();
    const queue = [entryKey!];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const dep of manifest[key]?.imports ?? []) queue.push(dep);
    }

    expect(reachable.has(canvasKey!)).toBe(false);
    // Confirm the edge exists at all, as a dynamic import — otherwise this
    // test would pass vacuously if the canvas module were dropped entirely.
    expect(manifest[entryKey!].dynamicImports ?? []).toContain(canvasKey);

    rmSync(path.join(ROOT, 'test-dist'), { recursive: true, force: true });
  }, 30_000);
});
