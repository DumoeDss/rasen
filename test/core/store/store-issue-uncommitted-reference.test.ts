/**
 * `store-issue-resources` -- the "A plan naming an uncommitted Change is
 * refused" scenario of "Plan references are verified against committed Store
 * evidence".
 *
 * This is the ONLY suite that drives `publishPlan` through the machine
 * workspace index. `resolveChangeReference` answers a Change instance from two
 * sources, and only one of them is authority: committed Store content, and a
 * machine-local planning worktree that `references.ts`'s own header table calls
 * "authority for nothing". A published revision is durable, portable Store
 * content, so a node whose only evidence is the second source is refused --
 * otherwise a revision would carry a claim about a Change that is committed on
 * no ref, which no other clone could check.
 *
 * The seam is deliberate and this file pins both halves of it:
 *
 *   - the RESOLVER keeps reporting what it found (`resolved`, `evidence: null`,
 *     plus the inert locator), because a READ presenting a locally-located node
 *     is correct and the aggregate depends on it;
 *   - the MUTATION refuses on that same resolution.
 *
 * Every fixture here uses real Git and the real machine index layout, because
 * the defect this suite covers lived exactly in the composition of the two.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssueError,
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { resolveChangeReference } from '../../../src/core/store/query/references.js';
import { deriveWorktreeInstanceId } from '../../../src/core/store/planning-identity.js';
import type { WorkspaceIndexEntry } from '../../../src/core/store/workspace/registry.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE_MAIN = 'main';
const LINE_02 = 'line-0.2';

describe('a plan node resolved only by the machine workspace index', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-uncommitted-ref-',
      projects: ['elftia'],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_MAIN,
          storeRef: 'refs/heads/main',
          codeRefs: { elftia: 'refs/heads/main' },
        },
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { elftia: 'refs/heads/release/0.2' },
        },
      ],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  /**
   * A Change that exists ONLY in a planning worktree on this machine, plus the
   * machine index entry that locates it -- exactly what `workspace plan` leaves
   * behind before the branch has merged into any target-line ref.
   *
   * Written at the real index address (`<dataDir>/planning-workspaces/index/
   * <planningScopeId>.json`) so the production `listAllWorkspaceIndexEntries`
   * reads it; nothing here stubs the coordination adapter.
   */
  function seedLocalOnlyChange(changeId: string, instanceSeed: string): {
    readonly instanceId: string;
    readonly planningRoot: string;
  } {
    const planningRoot = f.beside(`planning-${changeId}`);
    const seeded = f.seedChange({
      root: planningRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId,
      instanceSeed,
    });
    const planningScopeId = f.planningScopeId('elftia', LINE_02);
    const entry: WorkspaceIndexEntry = {
      version: 1,
      planningScopeId,
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId,
      changeInstanceId: seeded.instanceId,
      planning: {
        root: planningRoot,
        repositoryIdentity: 'store-repo',
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'store-repo',
          worktreeIdentity: `planning-${changeId}`,
        }),
        ref: `refs/heads/change/${changeId}`,
        headOid: 'a'.repeat(40),
      },
      execution: {
        root: f.beside(`execution-${changeId}`),
        repositoryIdentity: 'code-repo',
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'code-repo',
          worktreeIdentity: `execution-${changeId}`,
        }),
        ref: `refs/heads/change/${changeId}`,
        headOid: 'b'.repeat(40),
      },
      planId: `plan-${changeId}`,
      phase: 'prepared',
      recordedAt: NOW,
      updatedAt: NOW,
    };
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${planningScopeId}.json`
    );
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({ version: 1, planningScopeId, entries: [entry] }, null, 2)}\n`,
      'utf8'
    );
    return { instanceId: seeded.instanceId, planningRoot };
  }

  const changeNode = (nodeId: string, changeInstanceId: string) => ({
    nodeId,
    kind: 'change' as const,
    projectId: 'elftia',
    targetLineId: LINE_02,
    changeInstanceId,
    dependsOn: [],
  });

  it('refuses publication, naming the Change, the reason, and the intent alternative', async () => {
    const local = seedLocalOnlyChange('telemetry-emit', 'e5'.repeat(16));
    const created = await issues().create({ ...scope, issueId: 'local-only', title: 'x' });

    let thrown: unknown;
    try {
      await issues().publishPlan({
        ...scope,
        issueId: 'local-only',
        nodes: [changeNode('emit', local.instanceId)],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StoreIssueError);
    const refusal = thrown as StoreIssueError;
    // A distinct code from `issue_reference_unresolved`: that one's message
    // asserts no local planning worktree derives the instance either, which is
    // false here. Collapsing the two would make the refusal lie about what was
    // searched.
    expect(refusal.issueCode).toBe('issue_reference_uncommitted');
    expect(refusal.message).toContain(local.instanceId);
    expect(refusal.message).toContain(local.planningRoot);
    expect(refusal.diagnostic.fix).toContain('intent');
    // And no revision is created.
    expect(fs.existsSync(f.at('rasen', 'issues', created.identity.uid, 'plans', '0001.yaml'))).toBe(
      false
    );
  });

  it('still publishes when the same instance IS committed, index entry and all', async () => {
    // The identical machine-index entry, plus the Change committed under a
    // Store ref. If the refusal were blanket rather than conditional on the
    // committed evidence being absent, this case would fail -- which is the
    // half of the guard that proves it discriminates.
    const local = seedLocalOnlyChange('telemetry-emit', 'e5'.repeat(16));
    const committed = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'telemetry-emit',
      instanceSeed: 'e5'.repeat(16),
    });
    expect(committed.instanceId).toBe(local.instanceId);
    commitStore('land the Change on a Store ref');

    const created = await issues().create({ ...scope, issueId: 'committed-too', title: 'x' });
    const published = await issues().publishPlan({
      ...scope,
      issueId: 'committed-too',
      nodes: [changeNode('emit', local.instanceId)],
    });

    expect(published.revision.nodes[0]).toMatchObject({
      changeInstanceId: local.instanceId,
    });
    expect(fs.existsSync(f.at('rasen', 'issues', created.identity.uid, 'plans', '0001.yaml'))).toBe(
      true
    );
  });

  it('leaves the resolver reporting the local locator rather than refusing', () => {
    // The contract split, stated as a test: the fix above changed the CONSUMER,
    // not `resolveChangeReference`. The read side (`deriveReadiness`) presents
    // such a node with its inert locator, and this is the seam that keeps that
    // true -- so a later "simplification" that folds the refusal into the
    // resolver has to break this case to do it.
    const entry = {
      version: 1 as const,
      planningScopeId: f.planningScopeId('elftia', LINE_02),
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'telemetry-emit',
      changeInstanceId: `ci_${'3c'.repeat(32)}`,
      planning: {
        root: f.beside('planning-telemetry-emit'),
        repositoryIdentity: 'store-repo',
        worktreeInstanceId: 'wt_planning',
        ref: 'refs/heads/change/telemetry-emit',
        headOid: 'a'.repeat(40),
      },
      execution: {
        root: f.beside('execution-telemetry-emit'),
        repositoryIdentity: 'code-repo',
        worktreeInstanceId: 'wt_execution',
        ref: 'refs/heads/change/telemetry-emit',
        headOid: 'b'.repeat(40),
      },
      planId: 'plan-telemetry-emit',
      phase: 'prepared' as const,
      recordedAt: NOW,
      updatedAt: NOW,
    } satisfies WorkspaceIndexEntry;

    const resolution = resolveChangeReference(
      { committed: [], localWorkspaces: [entry], storeUid: f.storeUid },
      entry.changeInstanceId
    );

    expect(resolution.status).toBe('resolved');
    expect(resolution.status === 'resolved' && resolution.evidence).toBeNull();
    expect(resolution.status === 'resolved' && resolution.localLocator).toEqual({
      root: entry.planning.root,
      kind: 'planning-worktree',
      portable: false,
    });
  });
});
