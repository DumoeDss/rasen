/**
 * `issue-execution-binding` — the frontier, routes, and refusals, over purely
 * SYNTHETIC `IssueDetail` + `IssueStatus` + injected index entries and launch
 * contexts. No filesystem, no Git, no machine registry: the module under test
 * is deterministic by contract, and these units hold it to that — including
 * the same-inputs-twice determinism row.
 *
 * The routes and refusals mirror design D3–D5 one for one: the observation
 * rule for the frontier, the fixed route order, the honest refusal taxonomy
 * (every refusal names what it refused on), and the already-running /
 * already-complete modes.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveIssueLaunchBinding,
  type IssueLaunchContextFor,
} from '../../../src/core/issue-execution/index.js';
import type { IssueStatus, IssueNodeStatus } from '../../../src/core/issue-status/index.js';
import type { IssueDetail, ResolvedPlanNode } from '../../../src/core/store/query/index.js';
import type { ExecutionPlanNode } from '../../../src/core/store/issues/index.js';
import type {
  WorkspaceIndexEntry,
  WorkspaceIndexSide,
} from '../../../src/core/store/workspace/registry.js';

const NOW = '2026-08-17T00:00:00.000Z';
const ISSUE = 'iss-bind';
const PROJECT = 'app-a';
const LINE = 'main';

/** The three-node serial graph the portfolio dogfoods: g-001 -> g-002 -> g-003. */
const PLAN_NODES: readonly ExecutionPlanNode[] = [
  {
    nodeId: 'g-001',
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    changeInstanceId: 'ci:aaa',
    changeAlias: 'child-a',
    dependsOn: [],
  },
  {
    nodeId: 'g-002',
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    changeInstanceId: 'ci:bbb',
    changeAlias: 'child-b',
    dependsOn: ['g-001'],
  },
  {
    nodeId: 'g-003',
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    changeInstanceId: 'ci:ccc',
    changeAlias: 'child-c',
    dependsOn: ['g-001', 'g-002'],
  },
];

function resolvedNode(
  node: ExecutionPlanNode,
  blockedBy: readonly string[] = []
): ResolvedPlanNode {
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
    blockedBy,
  };
}

/**
 * An `IssueDetail` whose latest revision is the given plan. `blockedByFor`
 * plants the plan read's ARCHIVE-based dependency view on the resolved rows
 * — the view `isRunnable` deliberately does NOT key on (design D3).
 */
function detailFor(
  nodes: readonly ExecutionPlanNode[],
  blockedByFor: (nodeId: string) => readonly string[] = () => []
): IssueDetail {
  return {
    issue: {
      issueId: ISSUE,
      record: { version: 1, id: ISSUE, title: 'Binding unit', state: 'open', reason: null, createdAt: NOW },
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
      readiness: {
        nodes: nodes.map(node => resolvedNode(node, blockedByFor(node.nodeId))),
        readyToResolve: false,
      },
      unsearchedRefs: [],
      problems: [],
      complete: true,
    },
    unsearchedRefs: [],
    problems: [],
    complete: true,
  };
}

/** One observed node row, with the C2 attribution fields. */
function nodeStatus(
  nodeId: string,
  observation: IssueNodeStatus['observation'],
  extra: Partial<
    Pick<IssueNodeStatus, 'alias' | 'diagnostic' | 'runStatePath' | 'locatedBy' | 'attribution' | 'blockedBy' | 'lifecycle' | 'reason'>
  > = {}
): IssueNodeStatus {
  const planned = PLAN_NODES.find(node => node.nodeId === nodeId);
  const alias =
    extra.alias ??
    (planned !== undefined && planned.kind === 'change' ? (planned.changeAlias ?? null) : null);
  return {
    nodeId,
    kind: 'change',
    lifecycle: extra.lifecycle ?? 'required',
    reason: extra.reason ?? null,
    alias,
    observation,
    blockedBy: extra.blockedBy ?? [],
    diagnostic: extra.diagnostic ?? null,
    runStatePath: extra.runStatePath ?? null,
    locatedBy: extra.locatedBy ?? null,
    attribution: extra.attribution ?? { pipeline: null, sessions: [], evidenceLocator: null },
  };
}

function statusFor(nodes: readonly IssueNodeStatus[]): IssueStatus {
  return {
    phase: 'active',
    health: 'healthy',
    progress: { completed: 0, total: nodes.length },
    nodes,
    problems: [],
    runStateVisibility: { kind: 'none' },
    complete: true,
  };
}

function side(root: string): WorkspaceIndexSide {
  return {
    root,
    repositoryIdentity: 'repo',
    worktreeInstanceId: `wt-${root}`,
    ref: 'refs/heads/main',
    headOid: 'a'.repeat(40),
  };
}

function indexEntry(overrides: Partial<WorkspaceIndexEntry> = {}): WorkspaceIndexEntry {
  return {
    version: 1,
    planningScopeId: 'scope-main',
    storeUid: 'uid-1',
    storeId: 'team-store',
    projectId: PROJECT,
    targetLineId: LINE,
    changeId: 'child-a',
    changeInstanceId: 'ci:aaa',
    planning: side('C:\\pair-planning'),
    execution: side('C:\\pair-execution'),
    planId: 'plan-1',
    phase: 'bound',
    recordedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const LAUNCH_OK: IssueLaunchContextFor = async projectId => ({
  ok: true,
  context: {
    cwd: `C:\\checkout-${projectId}`,
    attachedRoots: ['C:\\store-root'],
    execution: { kind: 'project', projectId, root: `C:\\checkout-${projectId}` },
  },
});

const LAUNCH_NOT_FOUND: IssueLaunchContextFor = async () => ({
  ok: false,
  status: 404,
  code: 'execution_not_found',
  message: `No registered project or linked worktree matches "${PROJECT}".`,
});

const LAUNCH_NOT_MEMBER: IssueLaunchContextFor = async () => ({
  ok: false,
  status: 409,
  code: 'execution_not_member',
  message: `Store "team-store" does not record project "${PROJECT}" as a member.`,
});

const KNOWN_PIPELINES = (name: string): boolean => name === 'small-feature' || name === 'bug-fix';

/** The standard input: three not-started nodes, frontier = g-001. */
function baseInput() {
  const detail = detailFor(PLAN_NODES);
  const status = statusFor([
    nodeStatus('g-001', 'not-started'),
    nodeStatus('g-002', 'not-started'),
    nodeStatus('g-003', 'not-started'),
  ]);
  return {
    detail,
    status,
    workspaceEntries: [] as readonly WorkspaceIndexEntry[],
    launchContextFor: LAUNCH_OK,
  };
}

describe('resolveIssueLaunchBinding — frontier and modes', () => {
  it('derives the single runnable frontier node as a fresh launch', async () => {
    const result = await resolveIssueLaunchBinding(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.mode).toBe('fresh');
    expect(result.binding.nodeId).toBe('g-001');
    expect(result.binding.changeInstanceId).toBe('ci:aaa');
    expect(result.binding.alias).toBe('child-a');
    expect(result.binding.projectId).toBe(PROJECT);
    expect(result.binding.targetLineId).toBe(LINE);
    expect(result.binding.launch?.form).toBe('project-checkout');
    expect(result.binding.pipeline).toBeNull();
  });

  it('refuses naming every candidate when several nodes are runnable', async () => {
    // A PARALLEL pair: both change nodes are not-started with no
    // dependencies, so both qualify and the command must not choose.
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'p-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'p-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:bbb',
        changeAlias: 'child-b',
        dependsOn: [],
      },
    ];
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('p-001', 'not-started'),
        nodeStatus('p-002', 'not-started'),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_frontier_ambiguous');
    expect(result.refusal.candidates).toEqual(['p-001', 'p-002']);
    expect(result.refusal.message).toContain('p-001');
    expect(result.refusal.message).toContain('p-002');
    expect(result.refusal.message).toContain('--node');
  });

  it('refuses naming why when no node is runnable', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'in-flight'),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.message).toContain('g-001 is in-flight');
    expect(result.refusal.message).toContain('g-002 awaits g-001');
  });

  it('refuses a --node whose dependencies are not complete, naming them', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      nodeId: 'g-002',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.blockers).toEqual(['g-001']);
    expect(result.refusal.message).toContain('g-001');
  });

  it('accepts a --node whose dependency is run-terminal but unarchived (observation rule, D3)', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'run-terminal'),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({ ...input, nodeId: 'g-002' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.nodeId).toBe('g-002');
  });

  it('runs a dependent whose dependency is terminal-but-unarchived OVER a non-empty archive-based blockedBy (D3 pin)', async () => {
    // The discriminating cell for design D3's rule: g-001 finished its run
    // (observation run-terminal) but is NOT archived, so the plan read's
    // archive-based view keeps the dependency edge open — both the resolved
    // row and the status row carry blockedBy: ['g-001']. `isRunnable` keys on
    // the OBSERVATION, so g-002 is the frontier. Mutating the predicate to
    // the archive-based view (`blockedBy` empty) fails exactly this test
    // with the no-runnable-nodes refusal — the pin discriminates; that
    // mutation run is recorded in evidence/fix-round-1.md.
    const detail = detailFor(PLAN_NODES, nodeId =>
      nodeId === 'g-002' ? ['g-001'] : nodeId === 'g-003' ? ['g-001', 'g-002'] : []
    );
    const status = statusFor([
      nodeStatus('g-001', 'run-terminal'),
      nodeStatus('g-002', 'not-started', { blockedBy: ['g-001'] }),
      nodeStatus('g-003', 'not-started', { blockedBy: ['g-001', 'g-002'] }),
    ]);
    const result = await resolveIssueLaunchBinding({
      detail,
      status,
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.nodeId).toBe('g-002');
    expect(result.binding.mode).toBe('fresh');
  });

  it('refuses an unknown --node naming the plan nodes', async () => {
    const result = await resolveIssueLaunchBinding({ ...baseInput(), nodeId: 'g-999' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.message).toContain('g-999');
    expect(result.refusal.message).toContain('g-001');
  });

  it('refuses an intent node', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'No Change exists yet',
        dependsOn: [],
      },
    ];
    const detail = detailFor(nodes);
    const status = statusFor([
      {
        nodeId: 'i-001',
        kind: 'intent',
        lifecycle: null,
        reason: null,
        alias: null,
        observation: 'not-started',
        blockedBy: [],
        diagnostic: null,
        runStatePath: null,
        locatedBy: null,
        attribution: { pipeline: null, sessions: [], evidenceLocator: null },
      },
    ]);
    const result = await resolveIssueLaunchBinding({ detail, status, workspaceEntries: [], launchContextFor: LAUNCH_OK });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.message).toContain('intent node');
  });

  it('reports an in-flight node as already-running with its recorded pipeline', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'in-flight', {
        runStatePath: 'C:\\exec\\.rasen\\changes\\child-a\\ephemera\\auto-run.json',
        locatedBy: 'execution-root',
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({ ...input, nodeId: 'g-001' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.mode).toBe('already-running');
    expect(result.binding.pipeline).toBe('small-feature');
    expect(result.binding.runStatePath).toContain('auto-run.json');
    expect(result.binding.locatedBy).toBe('execution-root');
    // The resume-oriented contract still orients with a working directory.
    expect(result.binding.launch?.form).toBe('project-checkout');
  });

  it('reports a complete node with no launch contract at all', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'run-terminal', {
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({ ...input, nodeId: 'g-001' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.mode).toBe('already-complete');
    expect(result.binding.launch).toBeNull();
    expect(result.binding.pipeline).toBeNull();
  });

  it('refuses an unknown-observation node with its diagnostic', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'unknown', { diagnostic: 'reference ci:aaa has no committed Store evidence' }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({ ...input, nodeId: 'g-001' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.message).toContain('no committed Store evidence');
  });

  it('refuses an Issue with no readable published plan toward planning', async () => {
    const detail = detailFor(PLAN_NODES);
    const noPlan: IssueDetail = { ...detail, plan: null };
    const result = await resolveIssueLaunchBinding({
      detail: noPlan,
      status: statusFor([]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_requires_plan');
    expect(result.refusal.message).toContain('planning');
    expect(result.refusal.message).toContain('publish');
  });
});

describe('resolveIssueLaunchBinding — launch routes (D4)', () => {
  it('launches a workspace-bound Change from its pair execution root', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      workspaceEntries: [indexEntry()],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.launch).toEqual({
      form: 'workspace-pair',
      cwd: 'C:\\pair-execution',
      attachedRoots: ['C:\\pair-planning'],
    });
  });

  it('launches a registered checkout with the Store planning root attached', async () => {
    const result = await resolveIssueLaunchBinding(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.launch).toEqual({
      form: 'project-checkout',
      cwd: `C:\\checkout-${PROJECT}`,
      attachedRoots: ['C:\\store-root'],
    });
  });

  it('refuses an unprepared Change with the exact preparation command', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      launchContextFor: LAUNCH_NOT_FOUND,
      storeId: 'team-store',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_unprepared');
    expect(result.refusal.preparation).toBe(
      'rasen store workspace plan --existing-change --store team-store '
        + `--project ${PROJECT} --target-line ${LINE} --change child-a`
    );
  });

  it('carries a launch-context failure\'s own diagnostic through unchanged', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      launchContextFor: LAUNCH_NOT_MEMBER,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_launch_context_failed');
    expect(result.refusal.diagnostic).toBe(
      `Store "team-store" does not record project "${PROJECT}" as a member.`
    );
    expect(result.refusal.message).toContain('does not record project');
  });

  it('refuses several index entries for one instance, naming them', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      workspaceEntries: [
        indexEntry({ planningScopeId: 'scope-main', execution: side('C:\\exec-1') }),
        indexEntry({ planningScopeId: 'scope-side', execution: side('C:\\exec-2') }),
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_launch_context_failed');
    expect(result.refusal.diagnostic).toContain('C:\\exec-1');
    expect(result.refusal.diagnostic).toContain('C:\\exec-2');
    expect(result.refusal.message).toContain('2 workspace index entries');
  });

  it('keeps an already-running node\'s report when no route resolves, carrying why', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'in-flight', {
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({
      ...input,
      nodeId: 'g-001',
      launchContextFor: LAUNCH_NOT_MEMBER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.mode).toBe('already-running');
    expect(result.binding.launch).toBeNull();
    expect(result.binding.launchDiagnostic).toContain('does not record project');
    expect(result.binding.pipeline).toBe('small-feature');
  });
});

describe('resolveIssueLaunchBinding — pipeline resolution (D5)', () => {
  it('records a supplied --pipeline after registry validation', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      pipeline: 'bug-fix',
      pipelineKnown: KNOWN_PIPELINES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.pipeline).toBe('bug-fix');
  });

  it('refuses an unknown --pipeline', async () => {
    const result = await resolveIssueLaunchBinding({
      ...baseInput(),
      pipeline: 'no-such-pipeline',
      pipelineKnown: KNOWN_PIPELINES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_pipeline_unknown');
    expect(result.refusal.message).toContain('no-such-pipeline');
  });

  it('falls back to the pipeline the located run-state records', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'not-started', {
        runStatePath: 'C:\\exec\\.rasen\\changes\\child-a\\ephemera\\auto-run.json',
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.pipeline).toBe('small-feature');
  });

  it('refuses a --pipeline that disagrees with a running node\'s recorded pipeline', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'in-flight', {
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({
      ...input,
      nodeId: 'g-001',
      pipeline: 'bug-fix',
      pipelineKnown: KNOWN_PIPELINES,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_pipeline_conflict');
    expect(result.refusal.message).toContain('bug-fix');
    expect(result.refusal.message).toContain('small-feature');
  });

  it('accepts a --pipeline that agrees with the recorded one', async () => {
    const input = baseInput();
    input.status = statusFor([
      nodeStatus('g-001', 'in-flight', {
        attribution: { pipeline: 'small-feature', sessions: [], evidenceLocator: null },
      }),
      nodeStatus('g-002', 'not-started'),
      nodeStatus('g-003', 'not-started'),
    ]);
    const result = await resolveIssueLaunchBinding({
      ...input,
      nodeId: 'g-001',
      pipeline: 'small-feature',
      pipelineKnown: KNOWN_PIPELINES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.mode).toBe('already-running');
    expect(result.binding.pipeline).toBe('small-feature');
  });
});

describe('resolveIssueLaunchBinding — determinism', () => {
  it('yields the same binding for the same inputs twice', async () => {
    const input = baseInput();
    const first = await resolveIssueLaunchBinding(input);
    const second = await resolveIssueLaunchBinding(input);
    expect(second).toEqual(first);
  });
});

describe('resolveIssueLaunchBinding — node lifecycles', () => {
  /** Two parallel nodes, one wanted and one not, both otherwise runnable. */
  const LIFECYCLE_NODES: readonly ExecutionPlanNode[] = [
    {
      nodeId: 'g-001',
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: 'ci:aaa',
      changeAlias: 'child-a',
      dependsOn: [],
    },
    {
      nodeId: 'g-cut',
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: 'ci:ddd',
      changeAlias: 'child-cut',
      lifecycle: 'cancelled',
      reason: 'dropped from the portfolio mid-flight',
      dependsOn: [],
    },
  ];

  it('refuses a --node on a cancelled node, naming the lifecycle and reason', async () => {
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(LIFECYCLE_NODES),
      status: statusFor([
        nodeStatus('g-001', 'not-started'),
        nodeStatus('g-cut', 'not-started', {
          lifecycle: 'cancelled',
          reason: 'dropped from the portfolio mid-flight',
        }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
      nodeId: 'g-cut',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_cancelled');
    expect(result.refusal.message).toContain('g-cut');
    expect(result.refusal.message).toContain('cancelled');
    expect(result.refusal.message).toContain('dropped from the portfolio mid-flight');
  });

  it('refuses a --node on a superseded node, naming the lifecycle and reason', async () => {
    const nodes: readonly ExecutionPlanNode[] = LIFECYCLE_NODES.map(node =>
      node.nodeId === 'g-cut'
        ? {
            ...node,
            lifecycle: 'superseded' as const,
            reason: 'folded into g-001, which carries the same work',
          }
        : node
    );
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('g-001', 'not-started'),
        nodeStatus('g-cut', 'not-started', {
          lifecycle: 'superseded',
          reason: 'folded into g-001, which carries the same work',
        }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
      nodeId: 'g-cut',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_superseded');
    expect(result.refusal.message).toContain('superseded');
    expect(result.refusal.message).toContain('folded into g-001');
  });

  it('resolves the frontier to the required node alone — a cancelled sibling is never a candidate', async () => {
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(LIFECYCLE_NODES),
      status: statusFor([
        nodeStatus('g-001', 'not-started'),
        nodeStatus('g-cut', 'not-started', {
          lifecycle: 'cancelled',
          reason: 'dropped from the portfolio mid-flight',
        }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    // Had both qualified, the several-candidates refusal would have fired;
    // the frontier names g-001 alone, so this is a single fresh launch.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.nodeId).toBe('g-001');
    expect(result.binding.mode).toBe('fresh');
  });

  it('names a cancelled node as cancelled (with its reason) when nothing is runnable', async () => {
    const nodes: readonly ExecutionPlanNode[] = LIFECYCLE_NODES.map(node =>
      node.nodeId === 'g-001'
        ? { ...node, dependsOn: ['g-cut'] as readonly string[] }
        : node
    );
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(nodes),
      status: statusFor([
        nodeStatus('g-001', 'not-started', { blockedBy: ['g-cut'] }),
        nodeStatus('g-cut', 'not-started', {
          lifecycle: 'cancelled',
          reason: 'dropped from the portfolio mid-flight',
        }),
      ]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe('issue_start_node_not_runnable');
    expect(result.refusal.message).toContain('g-cut is cancelled');
    expect(result.refusal.message).toContain('dropped from the portfolio mid-flight');
    // The honest defect of a required node awaiting cancelled work is named
    // too: the plan is defective, not silently treated-as-complete.
    expect(result.refusal.message).toContain('g-001 awaits g-cut');
  });

  it('launches an optional node exactly like a required one', async () => {
    const nodes: readonly ExecutionPlanNode[] = [
      {
        nodeId: 'g-opt',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: 'ci:aaa',
        changeAlias: 'child-a',
        lifecycle: 'optional',
        dependsOn: [],
      },
    ];
    const result = await resolveIssueLaunchBinding({
      detail: detailFor(nodes),
      status: statusFor([nodeStatus('g-opt', 'not-started', { lifecycle: 'optional' })]),
      workspaceEntries: [],
      launchContextFor: LAUNCH_OK,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.binding.nodeId).toBe('g-opt');
    expect(result.binding.mode).toBe('fresh');
    expect(result.binding.launch?.form).toBe('project-checkout');
  });
});
