import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shipped viewer has no DOM/browser test harness in this repo (the Codex
 * runtime is likewise guarded structurally, not via jsdom). These static
 * assertions guard the `runtime: "zed"` dispatch and that its render path
 * wires the same cards and surfaces the Zed limits — without adding a jsdom
 * dependency disproportionate to a single self-contained HTML asset.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(__dirname, '..', '..', '..', '..', 'viewer', 'audit.html');

describe('viewer/audit.html — Zed runtime', () => {
  const html = fs.readFileSync(VIEWER, 'utf-8');

  it('dispatches runtime:"zed" to renderZed alongside claude/codex', () => {
    expect(html).toMatch(/runtime === 'zed'/);
    expect(html).toMatch(/renderZed\(j\)/);
    expect(html).toMatch(/function renderZed\(/);
  });

  it('renders Zed-appropriate totals, not Claude/Codex-only fields', () => {
    expect(html).toContain('function renderZedTiles');
    expect(html).toContain('function renderZedThreadTable');
    expect(html).toMatch(/rawTokens\.inputTokens/);
    expect(html).toMatch(/rawTokens\.cachedInputTokens/);
    expect(html).toMatch(/retainedRequests/);
    expect(html).toMatch(/cacheHitRatio/);
  });

  it('displays the Zed data limits disclosure alongside the data', () => {
    expect(html).toContain('function renderZedLimits');
    expect(html).toContain('Zed data limits');
    expect(html).toMatch(/reasoning-output or cache-write totals/);
    expect(html).toMatch(/parent_id-linked/);
  });

  it('keeps the composition and timeline cards Claude/Codex-only (hidden for zed)', () => {
    // The existing toggles hide these for any runtime that is not claude
    // (and not codex-with-timeline), which covers zed.
    expect(html).toMatch(/compositionCard'\)\.classList\.toggle\('hidden', runtime !== 'claude'\)/);
  });
});
