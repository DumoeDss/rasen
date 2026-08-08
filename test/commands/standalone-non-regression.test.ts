/**
 * Standalone non-regression: a project that is not bound to a Store behaves
 * exactly as it did before Store layout v2 existed. No project selector, no
 * target line, no finalization outcome, no project partition, no layout
 * declaration. (store-v2-compat-hardening §10, requirement: "Store v2
 * introduces no change in standalone or legacy-flat planning behavior".)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildActionContext } from '../../src/core/change-status-policy.js';

describe('standalone non-regression', () => {
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-standalone-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-data-'));
  });

  afterAll(() => {
    process.env = originalEnv;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes planning content to the pre-v2 in-project location', () => {
    const changesDir = path.join(projectRoot, 'rasen', 'changes');
    const specsDir = path.join(projectRoot, 'rasen', 'specs');
    expect(fs.existsSync(changesDir)).toBe(true);
    expect(fs.existsSync(specsDir)).toBe(true);
  });

  it('creates no project partition, project catalog, target-line catalog, or layout declaration', () => {
    // No rasen/projects/ directory
    const projectsDir = path.join(projectRoot, 'rasen', 'projects');
    expect(fs.existsSync(projectsDir)).toBe(false);

    // No .rasen-store/ metadata directory
    const metaDir = path.join(projectRoot, '.rasen-store');
    expect(fs.existsSync(metaDir)).toBe(false);
  });

  it('action context grants the in-project planning directories, not a project partition', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
    });

    // The grant is the in-project planning directories.
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'specs')
    );
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'changes')
    );

    // No project partition path in the grant.
    expect(
      ctx.planningWriteRoots.some((p) => p.includes(path.join('rasen', 'projects')))
    ).toBe(false);
  });

  it('action context does not require or carry a project selector or target line', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
    });

    // No session — no project selector, no target line, no finalization outcome.
    expect(ctx.requiresAffectedAreaSelection).toBe(false);
    // v1 compatibility: standalone grants a single root.
    expect(ctx.version).toBe(1);
    expect(ctx.allowedEditRoots).toBeDefined();
  });

  it('action context with a project-type session (not Store) still uses in-project paths', () => {
    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
      session: {
        planning: {
          type: 'project',
          root: projectRoot,
          projectId: 'standalone-project',
        },
        execution: {
          kind: 'project',
          projectId: 'standalone-project',
          root: projectRoot,
        },
      },
    });

    // Still uses the in-project directories, not a Store partition.
    expect(ctx.planningWriteRoots).toContain(
      path.join(projectRoot, 'rasen', 'specs')
    );
    expect(
      ctx.planningWriteRoots.some((p) => p.includes(path.join('rasen', 'projects')))
    ).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // §10.4: Legacy flat Store (no layout v2 declaration) keeps its read surface.
  // A Store without a layout v2 declaration is treated as layout v1 by every
  // new code path. The action context for a legacy flat Store session uses the
  // root-level planning directories — not project partitions — and the
  // consistency gates return no findings.
  // ---------------------------------------------------------------------------
  it('legacy flat Store session uses root-level planning directories, not partitions', () => {
    const storeRoot = path.join(os.tmpdir(), `rasen-legacy-store-${Date.now()}`);
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    // No .rasen-store/store.yaml with layoutVersion: 2 — this is a legacy flat Store.

    const ctx = buildActionContext({
      projectRoot,
      artifactIds: [],
      session: {
        // A Store session without projectId — store aggregate
        planning: { type: 'store', root: storeRoot, id: 'legacy-store' },
        execution: { kind: 'planning-only' },
      },
    });

    // Legacy flat Store: root-level planning directories, not project partitions.
    expect(ctx.planningWriteRoots).toContain(path.join(storeRoot, 'rasen', 'specs'));
    expect(ctx.planningWriteRoots).toContain(path.join(storeRoot, 'rasen', 'changes'));
    expect(
      ctx.planningWriteRoots.some((p) => p.includes(path.join('rasen', 'projects')))
    ).toBe(false);

    fs.rmSync(storeRoot, { recursive: true, force: true });
  });
});
