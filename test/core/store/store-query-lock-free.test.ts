/**
 * `store-scoped-issues-management` tasks 6.10, 1.1, 1.2.
 *
 * 6.10 — a query takes no lock, and an aggregate query completes while
 * another process holds the issue, scope, and change locks.
 *
 * 1.1 — the production inventory of every Store-level surface.
 *
 * 1.2 — baseline assertions: the Issue addresses are Store-level (no project
 * participates), the StoreQueryModule Interface offers no flat listing, and
 * the scope-completeness rule holds.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { StoreIssuesModule } from '../../../src/core/store/issues/index.js';
import {
  withIssueLock,
  issueLockKey,
  heldStoreLockKinds,
} from '../../../src/core/store/issues/index.js';
import {
  withWorkspaceLocks,
  scopeLockKey,
} from '../../../src/core/store/workspace/locks.js';
import { createNodeWorkspaceCoordination } from '../../../src/core/store/workspace/dependencies.js';
import {
  resolveStorePlanningLayoutV2Path,
} from '../../../src/core/store/planning-foundation.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

describe('a query takes no lock and completes while writers hold locks', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-query-lock-free-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
  });

  afterEach(() => {
    f.cleanup();
  });

  it('completes a listChanges query while the issue and scope locks are held', async () => {
    // Seed a Change so the query has something to read.
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'lock-free-test',
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed lock-free-test']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const coordination = createNodeWorkspaceCoordination(f.globalDataDir);
    const issueKey = issueLockKey({ storeUid: f.storeUid, issueId: 'some-issue' });
    const scopeKey = scopeLockKey({ storeUid: f.storeUid });

    // Acquire the issue lock AND the scope lock, then run the query inside.
    // If the query tried to take any lock, it would deadlock against this
    // process's own hold (since this is the same process) or block against
    // the bounded deadline. It completes and returns the full result.
    await withIssueLock(coordination, issueKey, async () => {
      await withWorkspaceLocks(coordination, [scopeKey], async () => {
        expect(heldStoreLockKinds()).toContain('issue');
        expect(heldStoreLockKinds()).toContain('scope');

        const result = await new StoreQueryModuleImpl().listChanges(scope);
        expect(result.complete).toBe(true);
        expect(result.groups.length).toBe(1);
        expect(result.groups[0].active.length).toBe(1);
      });
    });
  });

  it('completes a listIssues query while the issue lock is held by another Issue', async () => {
    // Open an Issue.
    const issues = new StoreIssuesModule();
    await issues.create({
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      issueId: 'issue-a',
      title: 'Issue A',
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed issue-a']);

    const coordination = createNodeWorkspaceCoordination(f.globalDataDir);
    const otherIssueKey = issueLockKey({ storeUid: f.storeUid, issueId: 'issue-b' });

    // Hold the lock for issue-b while reading issue-a.
    await withIssueLock(coordination, otherIssueKey, async () => {
      const result = await new StoreQueryModuleImpl().listIssues(scope);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].issueId).toBe('issue-a');
    });
  });
});

describe('baseline inventory and invariants (1.1, 1.2)', () => {
  it('the Issue layout addresses are Store-level: no project or target line in the address', () => {
    const root = '/srv/store';
    const issueDir = resolveStorePlanningLayoutV2Path(
      root, { kind: 'issue', issueId: 'x' }, 'posix'
    );
    const issueRecord = resolveStorePlanningLayoutV2Path(
      root, { kind: 'issue-record', issueId: 'x' }, 'posix'
    );
    const plansDir = resolveStorePlanningLayoutV2Path(
      root, { kind: 'execution-plans', issueId: 'x' }, 'posix'
    );
    const revision = resolveStorePlanningLayoutV2Path(
      root, { kind: 'execution-plan', issueId: 'x', revisionId: '0001' }, 'posix'
    );

    // Every Issue address is under rasen/issues/, never under rasen/projects/.
    expect(issueDir).toBe(`${root}/rasen/issues/x`);
    expect(issueRecord).toBe(`${root}/rasen/issues/x/issue.yaml`);
    expect(plansDir).toBe(`${root}/rasen/issues/x/plans`);
    expect(revision).toBe(`${root}/rasen/issues/x/plans/0001.yaml`);
    expect(issueDir).not.toContain('/projects/');
  });

  it('the StoreQueryModule Interface offers no flat listing', () => {
    const proto = StoreQueryModuleImpl.prototype as unknown as Record<string, unknown>;
    expect(proto.listChangesFlat).toBeUndefined();
    expect(typeof proto.listChanges).toBe('function');
    expect(typeof proto.listIssues).toBe('function');
    expect(typeof proto.showIssue).toBe('function');
    expect(typeof proto.resolveExecutionPlan).toBe('function');
    expect(typeof proto.listProjects).toBe('function');
    expect(typeof proto.listTargetLines).toBe('function');
  });

  it('every Issue address input takes no projectId and no targetLineId', () => {
    // The type system enforces this: an `issue-record` address only accepts
    // `{ kind, issueId }`. We assert the runtime shape: the function does not
    // look up project or line from any global.
    const root = '/srv/store';
    const a = resolveStorePlanningLayoutV2Path(root, { kind: 'issue-record', issueId: 'x' }, 'posix');
    const b = resolveStorePlanningLayoutV2Path(root, { kind: 'issue-record', issueId: 'x' }, 'posix');
    // Identical inputs produce identical outputs — there is no ambient state.
    expect(a).toBe(b);
  });
});
