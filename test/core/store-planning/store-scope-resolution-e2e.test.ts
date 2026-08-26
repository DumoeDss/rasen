/**
 * `store-scope-resolution` — the three refusals reproduced against a real
 * Store-v2 workspace pair on 2026-08-26, pinned end to end.
 *
 * Every seat here is a REAL git checkout: an integration Store checkout, a
 * linked planning worktree carrying the marker, and a linked execution
 * worktree carrying the association. The refusals this change fixes are all
 * consequences of what is actually on disk in such a pair — a committed
 * store-root `rasen/config.yaml` whose projectId belongs to no catalog, a
 * registry entry pointing at the main checkout while the caller stands in a
 * worktree, and a catalog that no official flow ever marks `bound` — so a
 * fixture-driven double would prove none of them.
 *
 * Per-test timeouts are explicit: the 30s default passes solo and fails under
 * parallel load, where the failure then reads as a broken assertion rather
 * than as the timeout it is.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlanningScopeError, StorePlanning } from '../../../src/core/store-planning/index.js';
import { findRegisteredStoreAtRoot } from '../../../src/core/store/identity.js';
import type { StoreWorkspace } from '../../../src/core/store/workspace/module.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'document-multi-project-issues';
/**
 * The projectId `store setup` mints into a Store's own committed root config.
 * It is a member of no project catalog — that is the whole point of the D1
 * fixture, and it is exactly the shape of `a7c28fc7-…` in `rasen-issue-store`.
 */
const ORPHAN_ROOT_PROJECT_ID = 'a7c28fc7-3091-41eb-84c4-af737bfcce97';

const REAL_GIT_TIMEOUT_MS = 120_000;

function diagnosticCode(error: unknown): string {
  if (error instanceof PlanningScopeError) return error.diagnostic.code;
  throw error;
}

function diagnosticMessage(error: unknown): string {
  if (error instanceof PlanningScopeError) return error.diagnostic.message;
  throw error;
}

describe('store scope resolution from a real workspace pair', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;

  async function preparePair(): Promise<void> {
    const workspace: StoreWorkspace = f.workspace();
    const plan = await workspace.plan({
      store: f.storeId,
      project: PROJECT,
      targetLine: LINE,
      changeId: CHANGE,
      planningWorktree,
      executionWorktree,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      intent: 'existing-change',
    } as Parameters<StoreWorkspace['plan']>[0]);
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    await workspace.apply(plan.token);
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-scope-e2e-',
      projects: [PROJECT],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT]: 'refs/heads/main' },
        },
      ],
    });
    planningWorktree = f.beside('store-planning-dmpi');
    executionWorktree = f.beside('app-a-dmpi');

    // The live shape this change was reproduced against: a Store checkout
    // whose committed root config carries a setup-minted projectId, and a
    // partition catalog that no official flow ever marked `bound` (pair
    // binding lives in the marker/association/index, not in the catalog).
    f.write(
      f.at('rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${ORPHAN_ROOT_PROJECT_ID}\n`
    );
    f.write(
      f.at('.rasen-store', 'projects', `${PROJECT}.yaml`),
      [
        'version: 2',
        `projectId: ${PROJECT}`,
        `id: ${PROJECT}`,
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'planningBinding:',
        '  state: unbound',
        '',
      ].join('\n')
    );
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'store root config + unbound catalog + change']);

    await preparePair();
  }, REAL_GIT_TIMEOUT_MS);

  afterEach(() => {
    f.cleanup();
  });

  it(
    'resolves a finalization scope from the planning-worktree seat',
    async () => {
      // Pre-fix: `planning_selection_conflict` — the store-root config's
      // orphan projectId collides with the marker's partition id.
      const scope = await StorePlanning.open({
        intent: 'finalize-change',
        startPath: planningWorktree,
        change: { changeId: CHANGE },
        globalDataDir: f.globalDataDir,
      });

      const description = scope.describe();
      expect(description.kind).toBe('store-project');
      expect(description.ref).toMatchObject({
        mode: 'store-project',
        storeUid: f.storeUid,
        projectId: PROJECT,
        targetLineId: LINE,
      });
      // The orphan root-config id never becomes a fact, so it can appear in
      // no evidence entry.
      expect(
        description.evidence.filter((item) => item.value === ORPHAN_ROOT_PROJECT_ID)
      ).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'resolves the store-main seat with an explicit --project selector',
    async () => {
      // Pre-fix: `Project '<partition>' is not planning-bound in the selected
      // Store.` — the catalog is the only satisfier the gate accepted.
      const scope = await StorePlanning.open({
        intent: 'project-read',
        startPath: f.storeRoot,
        selection: { project: PROJECT, targetLine: LINE },
        globalDataDir: f.globalDataDir,
      });

      expect(scope.describe().kind).toBe('store-project');
      expect(scope.describe().ref).toMatchObject({
        mode: 'store-project',
        projectId: PROJECT,
        targetLineId: LINE,
      });
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'refuses finalization from the store-main seat for the integration checkout, not for the catalog',
    async () => {
      // A design property, not a bug routed around: the integration checkout
      // is never a finalization seat. What changes is WHICH refusal it gets —
      // a named, actionable one about the worktree instead of a dead end
      // about the catalog.
      const error = await StorePlanning.open({
        intent: 'finalize-change',
        startPath: f.storeRoot,
        selection: { project: PROJECT, targetLine: LINE },
        change: { changeId: CHANGE },
        globalDataDir: f.globalDataDir,
      }).then(
        () => null,
        (caught: unknown) => caught
      );

      expect(diagnosticCode(error)).toBe('planning_worktree_required');
      expect(diagnosticMessage(error)).toContain('checkout_role:integration');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'matches a linked planning worktree to the registry entry that names the main checkout',
    async () => {
      // Pre-fix: canonical path equality only, so a worktree of the registered
      // repository was not the registered Store.
      const matched = await findRegisteredStoreAtRoot(planningWorktree, {
        globalDataDir: f.globalDataDir,
      });

      expect(matched).toMatchObject({
        type: 'store',
        id: f.storeId,
        uid: f.storeUid,
      });
      // The entry's own root still matches by path, unchanged.
      expect(
        await findRegisteredStoreAtRoot(f.storeRoot, { globalDataDir: f.globalDataDir })
      ).toMatchObject({ id: f.storeId });
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'refuses a worktree whose Store metadata identity disagrees with the entry',
    async () => {
      fs.writeFileSync(
        path.join(planningWorktree, '.rasen-store', 'store.yaml'),
        'version: 2\nuid: 11111111-2222-4333-8444-555555555555\nid: team-store\nlayoutVersion: 2\n',
        'utf8'
      );

      expect(
        await findRegisteredStoreAtRoot(planningWorktree, {
          globalDataDir: f.globalDataDir,
        })
      ).toBeNull();
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'leaves matching unchanged where the repository probe cannot run',
    async () => {
      // A copy of the Store tree that is not a git working tree at all: the
      // probe returns nothing, so matching degrades to "no match" rather than
      // to a wrong match.
      const detached = f.beside('store-copy-not-a-repo');
      fs.mkdirSync(path.join(detached, '.rasen-store'), { recursive: true });
      fs.copyFileSync(
        path.join(f.storeRoot, '.rasen-store', 'store.yaml'),
        path.join(detached, '.rasen-store', 'store.yaml')
      );

      expect(
        await findRegisteredStoreAtRoot(detached, { globalDataDir: f.globalDataDir })
      ).toBeNull();
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'refuses when the recorded pair sources disagree on the project',
    async () => {
      // Doctoring the marker makes the recorded pair inconsistent. The gate
      // must not treat an inconsistent pair as evidence, and the scope merge
      // must not silently pick a side.
      fs.writeFileSync(
        path.join(planningWorktree, '.rasen', 'planning-line.json'),
        `${JSON.stringify(
          {
            version: 1,
            storeUid: f.storeUid,
            storeId: f.storeId,
            projectId: 'some-other-project',
            targetLineId: LINE,
            executionRoot: executionWorktree,
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      const error = await StorePlanning.open({
        intent: 'project-read',
        startPath: f.storeRoot,
        selection: { project: PROJECT, targetLine: LINE },
        globalDataDir: f.globalDataDir,
      }).then(
        () => null,
        (caught: unknown) => caught
      );

      expect(['planning_selection_conflict', 'project_not_in_store']).toContain(
        diagnosticCode(error)
      );
      expect(diagnosticMessage(error)).toContain('some-other-project');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'refuses with the pair repair when neither the catalog nor a pair says planning-bound',
    async () => {
      // Remove the recorded pair's own evidence: no marker, no association.
      fs.rmSync(path.join(planningWorktree, '.rasen'), { recursive: true, force: true });
      fs.rmSync(path.join(executionWorktree, '.rasen'), { recursive: true, force: true });

      const error = await StorePlanning.open({
        intent: 'project-read',
        startPath: f.storeRoot,
        selection: { project: PROJECT, targetLine: LINE },
        globalDataDir: f.globalDataDir,
      }).then(
        () => null,
        (caught: unknown) => caught
      );

      expect(diagnosticCode(error)).toBe('project_not_in_store');
      if (!(error instanceof PlanningScopeError)) throw error;
      expect(error.diagnostic.fix).toContain('rasen store workspace plan');
      expect(error.diagnostic.fix).toContain(`--project ${PROJECT}`);
    },
    REAL_GIT_TIMEOUT_MS
  );
});
