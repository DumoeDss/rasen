/**
 * `issue-ready-set-scheduling` tasks 1.1/1.2 — the equivalence pins.
 *
 * Task 1.1 (lands FIRST, green against the unrefactored code): `store issue
 * start`'s candidate set and `confirm`'s launchable scope, on ONE shared
 * fixture per shape, asserting the two scopes agree today. The refactor onto
 * the shared ready-set derivation must keep every assertion here green
 * WITHOUT editing them — a behavioral delta surfaces as a test diff, never as
 * a regression in flight.
 *
 * Task 1.2 rides the same fixtures: the ready-set shape assertions
 * (members, and per-non-member exit reasons per the spec vocabulary),
 * skip-marked until `deriveIssueReadySet` lands, then unskipped in place.
 *
 * Fixture discipline: every status row's `blockedBy` is built the way the
 * projection's own post-pass builds it — every dependency whose observed work
 * is not complete is listed, in declaration order — so the synthetic inputs
 * honor the same invariant the equivalence claim rests on (`blockedBy` empty
 * is propositionally identical to "every dependency's work is complete").
 */
import { describe, expect, it } from 'vitest';

import {
  composeIssueConfirm,
  resolveIssueLaunchBinding,
  type IssueLaunchContextFor,
} from '../../../src/core/issue-execution/index.js';
import {
  deriveIssueReadySet,
  type IssueStatus,
  type IssueNodeStatus,
} from '../../../src/core/issue-status/index.js';
import type { IssueDetail, ResolvedPlanNode } from '../../../src/core/store/query/index.js';
import type { ExecutionPlanNode } from '../../../src/core/store/issues/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const ISSUE = 'iss-ready-equiv';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';

function resolvedNode(node: ExecutionPlanNode): ResolvedPlanNode {
  return {
    node,
    resolution: {
      status: node.kind === 'change' ? 'resolved' : 'not-created',
      claimants:
        node.kind === 'change'
          ? [
              {
                changeId: node.changeAlias ?? node.nodeId,
                projectId: node.projectId,
                targetLineId: node.targetLineId,
                foundAtRef: 'refs/heads/main',
                archived: false,
              },
            ]
          : [],
      searchedRefs: ['refs/heads/main'],
      localLocator: null,
      outcome: null,
      archived: false,
    },
    readiness: 'not-started',
    blockedBy: [],
  };
}

function detailFor(nodes: readonly ExecutionPlanNode[]): IssueDetail {
  return {
    issue: {
      issueId: ISSUE,
      record: {
        version: 1,
        id: ISSUE,
        title: 'Ready-set equivalence',
        state: 'open',
        reason: null,
        createdAt: NOW,
      },
      diagnostic: null,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: [],
      uncommitted: false,
    },
    plan: {
      issueId: ISSUE,
      revisionId: '0001',
      revision: {
        version: 1,
        issueId: ISSUE,
        revisionId: '0001',
        supersedes: null,
        createdAt: NOW,
        contentSha256: 'a'.repeat(64),
        nodes,
      },
      diagnostic: null,
      readiness: { nodes: nodes.map(resolvedNode), readyToResolve: false },
      unsearchedRefs: [],
      problems: [],
      complete: true,
    },
    unsearchedRefs: [],
    problems: [],
    complete: true,
  };
}

const isTerminal = (observation: IssueNodeStatus['observation'] | undefined): boolean =>
  observation === 'finalized' || observation === 'run-terminal';

/**
 * The projection's own row-completion rule, applied to synthetic rows: the
 * plan's own spelling (target, alias, suggestion, lifecycle) resolves onto
 * each row the way `withLifecycle` does, and each dependency whose observed
 * work is not complete is listed with node id, target project, and
 * observation, in declaration order. One helper so the fixtures cannot drift
 * from the invariants the equivalence claim rests on.
 */
function withBlockerFacts(
  rows: readonly IssueNodeStatus[],
  plan: readonly ExecutionPlanNode[]
): readonly IssueNodeStatus[] {
  const byId = new Map(rows.map(row => [row.nodeId, row] as const));
  const planById = new Map(plan.map(node => [node.nodeId, node] as const));
  const completed = rows.map(row => {
    const planned = planById.get(row.nodeId);
    return {
      ...row,
      projectId: planned?.projectId ?? row.projectId,
      targetLineId: planned?.targetLineId ?? row.targetLineId,
      lifecycle: row.lifecycle ?? planned?.lifecycle ?? 'required',
      alias:
        planned !== undefined && planned.kind === 'change'
          ? (planned.changeAlias ?? null)
          : null,
      suggestedPipeline:
        planned !== undefined && planned.suggestedPipeline !== undefined
          ? planned.suggestedPipeline
          : null,
    };
  });
  const completedById = new Map(completed.map(row => [row.nodeId, row] as const));
  return completed.map(row => ({
    ...row,
    blockedBy: (planById.get(row.nodeId)?.dependsOn ?? [])
      .filter(dep => !isTerminal(completedById.get(dep)?.observation))
      .map(dep => {
        const dependency = completedById.get(dep);
        return {
          nodeId: dep,
          projectId: dependency?.projectId ?? '',
          observation: dependency?.observation ?? ('unknown' as const),
        };
      }),
  }));
}

function statusFor(
  rows: readonly IssueNodeStatus[],
  plan: readonly ExecutionPlanNode[]
): IssueStatus {
  return {
    phase: 'active',
    health: 'healthy',
    progress: { completed: 0, total: rows.length },
    nodes: [...withBlockerFacts(rows, plan)],
    delta: null,
    projects: [],
    problems: [],
    runStateVisibility: { kind: 'none' },
    complete: true,
    acceptance: null,
  };
}

/** One observed node row; `withBlockerFacts` completes its dependency facts. */
function row(
  nodeId: string,
  observation: IssueNodeStatus['observation'],
  extra: Partial<Pick<IssueNodeStatus, 'kind' | 'lifecycle' | 'reason' | 'diagnostic'>> = {}
): IssueNodeStatus {
  return {
    nodeId,
    kind: extra.kind ?? 'change',
    projectId: PROJECT_A,
    targetLineId: LINE,
    lifecycle: extra.lifecycle ?? 'required',
    reason: extra.reason ?? null,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: null,
    observation,
    blockedBy: [],
    diagnostic: extra.diagnostic ?? null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
  };
}

/** The launch seam: OK for app-a, no registered checkout for app-b. */
const LAUNCH_OK_A_ONLY: IssueLaunchContextFor = async projectId =>
  projectId === PROJECT_A
    ? {
        ok: true,
        context: {
          cwd: `C:\\checkout-${projectId}`,
          attachedRoots: ['C:\\store-root'],
          execution: { kind: 'project', projectId, root: `C:\\checkout-${projectId}` },
        },
      }
    : {
        ok: false,
        status: 404,
        code: 'execution_not_found',
        message: `No registered project or linked worktree matches "${projectId}".`,
      };

// -----------------------------------------------------------------------------
// The shared fixtures
// -----------------------------------------------------------------------------

/** Two independent not-started Change nodes in two member projects. */
const PARALLEL_NODES: readonly ExecutionPlanNode[] = [
  {
    nodeId: 'p-001',
    kind: 'change',
    projectId: PROJECT_A,
    targetLineId: LINE,
    changeInstanceId: 'ci:aaa',
    changeAlias: 'child-a',
    dependsOn: [],
  },
  {
    nodeId: 'p-002',
    kind: 'change',
    projectId: PROJECT_B,
    targetLineId: LINE,
    changeInstanceId: 'ci:bbb',
    changeAlias: 'child-b',
    dependsOn: [],
  },
];

/** The three-node serial chain: g-001 -> g-002 -> g-003, plus an intent node. */
const SERIAL_NODES: readonly ExecutionPlanNode[] = [
  {
    nodeId: 'g-001',
    kind: 'change',
    projectId: PROJECT_A,
    targetLineId: LINE,
    changeInstanceId: 'ci:aaa',
    changeAlias: 'child-a',
    dependsOn: [],
  },
  {
    nodeId: 'g-002',
    kind: 'change',
    projectId: PROJECT_A,
    targetLineId: LINE,
    changeInstanceId: 'ci:bbb',
    changeAlias: 'child-b',
    dependsOn: ['g-001'],
  },
  {
    nodeId: 'g-003',
    kind: 'change',
    projectId: PROJECT_A,
    targetLineId: LINE,
    changeInstanceId: 'ci:ccc',
    changeAlias: 'child-c',
    dependsOn: ['g-002'],
  },
  {
    nodeId: 'i-001',
    kind: 'intent',
    projectId: PROJECT_B,
    targetLineId: LINE,
    summary: 'docs for the widget',
    dependsOn: [],
  },
];

function parallelInput() {
  return {
    detail: detailFor(PARALLEL_NODES),
    status: statusFor([row('p-001', 'not-started'), row('p-002', 'not-started')], PARALLEL_NODES),
    workspaceEntries: [],
    launchContextFor: LAUNCH_OK_A_ONLY,
  };
}

function serialInput() {
  return {
    detail: detailFor(SERIAL_NODES),
    status: statusFor(
      [
        row('g-001', 'not-started'),
        row('g-002', 'not-started'),
        row('g-003', 'not-started'),
        row('i-001', 'not-started', { kind: 'intent' }),
      ],
      SERIAL_NODES
    ),
    workspaceEntries: [],
    launchContextFor: LAUNCH_OK_A_ONLY,
  };
}

// -----------------------------------------------------------------------------
// Task 1.1 — the pins (green BEFORE the refactor, unedited after)
// -----------------------------------------------------------------------------

describe('start candidates and confirm launchable scope agree (the pin)', () => {
  it('parallel plan: the several-candidates refusal and confirm compose the same two nodes', async () => {
    const input = parallelInput();

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.refusal.code).toBe('issue_start_frontier_ambiguous');
    expect(start.refusal.candidates).toEqual(['p-001', 'p-002']);

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    // p-001 resolves a contract (its project has a checkout); p-002 is the
    // same launchable node failing route resolution — contracts + unprepared
    // is the launchable scope, and it is exactly the candidate set.
    expect(confirm.report.contracts.map(binding => binding.nodeId)).toEqual(['p-001']);
    expect(confirm.report.unprepared.map(entry => entry.nodeId)).toEqual(['p-002']);
    expect(confirm.report.waiting).toEqual([]);
    expect(
      [...confirm.report.contracts, ...confirm.report.unprepared]
        .map(binding => binding.nodeId)
        .sort()
    ).toEqual([...start.refusal.candidates]);
  });

  it('serial plan: the single frontier node start emits is the one contract confirm composes', async () => {
    const input = serialInput();

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.binding.nodeId).toBe('g-001');
    expect(start.binding.mode).toBe('fresh');

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(confirm.report.contracts.map(binding => binding.nodeId)).toEqual(['g-001']);
    expect(confirm.report.unprepared).toEqual([]);
    expect(confirm.report.pendingChanges.map(pending => pending.nodeId)).toEqual(['i-001']);
    expect(confirm.report.waiting.map(waiting => waiting.nodeId)).toEqual(['g-002', 'g-003']);
  });

  it('a dependency whose work is terminal-but-unarchived releases the same node on both surfaces', async () => {
    // The work-complete basis pin: g-001 finished its run (run-terminal,
    // unarchived), so g-002 is launchable on BOTH surfaces — the ready answer
    // never waits for the archive. The complete g-001 itself keeps its
    // report-only contract row on confirm's side (its dependencies are
    // complete), exactly as the composition behaves today.
    const input = serialInput();
    input.status = statusFor(
      [
        row('g-001', 'run-terminal'),
        row('g-002', 'not-started'),
        row('g-003', 'not-started'),
        row('i-001', 'not-started', { kind: 'intent' }),
      ],
      SERIAL_NODES
    );

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.binding.nodeId).toBe('g-002');

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(confirm.report.contracts.map(binding => binding.nodeId)).toEqual(['g-001', 'g-002']);
    const released = confirm.report.contracts.find(binding => binding.nodeId === 'g-002');
    expect(released?.mode).toBe('fresh');
    expect(confirm.report.waiting.map(waiting => waiting.nodeId)).toEqual(['g-003']);
  });

  it('a cancelled sibling exits the launchable scope on both surfaces identically', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      PARALLEL_NODES[0] as ExecutionPlanNode,
      {
        nodeId: 'p-cut',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: 'ci:ddd',
        changeAlias: 'child-cut',
        lifecycle: 'cancelled',
        reason: 'descoped mid-flight',
        dependsOn: [],
      },
    ];
    const input = {
      detail: detailFor(nodes),
      status: statusFor(
        [row('p-001', 'not-started'), row('p-cut', 'not-started', { lifecycle: 'cancelled', reason: 'descoped mid-flight' })],
        nodes
      ),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK_A_ONLY,
    };

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.binding.nodeId).toBe('p-001');

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    const named = [
      ...confirm.report.contracts.map(binding => binding.nodeId),
      ...confirm.report.pendingChanges.map(pending => pending.nodeId),
      ...confirm.report.waiting.map(waiting => waiting.nodeId),
      ...confirm.report.unprepared.map(entry => entry.nodeId),
    ];
    expect(named).toEqual(['p-001']);
  });
});

// -----------------------------------------------------------------------------
// Task 1.2 — the ready-set shape assertions over the same fixtures, unskipped
// in place once `deriveIssueReadySet` landed. The refactor must keep them
// green unedited: they are the spec vocabulary's pin on these shapes.
// -----------------------------------------------------------------------------

describe('deriveIssueReadySet — the ready-set shape (task 1.2)', () => {
  it('parallel plan: both nodes are members, deterministically, twice the same', () => {
    const input = parallelInput();
    const first = deriveIssueReadySet(input.status);
    const second = deriveIssueReadySet(input.status);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.members.map(member => member.nodeId)).toEqual(['p-001', 'p-002']);
    expect(first?.exits).toEqual([]);
    // The member facts a launch decision reads: identity, target, alias.
    expect(first?.members[0]).toEqual({
      nodeId: 'p-001',
      projectId: PROJECT_A,
      targetLineId: LINE,
      alias: 'child-a',
      suggestedPipeline: null,
      lifecycle: 'required',
    });
  });

  it('serial plan: the head alone is a member; every other node exits with its reason', () => {
    const ready = deriveIssueReadySet(serialInput().status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-001']);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-002')).toEqual({
      kind: 'blocked',
      blockers: [
        { nodeId: 'g-001', projectId: PROJECT_A, state: 'not-started, no local run-state' },
      ],
    });
    expect(reasonByNode.get('g-003')).toEqual({
      kind: 'blocked',
      blockers: [
        { nodeId: 'g-002', projectId: PROJECT_A, state: 'not-started, no local run-state' },
      ],
    });
    expect(reasonByNode.get('i-001')).toEqual({
      kind: 'pending-change-creation',
      projectId: PROJECT_B,
      targetLineId: LINE,
    });
  });

  it('run-terminal dependency: the released node is the member; the complete dependency exits complete', () => {
    const input = serialInput();
    input.status = statusFor(
      [
        row('g-001', 'run-terminal'),
        row('g-002', 'not-started'),
        row('g-003', 'not-started'),
        row('i-001', 'not-started', { kind: 'intent' }),
      ],
      SERIAL_NODES
    );
    const ready = deriveIssueReadySet(input.status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-002']);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    // The gate did not wait for the dependency's archive — and the complete
    // dependency is named with its run-terminal truth, not a guess.
    expect(reasonByNode.get('g-001')).toEqual({ kind: 'complete', basis: null });
  });

  it('cancelled node: exits cancelled with its recorded reason', () => {
    const nodes: readonly ExecutionPlanNode[] = [
      PARALLEL_NODES[0] as ExecutionPlanNode,
      {
        nodeId: 'p-cut',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: 'ci:ddd',
        changeAlias: 'child-cut',
        lifecycle: 'cancelled',
        reason: 'descoped mid-flight',
        dependsOn: [],
      },
    ];
    const ready = deriveIssueReadySet(
      statusFor(
        [
          row('p-001', 'not-started'),
          row('p-cut', 'not-started', { lifecycle: 'cancelled', reason: 'descoped mid-flight' }),
        ],
        nodes
      )
    );
    expect(ready?.members.map(member => member.nodeId)).toEqual(['p-001']);
    expect(ready?.exits).toEqual([
      { nodeId: 'p-cut', reason: { kind: 'cancelled', reason: 'descoped mid-flight' } },
    ]);
  });
});

// -----------------------------------------------------------------------------
// Task 5.3 — the equivalence pinned BOTH ways: start candidates == ready
// members, and confirm's launchable scope (contracts + unprepared) == ready
// members, per the spec requirement. A change to any one surface drifts at
// least one of these.
// -----------------------------------------------------------------------------

describe('the ready set IS the frontier (the both-way equivalence, task 5.3)', () => {
  it('parallel plan: members == start candidates == confirm contracts+unprepared', async () => {
    const input = parallelInput();
    const ready = deriveIssueReadySet(input.status);
    expect(ready?.members.map(member => member.nodeId).sort()).toEqual(['p-001', 'p-002']);

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.refusal.candidates).toEqual(ready?.members.map(member => member.nodeId).sort());

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(
      [...confirm.report.contracts, ...confirm.report.unprepared]
        .map(binding => binding.nodeId)
        .sort()
    ).toEqual(ready?.members.map(member => member.nodeId).sort());
  });

  it('serial plan: the single member is start\'s chosen node and confirm\'s fresh contract', async () => {
    const input = serialInput();
    const ready = deriveIssueReadySet(input.status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-001']);

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect([start.binding.nodeId]).toEqual(ready?.members.map(member => member.nodeId));

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(confirm.report.contracts.map(binding => binding.nodeId)).toEqual(
      ready?.members.map(member => member.nodeId)
    );
  });

  it('released-by-terminal-work plan: the released member is the fresh scope on both surfaces', async () => {
    const input = serialInput();
    input.status = statusFor(
      [
        row('g-001', 'run-terminal'),
        row('g-002', 'not-started'),
        row('g-003', 'not-started'),
        row('i-001', 'not-started', { kind: 'intent' }),
      ],
      SERIAL_NODES
    );
    const ready = deriveIssueReadySet(input.status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-002']);

    const start = await resolveIssueLaunchBinding(input);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.binding.nodeId).toBe('g-002');

    // Confirm's FRESH launchable scope is the ready set; the begun g-001 keeps
    // its report-only contract beside it, never inside the equivalence.
    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(
      confirm.report.contracts
        .filter(binding => binding.mode === 'fresh')
        .map(binding => binding.nodeId)
    ).toEqual(ready?.members.map(member => member.nodeId));
  });
});

// -----------------------------------------------------------------------------
// Review round-1 MAJOR-2 — the begun-node seam, pinned in the open. A begun
// node (any observation other than not-started) receives its per-node
// resolution regardless of dependency state: dependency gating applies to
// fresh launches. This seam had NO pin before the refactor (the
// fixture-coincides shape), and the pre-refactor behavior here was `waiting`
// — the change is deliberate and this fixture is its covering pin.
// -----------------------------------------------------------------------------

describe('a begun node keeps its per-node resolution over an incomplete dependency', () => {
  it('confirm reports the resume contract, not a waiting entry — and ready agrees', async () => {
    // The probe receipt's shape: g-run is in-flight and STILL depends on the
    // not-started g-up (a replan added the edge mid-flight).
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-up',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-run',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: 'ci:bbb',
        changeAlias: 'child-b',
        dependsOn: ['g-up'],
      },
    ];
    const input = {
      detail: detailFor(nodes),
      status: statusFor(
        [row('g-up', 'not-started'), row('g-run', 'in-flight')],
        nodes
      ),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK_A_ONLY,
    };

    const confirm = await composeIssueConfirm(input);
    expect(confirm.ok).toBe(true);
    if (!confirm.ok) return;
    expect(confirm.report.contracts.map(binding => [binding.nodeId, binding.mode])).toEqual([
      ['g-up', 'fresh'],
      ['g-run', 'already-running'],
    ]);
    expect(confirm.report.waiting).toEqual([]);
    expect(confirm.report.unprepared).toEqual([]);

    // And the ready answer agrees about both: the not-started dependency is
    // the member (its own work is unblocked); the begun node exits running.
    const ready = deriveIssueReadySet(input.status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-up']);
    expect(ready?.exits).toEqual([
      { nodeId: 'g-run', reason: { kind: 'running', observation: 'in-flight' } },
    ]);
  });
});
