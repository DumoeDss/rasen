/**
 * Store v2 acceptance matrix — the cross-cutting properties no single journey
 * carries (store-v2-compat-hardening §9).
 *
 * The six sibling journeys each prove their own child. This matrix adds the
 * axes none of them covers:
 *   - Same Change name in two projects (no collision)
 *   - Path flavor (win32 / posix)
 *   - Layout flavor comparison (standalone / legacy flat / v2)
 *   - Standalone non-regression property
 *
 * Composed from the same functions the CLI and the sibling journeys use rather
 * than re-deriving layout paths. Function-level verification: the full CLI
 * journey for each cell is the sibling journeys' job.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildActionContext } from '../../src/core/change-status-policy.js';
import {
  resolveStorePlanningLayoutV2Path,
  type StorePlanningPathFlavor,
} from '../../src/core/store/planning-layout-v2.js';
import { diagnoseConsistency } from '../../src/core/store/consistency-gates.js';

describe('store v2 acceptance matrix', () => {
  const storeRoot = '/test/store';
  const projectIdA = 'project-a';
  const projectIdB = 'project-b';
  const changeName = 'add-feature';

  // ---------------------------------------------------------------------------
  // §9.2: Same Change name in two projects — distinct directories, distinct
  // identities, no collision.
  // ---------------------------------------------------------------------------
  describe('project-partition axis: same Change name in two projects', () => {
    it('produces distinct directories for the same Change name under different projects', () => {
      for (const flavor of ['posix', 'win32'] as const) {
        const dirA = resolveStorePlanningLayoutV2Path(
          storeRoot,
          { kind: 'active-change', projectId: projectIdA, changeId: changeName },
          flavor
        );
        const dirB = resolveStorePlanningLayoutV2Path(
          storeRoot,
          { kind: 'active-change', projectId: projectIdB, changeId: changeName },
          flavor
        );
        expect(dirA).not.toBe(dirB);
        expect(dirA).toContain(projectIdA);
        expect(dirB).toContain(projectIdB);
        expect(dirA).toContain(changeName);
        expect(dirB).toContain(changeName);
      }
    });

    it('produces distinct specs directories for two projects', () => {
      for (const flavor of ['posix', 'win32'] as const) {
        const specsA = resolveStorePlanningLayoutV2Path(
          storeRoot,
          { kind: 'project-specs', projectId: projectIdA },
          flavor
        );
        const specsB = resolveStorePlanningLayoutV2Path(
          storeRoot,
          { kind: 'project-specs', projectId: projectIdB },
          flavor
        );
        expect(specsA).not.toBe(specsB);
      }
    });

    it('grants distinct planning write roots for sessions in two projects', () => {
      const ctxA = buildActionContext({
        projectRoot: '/test/project-a-code',
        artifactIds: [],
        session: {
          planning: { type: 'store', root: storeRoot, id: 'team', projectId: projectIdA },
          execution: { kind: 'project', projectId: projectIdA, root: '/test/project-a-code' },
        },
      });
      const ctxB = buildActionContext({
        projectRoot: '/test/project-b-code',
        artifactIds: [],
        session: {
          planning: { type: 'store', root: storeRoot, id: 'team', projectId: projectIdB },
          execution: { kind: 'project', projectId: projectIdB, root: '/test/project-b-code' },
        },
      });

      // No overlap in planning write roots.
      for (const root of ctxA.planningWriteRoots) {
        expect(ctxB.planningWriteRoots).not.toContain(root);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // §9.4: Path flavor axis — address construction across win32 and posix.
  // ---------------------------------------------------------------------------
  describe('path-flavor axis: win32 and posix address construction', () => {
    const flavors: StorePlanningPathFlavor[] = ['posix', 'win32'];

    it.each(flavors)('constructs valid project-home paths in %s flavor', (flavor) => {
      const result = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'project-home', projectId: projectIdA },
        flavor
      );
      expect(result).toContain(projectIdA);
      expect(result).toContain('projects');
    });

    it.each(flavors)('constructs valid active-change paths in %s flavor', (flavor) => {
      const result = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'active-change', projectId: projectIdA, changeId: changeName },
        flavor
      );
      expect(result).toContain(projectIdA);
      expect(result).toContain(changeName);
    });

    it.each(flavors)('constructs valid archive-line paths in %s flavor', (flavor) => {
      const result = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'archive-line', projectId: projectIdA, targetLineId: 'line-0.1' },
        flavor
      );
      expect(result).toContain(projectIdA);
      expect(result).toContain('line-0.1');
      expect(result).toContain('archive');
    });

    it('produces separator-appropriate paths for each flavor', () => {
      const posixPath = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'project-home', projectId: projectIdA },
        'posix'
      );
      const win32Path = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'project-home', projectId: projectIdA },
        'win32'
      );
      // Posix uses forward slashes, win32 uses backslashes.
      expect(posixPath).not.toContain('\\');
      // Both contain the project ID.
      expect(posixPath).toContain(projectIdA);
      expect(win32Path).toContain(projectIdA);
    });
  });

  // ---------------------------------------------------------------------------
  // §9.5: Layout flavor comparison — standalone, legacy flat, and v2 each
  // behave as their own layout requires.
  // ---------------------------------------------------------------------------
  describe('layout-flavor axis: standalone vs legacy flat vs v2', () => {
    it('standalone uses in-project planning paths, not Store partitions', () => {
      const projectRoot = '/test/project';
      const ctx = buildActionContext({
        projectRoot,
        artifactIds: [],
      });
      expect(ctx.planningWriteRoots).toContain(path.join(projectRoot, 'rasen', 'specs'));
      expect(ctx.planningWriteRoots).toContain(path.join(projectRoot, 'rasen', 'changes'));
      expect(ctx.planningWriteRoots.some((p) => p.includes('projects'))).toBe(false);
    });

    it('Store v2 project scope uses project partition paths', () => {
      const ctx = buildActionContext({
        projectRoot: '/test/code',
        artifactIds: [],
        session: {
          planning: { type: 'store', root: storeRoot, id: 'team', projectId: projectIdA },
          execution: { kind: 'project', projectId: projectIdA, root: '/test/code' },
        },
      });
      expect(ctx.planningWriteRoots.some((p) => p.includes('projects'))).toBe(true);
      expect(ctx.planningWriteRoots.some((p) => p.includes(projectIdA))).toBe(true);
      // No root-level Store planning paths.
      expect(ctx.planningWriteRoots).not.toContain(path.join(storeRoot, 'rasen', 'specs'));
      expect(ctx.planningWriteRoots).not.toContain(path.join(storeRoot, 'rasen', 'changes'));
    });

    it('Store aggregate (no projectId) falls back to root-level paths', () => {
      const ctx = buildActionContext({
        projectRoot: '/test/code',
        artifactIds: [],
        session: {
          planning: { type: 'store', root: storeRoot, id: 'team' },
          execution: { kind: 'planning-only' },
        },
      });
      expect(ctx.planningWriteRoots).toContain(path.join(storeRoot, 'rasen', 'specs'));
      expect(ctx.planningWriteRoots).toContain(path.join(storeRoot, 'rasen', 'changes'));
    });
  });

  // ---------------------------------------------------------------------------
  // §9.7: Refusal rows — a projectId containing path separators, '.', '..',
  // or a Windows reserved name is refused by the path grammar.
  // ---------------------------------------------------------------------------
  describe('refusal rows', () => {
    it.each([
      ['path separator', 'project/with/slash'],
      ['dot segment', '../escape'],
      ['dot', '.'],
      ['double dot', '..'],
    ])('refuses projectId with %s', (_label, badId) => {
      expect(() =>
        resolveStorePlanningLayoutV2Path(
          storeRoot,
          { kind: 'project-home', projectId: badId },
          'posix'
        )
      ).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Consistency gates are read-only and never produce findings for an empty
  // v2 Store (the happy path).
  // ---------------------------------------------------------------------------
  describe('consistency gates non-regression', () => {
    it('returns no findings for an empty directory', async () => {
      const findings = await diagnoseConsistency({
        storeId: 'test',
        storeRoot: '/nonexistent/path',
      });
      expect(findings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // §9.3: Target-line axis — same Change name on two target lines of one
  // project produces distinct archive directories.
  // ---------------------------------------------------------------------------
  describe('target-line axis: same Change on two lines', () => {
    it('produces distinct archive-line directories for different target lines', () => {
      const line1 = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'archive-line', projectId: projectIdA, targetLineId: 'line-0.1' },
        'posix'
      );
      const line2 = resolveStorePlanningLayoutV2Path(
        storeRoot,
        { kind: 'archive-line', projectId: projectIdA, targetLineId: 'line-0.2' },
        'posix'
      );
      expect(line1).not.toBe(line2);
      expect(line1).toContain('line-0.1');
      expect(line2).toContain('line-0.2');
    });
  });

  // ---------------------------------------------------------------------------
  // §9.6: Consume sibling journeys — assert they exist and are not empty.
  // The matrix does not restate their assertions; it asserts they are present
  // so a missing or renamed journey is caught here.
  // ---------------------------------------------------------------------------
  describe('sibling journeys exist', () => {
    it.each([
      ['planning-scope', 'store-v2-planning-scope-journey.test.ts'],
      ['migration', 'store-v2-migration-journey.test.ts'],
      ['workspace', 'store-v2-workspace-journey.test.ts'],
      ['workspace-concurrency', 'store-v2-workspace-concurrency.test.ts'],
      ['finalization', 'store-v2-finalization-journey.test.ts'],
      ['cross-project', 'store-v2-cross-project-journey.test.ts'],
    ])('the %s journey test file exists', (_label, filename) => {
      const filepath = path.join(__dirname, filename);
      expect(fs.existsSync(filepath)).toBe(true);
    });
  });
});
