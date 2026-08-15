/**
 * `store-issue-resources` task 6.2 — finalization-free substitute coverage for
 * `src/core/store/issues/scope.ts`.
 *
 * The reference change's `test/core/store/store-issue-scope-intent.test.ts` is
 * deferred (task 6.1): it drives this file's `resolveIssueScope` and
 * `assertIssueWriteLocation` only THROUGH `StorePlanning.open({ intent:
 * 'store-issue' })`, a resolver in `store-planning/` — a later slice this
 * child does not port, and whose fixture helper pulls `finalization/` too.
 *
 * That deferred file also never exercises the refusal branch: no test
 * anywhere in the reference tree drives `assertIssueWriteLocation`'s
 * `issue_write_requires_store_checkout` throw, and none stands in a Store
 * worktree OTHER than the registered root, so `resolveIssueScope`'s
 * worktree-root walk (as opposed to its registered-root fallback) is
 * untested there too. Both are new coverage here, driven directly through
 * `StoreIssuesModule` and a real second Git worktree — no `StorePlanning`,
 * no finalization.
 *
 * `requireIssueScopeStore` is deliberately UNEXPORTED from `issues/index.ts`
 * (the barrel's own doc comment reserves the write-location rule as
 * internal) and uncalled anywhere in this child's port — it is forward
 * surface for the `store-planning` intent resolver to import directly, by
 * design. It is imported here from `scope.js` directly, the same way that
 * future internal caller would, so its guard does not ship with zero
 * coverage in the meantime.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { requireIssueScopeStore } from '../../../src/core/store/issues/scope.js';
import {
  createStoreWorkspaceFixture,
  FIXTURE_NOW,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';

describe('resolveIssueScope + assertIssueWriteLocation', () => {
  let f: StoreWorkspaceFixture;
  let issues: StoreIssuesModule;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({ prefix: 'rasen-issue-scope-', projects: [PROJECT] });
    issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, FIXTURE_NOW),
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('creates an Issue from the registered Store root with no project or target line involved', async () => {
    const result = await issues.create({
      store: f.storeUid,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      issueId: 'root-issue',
      title: 'Root Issue',
    });
    expect(result.record.state).toBe('open');
    expect(
      fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'root-issue', 'issue.yaml'))
    ).toBe(true);
  });

  it('resolves a real second worktree as the checkout, writing there rather than falling back to the registered root', async () => {
    const worktreePath = f.beside('wt-plain');
    f.git(f.storeRoot, ['worktree', 'add', worktreePath, '-b', 'wt-plain-branch']);

    await issues.create({
      store: f.storeUid,
      startPath: worktreePath,
      globalDataDir: f.globalDataDir,
      issueId: 'worktree-issue',
      title: 'Worktree Issue',
    });

    expect(
      fs.existsSync(path.join(worktreePath, 'rasen', 'issues', 'worktree-issue', 'issue.yaml'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'worktree-issue', 'issue.yaml'))
    ).toBe(false);
  });

  it('refuses an Issue write in a Store worktree carrying the planning-line marker, naming the checkout', async () => {
    const worktreePath = f.beside('wt-marker');
    f.git(f.storeRoot, ['worktree', 'add', worktreePath, '-b', 'wt-marker-branch']);
    fs.mkdirSync(path.join(worktreePath, '.rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(worktreePath, '.rasen', 'planning-line.json'),
      JSON.stringify({
        version: 1,
        storeUid: f.storeUid,
        storeId: f.storeId,
        projectId: PROJECT,
        targetLineId: 'main',
        planningWorktree: worktreePath,
      }),
      'utf8'
    );

    let caught: unknown;
    try {
      await issues.create({
        store: f.storeUid,
        startPath: worktreePath,
        globalDataDir: f.globalDataDir,
        issueId: 'refused-issue',
        title: 'Refused Issue',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      diagnostic: { code: 'issue_write_requires_store_checkout' },
    });
    // No index entry was ever registered for this worktree (no
    // `completeChangeBinding` ran), so the refusal falls back to the
    // "no index entry" description rather than naming a Change.
    expect((caught as Error).message).toContain('a Change this machine has no index entry for');
    // The message names the resolved WORKTREE, not the registered root — the
    // proof that the worktree walk actually selected it rather than the
    // registeredRoot fallback silently swallowing the distinction.
    expect((caught as Error).message).toContain(worktreePath);

    // The refusal happens before the first write, not after a partial one.
    expect(fs.existsSync(path.join(worktreePath, 'rasen', 'issues', 'refused-issue'))).toBe(
      false
    );
  });
});

describe('requireIssueScopeStore', () => {
  it('refuses an undefined or empty store selector', () => {
    expect(() => requireIssueScopeStore(undefined)).toThrow(
      /no project and no target line/iu
    );
    expect(() => requireIssueScopeStore('')).toThrow(/no project and no target line/iu);
  });

  it('returns the store id unchanged otherwise', () => {
    expect(requireIssueScopeStore('my-store')).toBe('my-store');
  });
});
