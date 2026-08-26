/**
 * `issue-deferral-record` tasks 3.4 (ready-set half), 4.1, 4.2, 4.3 — the
 * not-demanded FAMILY discipline: every surface whose lifecycle check is
 * POSITIVE absorbed the fifth value with no branch of its own, and this suite
 * is what proves the absorption rather than a comment claiming it.
 *
 * Two halves, each with the discipline its subject demands:
 *
 *   - the pure derivations (ready set, attention, review) over synthetic
 *     statuses, so one node fact varies at a time — including the review
 *     seam's central claim, that deferring an optional node DISSOLVES its
 *     `optional-open` thread while the determination stays byte-identical
 *     (g-002's finding: the determination never needed a second basis);
 *   - the projection axes over a REAL Git Store fixture and real run-state,
 *     because "drives no phase / no health / no progress / no lane" is a claim
 *     about derivation from evidence, and a hand-built status would beg it.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import {
  writePortfolioState,
  type PortfolioState,
} from '../../../src/core/pipeline-registry/portfolio-state.js';
import {
  writeRunState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import {
  deriveIssueAttention,
  deriveIssueReadySet,
  deriveIssueReview,
  projectIssueStatus,
  type IssueNodeObservation,
  type IssueNodeStatus,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';
import { evaluateIssueAcceptanceGate } from '../../../src/core/issue-acceptance/gate.js';
import type {
  IssueAcceptanceFacts,
  IssueAcceptanceStatusBlock,
} from '../../../src/core/issue-acceptance/types.js';
import type {
  AcceptanceConditionsRevisionV1,
  ExecutionPlanRevisionId,
  Sha256Digest,
} from '../../../src/core/store/issues/index.js';

const PROJECT = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';
const NOW = '2026-08-23T00:00:00.000Z';
const REASON = 'postponed beyond this Issue to the next milestone';

// -----------------------------------------------------------------------------
// The pure derivations over synthetic statuses
// -----------------------------------------------------------------------------

interface RowSpec {
  readonly nodeId: string;
  readonly observation: IssueNodeObservation;
  readonly kind?: 'change' | 'intent';
  readonly lifecycle?: IssueNodeStatus['lifecycle'];
  readonly reason?: string;
  readonly projectId?: string;
  readonly dependsOn?: readonly string[];
}

/** The projection-consistent status one plan spelling derives (ready-set discipline). */
function statusOver(rows: readonly RowSpec[]): IssueStatus {
  const built: IssueNodeStatus[] = rows.map(spec => ({
    nodeId: spec.nodeId,
    kind: spec.kind ?? 'change',
    projectId: spec.projectId ?? PROJECT,
    targetLineId: LINE,
    lifecycle: spec.lifecycle ?? 'required',
    reason: spec.reason ?? null,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: (spec.kind ?? 'change') === 'intent' ? null : spec.nodeId,
    observation: spec.observation,
    blockedBy: [],
    diagnostic: null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
    delivery: null,
  }));
  const byId = new Map(built.map(row => [row.nodeId, row] as const));
  const terminal = (observation: string): boolean =>
    observation === 'finalized' || observation === 'run-terminal';
  const withFacts = built.map((row, index) => ({
    ...row,
    // The work-complete basis `withBlockerFacts` derives: a dependency whose
    // work is complete stops being listed.
    blockedBy: (rows[index]?.dependsOn ?? [])
      .filter(dep => !terminal(byId.get(dep)?.observation ?? 'unknown'))
      .map(dep => ({
        nodeId: dep,
        projectId: byId.get(dep)?.projectId ?? PROJECT,
        observation: byId.get(dep)?.observation ?? ('unknown' as const),
      })),
  }));
  const required = withFacts.filter(row => row.kind === 'change' && row.lifecycle === 'required');
  return {
    phase: 'active',
    health: 'healthy',
    progress: {
      completed: required.filter(row => terminal(row.observation)).length,
      total: required.length,
    },
    nodes: withFacts,
    delta: null,
    projects: [],
    problems: [],
    runStateVisibility: { kind: 'none' },
    complete: true,
    acceptance: null,
  };
}

describe('the ready set names a deferred exit rather than falling through (D5)', () => {
  it('exits a not-started unblocked deferred node as deferred with its reason', () => {
    const ready = deriveIssueReadySet(
      statusOver([
        { nodeId: 'g-001', observation: 'run-terminal' },
        { nodeId: 'g-def', observation: 'not-started', lifecycle: 'deferred', reason: REASON },
      ])
    );
    expect(ready?.members.map(member => member.nodeId)).toEqual([]);
    const exit = ready?.exits.find(entry => entry.nodeId === 'g-def');
    expect(exit?.reason).toEqual({ kind: 'deferred', reason: REASON });
    // The fall-through this exit exists to prevent: without its own kind the
    // node would read `blocked` with an EMPTY blocker list — a lie.
    expect(exit?.reason.kind).not.toBe('blocked');
  });

  it('names the deferral whatever the node observes — postponed is a lifecycle fact', () => {
    for (const observation of [
      'in-flight',
      'failed',
      'waiting-human',
      'run-terminal',
      'unknown',
    ] as const) {
      const ready = deriveIssueReadySet(
        statusOver([
          { nodeId: 'g-def', observation, lifecycle: 'deferred', reason: REASON },
        ])
      );
      expect(ready?.exits.map(entry => entry.reason.kind)).toEqual(['deferred']);
    }
  });

  it('keeps a dependent blocked, naming the deferred dependency it waits on', () => {
    const ready = deriveIssueReadySet(
      statusOver([
        { nodeId: 'g-def', observation: 'not-started', lifecycle: 'deferred', reason: REASON },
        { nodeId: 'g-002', observation: 'not-started', dependsOn: ['g-def'] },
      ])
    );
    // The deferral does not silently release the downstream node: re-edging
    // or deferring the dependent is the next revision's explicit act.
    expect(ready?.members.map(member => member.nodeId)).toEqual([]);
    const downstream = ready?.exits.find(entry => entry.nodeId === 'g-002');
    expect(downstream?.reason).toEqual({
      kind: 'blocked',
      // The node-line refinement vocabulary, verbatim: a not-started node no
      // local run-state explains reads as exactly that, deferred or not.
      blockers: [
        { nodeId: 'g-def', projectId: PROJECT, state: 'not-started, no local run-state' },
      ],
    });
  });

  it('reports a deferred node with a null reason as the absence it is', () => {
    const ready = deriveIssueReadySet(
      statusOver([{ nodeId: 'g-def', observation: 'not-started', lifecycle: 'deferred' }])
    );
    expect(ready?.exits[0]?.reason).toEqual({ kind: 'deferred', reason: null });
  });
});

describe('attention raises nothing for a deferred node (positive-check absorption)', () => {
  it('raises no item for a deferred node observing failed or waiting-human', () => {
    for (const observation of ['failed', 'waiting-human'] as const) {
      const status = statusOver([
        { nodeId: 'g-def', observation, lifecycle: 'deferred', reason: REASON },
      ]);
      expect(deriveIssueAttention('iss-defer', status)).toEqual([]);
      // The discriminating half: the SAME observation on wanted work does
      // raise, so the silence above is the lifecycle's, not the derivation's.
      const wanted = statusOver([{ nodeId: 'g-def', observation }]);
      expect(deriveIssueAttention('iss-defer', wanted).map(item => item.kind)).toEqual([
        observation === 'failed' ? 'failure' : 'waiting-human',
      ]);
    }
  });

  it('still raises blocked-behind for a wanted node stuck behind a deferred dependency', () => {
    const status = statusOver([
      { nodeId: 'g-def', observation: 'failed', lifecycle: 'deferred', reason: REASON },
      { nodeId: 'g-002', observation: 'not-started', dependsOn: ['g-def'] },
    ]);
    const items = deriveIssueAttention('iss-defer', status);
    // Exactly one item: the deferred node itself raises nothing, while the
    // node waiting on it names the wait — the blast radius stays honest.
    expect(items.map(item => item.kind)).toEqual(['blocked-behind']);
    expect(items[0]).toMatchObject({
      kind: 'blocked-behind',
      nodeId: 'g-002',
      blockers: [{ nodeId: 'g-def', projectId: PROJECT, state: 'failed' }],
    });
  });
});

// The review view's acceptance block, assembled from the REAL gate over the
// same node facts — the projection's own composition (g-002's discipline).
const ISSUE = 'iss-defer-review';
const REVISION = '0001' as ExecutionPlanRevisionId;
const DIGEST = 'a'.repeat(64) as Sha256Digest;

const CONDITIONS: AcceptanceConditionsRevisionV1 = {
  version: 1,
  issueId: ISSUE,
  revisionId: REVISION,
  supersedes: null,
  createdAt: NOW,
  contentSha256: DIGEST,
  conditions: [{ id: 'cond-1', requirement: 'The deferral is recorded' }],
};

function openFacts(): IssueAcceptanceFacts {
  return {
    conditions: { revision: CONDITIONS, revisionId: REVISION, diagnostic: null, path: null },
    acceptedRecord: { present: false, record: null, diagnostic: null, path: null },
  };
}

function reviewableStatus(rows: readonly RowSpec[]): IssueStatus {
  const base = statusOver(rows);
  const acceptance: IssueAcceptanceStatusBlock = {
    conditions: openFacts().conditions,
    gate: evaluateIssueAcceptanceGate(
      {
        issueState: 'open',
        nodes: base.nodes,
        problems: base.problems,
        health: base.health,
        complete: base.complete,
      },
      openFacts()
    ),
    record: null,
  };
  return { ...base, phase: 'review', health: 'waiting-human', acceptance };
}

describe('the review seam dissolves the thread without a second basis (D4, g-002 finding 1)', () => {
  const optionalRows: readonly RowSpec[] = [
    { nodeId: 'g-001', observation: 'finalized' },
    { nodeId: 'g-opt', observation: 'in-flight', lifecycle: 'optional' },
  ];
  const deferredRows: readonly RowSpec[] = [
    { nodeId: 'g-001', observation: 'finalized' },
    { nodeId: 'g-opt', observation: 'in-flight', lifecycle: 'deferred', reason: REASON },
  ];

  it('drops the optional-open thread when the revision defers that node', () => {
    const before = deriveIssueReview(ISSUE, REVISION, reviewableStatus(optionalRows));
    expect(before.threads.map(thread => thread.kind)).toEqual(['optional-open']);
    expect(before.threads[0]).toMatchObject({ kind: 'optional-open', nodeId: 'g-opt' });

    const after = deriveIssueReview(ISSUE, REVISION, reviewableStatus(deferredRows));
    // No optional-open, and no thread kind of the deferral's own: the record
    // stands in the acceptance section's exclusion account instead.
    expect(after.threads).toEqual([]);
    expect(JSON.stringify(after.threads)).not.toContain('defer');
  });

  it('leaves the determination byte-identical across the deferral', () => {
    const before = deriveIssueReview(ISSUE, REVISION, reviewableStatus(optionalRows));
    const after = deriveIssueReview(ISSUE, REVISION, reviewableStatus(deferredRows));
    expect(after.determination).toEqual(before.determination);
    expect(after.determination.kind).toBe('review-ready');
    // Byte identity, not just structural equality: no new blocking basis, no
    // reordered facts, nothing the determination gained from the postponement.
    expect(JSON.stringify(after.determination)).toBe(JSON.stringify(before.determination));
  });

  it('presents the deferral in the acceptance exclusion account, its only home', () => {
    // The review view carries determination + threads + verification only:
    // the deferral's record lives in the status block's gate account, which
    // the acceptance section presents, and nowhere in the thread inventory.
    const status = reviewableStatus(deferredRows);
    expect(status.acceptance?.gate.exclusions).toEqual([
      { nodeId: 'g-opt', lifecycle: 'deferred', reason: REASON },
    ]);
    const after = deriveIssueReview(ISSUE, REVISION, status);
    expect(after.threads).toEqual([]);
    expect(after.verification.progress).toEqual({ completed: 1, total: 1 });
  });

  it('keeps lifecycle-blind delivery threads firing for a deferred node', () => {
    // The honest leftovers D4 names: an archived-then-deferred node's
    // recorded evidence facts are still recorded facts, and hiding them would
    // un-name something real.
    const rows: readonly RowSpec[] = [
      { nodeId: 'g-001', observation: 'finalized' },
      { nodeId: 'g-def', observation: 'run-terminal', lifecycle: 'deferred', reason: REASON },
    ];
    const status = reviewableStatus(rows);
    const withDelivery: IssueStatus = {
      ...status,
      nodes: status.nodes.map(node =>
        node.nodeId === 'g-def'
          ? {
              ...node,
              delivery: {
                state: 'not-archived' as const,
                basis: null,
                archivedAt: null,
                codeCommit: null,
                planningBranch: null,
                outcome: null,
                evidence: [],
                missing: [],
                entryName: null,
              },
            }
          : node
      ),
    };
    const review = deriveIssueReview(ISSUE, REVISION, withDelivery);
    expect(review.threads.map(thread => thread.kind)).toEqual(['archive-pending']);
    expect(review.threads[0]).toMatchObject({ nodeId: 'g-def' });
  });
});

// -----------------------------------------------------------------------------
// The projection axes over a real Store fixture (task 4.1)
// -----------------------------------------------------------------------------

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

const TERMINAL = () =>
  stages({
    propose: 'done',
    apply: 'done',
    verify: 'done',
    'review-loop': 'done',
    ship: 'done',
    archive: 'done',
  });

const IN_FLIGHT = () => stages({ propose: 'done', apply: 'in_progress' });

describe('the projection keeps a deferred node outside every axis (D2)', () => {
  const PROJECTION_ISSUE = 'iss-defer-proj';
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-deferral-',
      projects: [PROJECT, PROJECT_B],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT]: 'refs/heads/main', [PROJECT_B]: 'refs/heads/main' },
        },
      ],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function seedAndCommit(projectId: string, changeId: string, instanceSeed: string): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
    return seeded.instanceId;
  }

  const node = (
    nodeId: string,
    changeInstanceId: string,
    alias: string,
    extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason' | 'dependsOn'>> & {
      projectId?: string;
    } = {}
  ): ExecutionPlanNodeInput => ({
    nodeId,
    kind: 'change',
    projectId: extra.projectId ?? PROJECT,
    targetLineId: LINE,
    changeInstanceId,
    changeAlias: alias,
    dependsOn: [],
    ...extra,
  });

  async function createAndPublish(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().create({ ...scope(), issueId: PROJECTION_ISSUE, title: 'Deferral projection' });
    await issues().publishPlan({ ...scope(), issueId: PROJECTION_ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  async function republish(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().publishPlan({ ...scope(), issueId: PROJECTION_ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'deferring revision']);
  }

  async function readStatus(): Promise<IssueStatus> {
    const query = new StoreQueryModuleImpl();
    const detail = await query.showIssue({ ...scope(), issueId: PROJECTION_ISSUE });
    // The delta is derived from the two revisions the READER supplies, so the
    // predecessor is resolved here exactly as `show` composes it.
    const supersedes = detail.plan?.revision?.supersedes ?? null;
    const predecessorPlan =
      supersedes === null
        ? null
        : await query.resolveExecutionPlan({
            ...scope(),
            issueId: PROJECTION_ISSUE,
            revisionId: supersedes,
          });
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      predecessorPlan,
    });
  }

  it('derives review from the wanted nodes alone while a deferred node runs on', async () => {
    const ids = [
      seedAndCommit(PROJECT, 'child-a', 'a1'.repeat(16)),
      seedAndCommit(PROJECT, 'child-def', 'b2'.repeat(16)),
    ];
    await createAndPublish([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: REASON }),
    ]);
    writeRunState(ephemeraDir(execRoot, 'child-a'), TERMINAL());
    writeRunState(ephemeraDir(execRoot, 'child-def'), IN_FLIGHT());

    const status = await readStatus();
    expect(status.phase).toBe('review');
    // The deferred node's observation is still reported on its line.
    const row = status.nodes.find(entry => entry.nodeId === 'g-def');
    expect(row?.observation).toBe('in-flight');
    expect(row?.lifecycle).toBe('deferred');
    expect(row?.reason).toBe(REASON);
  });

  it('treats a deferred node\'s recorded failure as history, not health', async () => {
    const ids = [
      seedAndCommit(PROJECT, 'child-a', 'a1'.repeat(16)),
      seedAndCommit(PROJECT, 'child-def', 'b2'.repeat(16)),
    ];
    await createAndPublish([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: REASON }),
    ]);
    writeRunState(ephemeraDir(execRoot, 'child-a'), TERMINAL());
    const escalated: PortfolioState = {
      parent: 'child-def',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    };
    writePortfolioState(ephemeraDir(execRoot, 'child-def'), escalated);

    const status = await readStatus();
    expect(status.health).not.toBe('failed');
    expect(status.nodes.find(entry => entry.nodeId === 'g-def')?.observation).toBe('failed');

    // The discriminating half: the same escalation on WANTED work drives the
    // health, so the exclusion above belongs to the lifecycle.
    writePortfolioState(ephemeraDir(execRoot, 'child-a'), { ...escalated, parent: 'child-a' });
    expect((await readStatus()).health).toBe('failed');
  });

  it('counts a deferred completion in no progress pair and no lane', async () => {
    const ids = [
      seedAndCommit(PROJECT, 'child-a', 'a1'.repeat(16)),
      seedAndCommit(PROJECT, 'child-def', 'b2'.repeat(16)),
      seedAndCommit(PROJECT_B, 'child-b', 'c3'.repeat(16)),
    ];
    await createAndPublish([
      node('g-001', ids[0], 'child-a'),
      node('g-def', ids[1], 'child-def', { lifecycle: 'deferred', reason: REASON }),
      node('g-b', ids[2], 'child-b', { projectId: PROJECT_B }),
    ]);
    // The deferred node's work is COMPLETE — and counted nowhere anyway.
    writeRunState(ephemeraDir(execRoot, 'child-def'), TERMINAL());

    const status = await readStatus();
    expect(status.progress).toEqual({ completed: 0, total: 2 });
    const lane = status.projects.find(entry => entry.projectId === PROJECT);
    expect(lane?.progress).toEqual({ completed: 0, total: 1 });
    // The node is still IN its project's lane — outside the counts, not
    // outside the grouping.
    expect(lane?.nodeIds).toContain('g-def');
    expect(status.nodes.find(entry => entry.nodeId === 'g-def')?.observation).toBe('run-terminal');
  });

  it('reports the lifecycle change in the revision delta and preserves every observation', async () => {
    const ids = [
      seedAndCommit(PROJECT, 'child-a', 'a1'.repeat(16)),
      seedAndCommit(PROJECT, 'child-opt', 'b2'.repeat(16)),
      seedAndCommit(PROJECT, 'child-req', 'c3'.repeat(16)),
    ];
    const first: readonly ExecutionPlanNodeInput[] = [
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'optional' }),
      node('g-req', ids[2], 'child-req'),
    ];
    await createAndPublish(first);
    writeRunState(ephemeraDir(execRoot, 'child-a'), TERMINAL());
    writeRunState(ephemeraDir(execRoot, 'child-opt'), IN_FLIGHT());
    const before = await readStatus();
    const observationsBefore = before.nodes.map(row => [row.nodeId, row.observation]);

    await republish([
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'deferred', reason: REASON }),
      node('g-req', ids[2], 'child-req', {
        lifecycle: 'deferred',
        reason: 'postponed with its sibling',
      }),
    ]);
    const after = await readStatus();

    // Both crossings are reported generically, from the two revisions alone.
    expect(after.delta?.lifecycleChanges).toEqual([
      { nodeId: 'g-opt', from: 'optional', to: 'deferred' },
      { nodeId: 'g-req', from: 'required', to: 'deferred' },
    ]);
    expect(after.delta?.added).toEqual([]);
    expect(after.delta?.removed).toEqual([]);
    // History preservation: the deferring revision changed what the plan
    // DEMANDS, never what the evidence OBSERVED.
    expect(after.nodes.map(row => [row.nodeId, row.observation])).toEqual(observationsBefore);
    // And the required total shrank exactly by the deferral, explained by the
    // delta rather than absorbed silently.
    expect(before.progress).toEqual({ completed: 1, total: 2 });
    expect(after.progress).toEqual({ completed: 1, total: 1 });
  });
});
