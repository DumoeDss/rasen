/**
 * `issue-ready-set-scheduling` task 4.2 — `deriveIssueReadySet` unit tests,
 * per scenario of the new spec: serial chain head, cross-project release on
 * completed work, parallel opportunities, determinism, unreadable revision,
 * and every exit-reason branch of the closed vocabulary.
 *
 * The derivation is pure over its `IssueStatus` input, so these units build
 * synthetic statuses directly — no Store, no filesystem — and hold the
 * membership rule and the exit vocabulary to the spec's letter. The
 * projection-consistency the rule relies on (a terminal dependency is never
 * listed in `blockedBy`) is honored by the row builder below, the same way
 * `withBlockerFacts` derives it.
 */
import { describe, expect, it } from 'vitest';

import { deriveIssueReadySet } from '../../../src/core/issue-status/index.js';
import type {
  IssueNodeObservation,
  IssueNodeStatus,
  IssueStatus,
} from '../../../src/core/issue-status/index.js';
import type { ExecutionPlanNode } from '../../../src/core/store/issues/index.js';

const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';

interface RowSpec {
  readonly nodeId: string;
  readonly observation: IssueNodeObservation;
  readonly kind?: 'change' | 'intent';
  readonly lifecycle?: 'required' | 'optional' | 'cancelled' | 'superseded';
  readonly reason?: string;
  readonly projectId?: string;
  readonly diagnostic?: string;
  readonly locatedBy?: 'execution-root' | 'workspace-index' | null;
  readonly suggestedPipeline?: string;
  readonly alias?: string;
}

/** Builds the projection-consistent status over one plan: rows completed from
 * the plan's own spelling, dependency facts on the work-complete basis. */
function statusOver(
  plan: readonly ExecutionPlanNode[],
  rows: readonly RowSpec[]
): IssueStatus {
  const planById = new Map(plan.map(node => [node.nodeId, node] as const));
  const built: IssueNodeStatus[] = rows.map(spec => {
    const planned = planById.get(spec.nodeId);
    const isIntent = (spec.kind ?? planned?.kind) === 'intent';
    return {
      nodeId: spec.nodeId,
      kind: isIntent ? 'intent' : 'change',
      projectId: spec.projectId ?? planned?.projectId ?? PROJECT_A,
      targetLineId: planned?.targetLineId ?? LINE,
      lifecycle: spec.lifecycle ?? planned?.lifecycle ?? 'required',
      reason: spec.reason ?? planned?.reason ?? null,
      suggestedPipeline: spec.suggestedPipeline ?? planned?.suggestedPipeline ?? null,
      rationale: null,
      uncertainty: null,
      alias: isIntent ? null : (spec.alias ?? (planned?.kind === 'change' ? (planned.changeAlias ?? null) : null)),
      observation: spec.observation,
      blockedBy: [],
      diagnostic: spec.diagnostic ?? null,
      runStatePath: null,
      locatedBy: spec.locatedBy ?? null,
      attribution: { pipeline: null, sessions: [], evidenceLocator: null },
    };
  });
  const byId = new Map(built.map(row => [row.nodeId, row] as const));
  const withFacts = built.map(row => ({
    ...row,
    blockedBy: (planById.get(row.nodeId)?.dependsOn ?? [])
      .filter(
        dep =>
          byId.get(dep)?.observation !== 'finalized' &&
          byId.get(dep)?.observation !== 'run-terminal'
      )
      .map(dep => {
        const dependency = byId.get(dep);
        return {
          nodeId: dep,
          projectId: dependency?.projectId ?? '',
          observation: dependency?.observation ?? ('unknown' as const),
        };
      }),
  }));
  const required = withFacts.filter(
    row => row.kind === 'change' && row.lifecycle === 'required'
  );
  return {
    phase: 'active',
    health: 'healthy',
    progress: {
      completed: required.filter(
        row => row.observation === 'finalized' || row.observation === 'run-terminal'
      ).length,
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

function changeNode(
  nodeId: string,
  projectId: string,
  dependsOn: readonly string[] = [],
  extra: Partial<Pick<ExecutionPlanNode, 'lifecycle' | 'reason' | 'suggestedPipeline' | 'changeAlias'>> = {}
): ExecutionPlanNode {
  return {
    nodeId,
    kind: 'change',
    projectId,
    targetLineId: LINE,
    changeInstanceId: `ci:${nodeId}`,
    ...(extra.changeAlias === undefined ? {} : { changeAlias: extra.changeAlias }),
    ...(extra.lifecycle === undefined ? {} : { lifecycle: extra.lifecycle }),
    ...(extra.reason === undefined ? {} : { reason: extra.reason }),
    ...(extra.suggestedPipeline === undefined ? {} : { suggestedPipeline: extra.suggestedPipeline }),
    dependsOn,
  };
}

const SERIAL: readonly ExecutionPlanNode[] = [
  changeNode('g-001', PROJECT_A),
  changeNode('g-002', PROJECT_A, ['g-001']),
  changeNode('g-003', PROJECT_A, ['g-002']),
];

describe('deriveIssueReadySet — membership (spec scenarios)', () => {
  it('a serial chain head is the only member; each later node waits on its predecessor', () => {
    const ready = deriveIssueReadySet(
      statusOver(SERIAL, [
        { nodeId: 'g-001', observation: 'not-started' },
        { nodeId: 'g-002', observation: 'not-started' },
        { nodeId: 'g-003', observation: 'not-started' },
      ])
    );
    expect(ready).not.toBeNull();
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-001']);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-002')).toEqual({
      kind: 'blocked',
      blockers: [{ nodeId: 'g-001', projectId: PROJECT_A, state: 'not-started, no local run-state' }],
    });
    expect(reasonByNode.get('g-003')).toEqual({
      kind: 'blocked',
      blockers: [{ nodeId: 'g-002', projectId: PROJECT_A, state: 'not-started, no local run-state' }],
    });
  });

  it('a cross-project dependency releases on completed work, before any archive', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-up', PROJECT_B),
      changeNode('g-down', PROJECT_A, ['g-up']),
    ];
    const ready = deriveIssueReadySet(
      statusOver(plan, [
        { nodeId: 'g-up', observation: 'run-terminal', projectId: PROJECT_B },
        { nodeId: 'g-down', observation: 'not-started' },
      ])
    );
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-down']);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-up')).toEqual({ kind: 'complete', basis: null });
  });

  it('parallel opportunities are listed, not chosen among', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('p-001', PROJECT_A, [], { changeAlias: 'child-a', suggestedPipeline: 'small-feature' }),
      changeNode('p-002', PROJECT_B, [], { changeAlias: 'child-b', lifecycle: 'optional' }),
    ];
    const ready = deriveIssueReadySet(
      statusOver(plan, [
        { nodeId: 'p-001', observation: 'not-started' },
        { nodeId: 'p-002', observation: 'not-started' },
      ])
    );
    expect(ready?.members).toEqual([
      {
        nodeId: 'p-001',
        projectId: PROJECT_A,
        targetLineId: LINE,
        alias: 'child-a',
        suggestedPipeline: 'small-feature',
        lifecycle: 'required',
      },
      {
        nodeId: 'p-002',
        projectId: PROJECT_B,
        targetLineId: LINE,
        alias: 'child-b',
        suggestedPipeline: null,
        lifecycle: 'optional',
      },
    ]);
    expect(ready?.exits).toEqual([]);
  });

  it('unchanged evidence yields the same ready set, twice', () => {
    const status = statusOver(SERIAL, [
      { nodeId: 'g-001', observation: 'not-started' },
      { nodeId: 'g-002', observation: 'not-started' },
      { nodeId: 'g-003', observation: 'not-started' },
    ]);
    expect(deriveIssueReadySet(status)).toEqual(deriveIssueReadySet(status));
  });

  it('an unreadable revision yields NO ready set, never an empty one', () => {
    const status = statusOver([], []);
    const unreadable: IssueStatus = { ...status, progress: null };
    expect(deriveIssueReadySet(unreadable)).toBeNull();
  });
});

describe('deriveIssueReadySet — the closed exit vocabulary', () => {
  it('every exit branch derives from the node it names, with no state invented', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-cut', PROJECT_A, [], { lifecycle: 'cancelled', reason: 'descoped' }),
      changeNode('g-old', PROJECT_A, [], { lifecycle: 'superseded', reason: 'folded into g-001' }),
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT_B,
        targetLineId: LINE,
        summary: 'docs for the widget',
        dependsOn: [],
      },
      changeNode('g-run', PROJECT_A),
      changeNode('g-adv', PROJECT_A),
      changeNode('g-wait', PROJECT_A),
      changeNode('g-fail', PROJECT_A),
      changeNode('g-fin', PROJECT_A),
      changeNode('g-term', PROJECT_A),
      changeNode('g-unk', PROJECT_A),
      changeNode('g-block', PROJECT_A, ['g-run', 'g-unk']),
      changeNode('g-xproj', PROJECT_A, ['g-cut']),
    ];
    const ready = deriveIssueReadySet(
      statusOver(plan, [
        { nodeId: 'g-cut', observation: 'not-started' },
        { nodeId: 'g-old', observation: 'not-started' },
        { nodeId: 'i-001', observation: 'not-started' },
        { nodeId: 'g-run', observation: 'in-flight' },
        { nodeId: 'g-adv', observation: 'advanced' },
        { nodeId: 'g-wait', observation: 'waiting-human' },
        { nodeId: 'g-fail', observation: 'failed' },
        {
          nodeId: 'g-fin',
          observation: 'finalized',
          diagnostic: 'finalized on a legacy archive record (no v2 outcome was ever recorded)',
        },
        { nodeId: 'g-term', observation: 'run-terminal' },
        { nodeId: 'g-unk', observation: 'unknown', diagnostic: 'invalid run-state bytes' },
        { nodeId: 'g-block', observation: 'not-started' },
        { nodeId: 'g-xproj', observation: 'not-started' },
      ])
    );
    // Nothing is runnable: every candidate is either begun, dead, unknown, or
    // waiting on one of those.
    expect(ready?.members).toEqual([]);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-cut')).toEqual({ kind: 'cancelled', reason: 'descoped' });
    expect(reasonByNode.get('g-old')).toEqual({ kind: 'superseded', reason: 'folded into g-001' });
    expect(reasonByNode.get('i-001')).toEqual({
      kind: 'pending-change-creation',
      projectId: PROJECT_B,
      targetLineId: LINE,
    });
    expect(reasonByNode.get('g-run')).toEqual({ kind: 'running', observation: 'in-flight' });
    expect(reasonByNode.get('g-adv')).toEqual({ kind: 'running', observation: 'advanced' });
    expect(reasonByNode.get('g-wait')).toEqual({ kind: 'running', observation: 'waiting-human' });
    expect(reasonByNode.get('g-fail')).toEqual({ kind: 'failed' });
    // A complete node names its completion basis when the diagnostic carries
    // one — the legacy archive record ruling's visibility.
    expect(reasonByNode.get('g-fin')).toEqual({
      kind: 'complete',
      basis: 'finalized on a legacy archive record (no v2 outcome was ever recorded)',
    });
    expect(reasonByNode.get('g-term')).toEqual({ kind: 'complete', basis: null });
    expect(reasonByNode.get('g-unk')).toEqual({
      kind: 'unknown',
      diagnostic: 'invalid run-state bytes',
    });
    // A blocked node names each non-terminal dependency with project and the
    // node line's refinement vocabulary — cross-project blockers included, and
    // a cancelled dependency never reads complete.
    expect(reasonByNode.get('g-block')).toEqual({
      kind: 'blocked',
      blockers: [
        { nodeId: 'g-run', projectId: PROJECT_A, state: 'in-flight' },
        { nodeId: 'g-unk', projectId: PROJECT_A, state: 'unknown (invalid run-state bytes)' },
      ],
    });
    expect(reasonByNode.get('g-xproj')).toEqual({
      kind: 'blocked',
      blockers: [
        { nodeId: 'g-cut', projectId: PROJECT_A, state: 'not-started, no local run-state' },
      ],
    });
  });

  it('a running node is named running even when it also has incomplete dependencies', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-up', PROJECT_A),
      changeNode('g-run', PROJECT_A, ['g-up']),
    ];
    const ready = deriveIssueReadySet(
      statusOver(plan, [
        { nodeId: 'g-up', observation: 'not-started' },
        { nodeId: 'g-run', observation: 'in-flight' },
      ])
    );
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    // The observation is the reason — the dependency facts are not reported.
    expect(reasonByNode.get('g-run')).toEqual({ kind: 'running', observation: 'in-flight' });
    // The unblocked upstream is itself ready; only the running node exits.
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-up']);
  });
});
