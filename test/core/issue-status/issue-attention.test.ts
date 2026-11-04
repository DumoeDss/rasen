/**
 * `issue-needs-attention` tasks 1.2/1.3 — `deriveIssueAttention` unit tests,
 * per scenario of the new spec: each of the five kinds' derivation, the
 * absence discipline's enumerated exclusions, the one-hop blocked-behind
 * boundary, kind ordering, and determinism over unchanged input.
 *
 * The derivation is pure over its (issueId, status) input, so these units
 * build synthetic statuses directly — no Store, no filesystem — the same
 * builder discipline `issue-ready-set.test.ts` established. The
 * projection-consistency the blocked-behind rule relies on (a terminal
 * dependency is never listed in `blockedBy`) is honored by the row builder,
 * the same way `withBlockerFacts` derives it.
 */
import { describe, expect, it } from 'vitest';

import { deriveIssueAttention } from '../../../src/core/issue-status/index.js';
import type {
  IssueAcceptanceStatusBlock,
  IssueHealth,
  IssueNodeObservation,
  IssueNodeStatus,
  IssuePhase,
  IssueStatus,
  IssueStatusProblem,
} from '../../../src/core/issue-status/index.js';
import type { ExecutionPlanNode } from '../../../src/core/store/issues/index.js';

const ISSUE = 'fleet-alpha';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';

interface RowSpec {
  readonly nodeId: string;
  readonly observation: IssueNodeObservation;
  readonly kind?: 'change' | 'intent';
  readonly lifecycle?: 'required' | 'optional' | 'cancelled' | 'superseded';
  readonly projectId?: string;
  readonly diagnostic?: string;
  readonly locatedBy?: 'execution-root' | 'workspace-index' | null;
  readonly alias?: string;
}

/** Builds the projection-consistent status over one plan: rows completed from
 * the plan's own spelling, dependency facts on the work-complete basis. */
function statusOver(
  plan: readonly ExecutionPlanNode[],
  rows: readonly RowSpec[],
  extra: Partial<Pick<IssueStatus, 'phase' | 'health' | 'problems' | 'acceptance'>> = {}
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
      reason: planned?.reason ?? null,
      suggestedPipeline: planned?.suggestedPipeline ?? null,
      rationale: null,
      uncertainty: null,
      alias: isIntent
        ? null
        : (spec.alias ?? (planned?.kind === 'change' ? (planned.changeAlias ?? null) : null)),
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
    ...extra,
  };
}

function changeNode(
  nodeId: string,
  projectId: string,
  dependsOn: readonly string[] = [],
  extra: Partial<Pick<ExecutionPlanNode, 'lifecycle' | 'changeAlias'>> = {}
): ExecutionPlanNode {
  return {
    nodeId,
    kind: 'change',
    projectId,
    targetLineId: LINE,
    changeInstanceId: `ci:${nodeId}`,
    ...(extra.changeAlias === undefined ? {} : { changeAlias: extra.changeAlias }),
    ...(extra.lifecycle === undefined ? {} : { lifecycle: extra.lifecycle }),
    dependsOn,
  };
}

const A_GATE = {
  conditionsRevisionId: '0001',
  eligible: true,
  blockers: [],
  exclusions: [],
  optionalNodes: [],
  message: 'eligible',
} as unknown as IssueAcceptanceStatusBlock['gate'];

describe('deriveIssueAttention — the five kinds (spec scenarios)', () => {
  it('a failed node among running siblings is ONE failure item carrying active/failed beside the node', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-run-1', PROJECT_A, [], { changeAlias: 'run-1' }),
      changeNode('g-run-2', PROJECT_A, [], { changeAlias: 'run-2' }),
      changeNode('g-fail', PROJECT_A, [], { changeAlias: 'boom' }),
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [
          { nodeId: 'g-run-1', observation: 'in-flight' },
          { nodeId: 'g-run-2', observation: 'in-flight' },
          { nodeId: 'g-fail', observation: 'failed' },
        ],
        // The projection's own axes for this shape: the graph is active, the
        // health is failed — carried verbatim, the unmasked read.
        { phase: 'active', health: 'failed' as IssueHealth }
      )
    );
    expect(items).toEqual([
      {
        kind: 'failure',
        issueId: ISSUE,
        phase: 'active',
        health: 'failed',
        nodeId: 'g-fail',
        alias: 'boom',
        diagnostic: null,
      },
    ]);
  });

  it('a node blocked behind trouble is a blocked-behind item naming every non-terminal direct dependency', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-dead', PROJECT_B, []),
      changeNode('g-live', PROJECT_A, []),
      changeNode('g-down', PROJECT_A, ['g-dead', 'g-live']),
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(plan, [
        { nodeId: 'g-dead', observation: 'unknown', diagnostic: 'invalid run-state bytes', projectId: PROJECT_B },
        { nodeId: 'g-live', observation: 'in-flight' },
        { nodeId: 'g-down', observation: 'not-started' },
      ])
    );
    expect(items).toEqual([
      {
        kind: 'blocked-behind',
        issueId: ISSUE,
        phase: 'active',
        health: 'healthy',
        nodeId: 'g-down',
        alias: null,
        blockers: [
          // The trouble is named in the node line's refinement vocabulary,
          // and the ordinary in-flight sibling is named the same way — every
          // non-terminal direct dependency, not only the failing one.
          { nodeId: 'g-dead', projectId: PROJECT_B, state: 'unknown (invalid run-state bytes)' },
          { nodeId: 'g-live', projectId: PROJECT_A, state: 'in-flight' },
        ],
      },
    ]);
  });

  it('a parked stage is a waiting-human item carrying the Issue health the projection already read', () => {
    const plan: readonly ExecutionPlanNode[] = [changeNode('g-park', PROJECT_A)];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [{ nodeId: 'g-park', observation: 'waiting-human' }],
        { phase: 'active', health: 'waiting-human' as IssueHealth }
      )
    );
    expect(items).toEqual([
      {
        kind: 'waiting-human',
        issueId: ISSUE,
        phase: 'active',
        health: 'waiting-human',
        nodeId: 'g-park',
        alias: null,
      },
    ]);
  });

  it('a review-phase Issue is ONE acceptance-awaiting item carrying the gate evaluation', () => {
    const plan: readonly ExecutionPlanNode[] = [changeNode('g-done', PROJECT_A)];
    const open = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [{ nodeId: 'g-done', observation: 'run-terminal' }],
        { phase: 'review' as IssuePhase, health: 'waiting-human' as IssueHealth }
      )
    );
    expect(open).toEqual([
      {
        kind: 'acceptance-awaiting',
        issueId: ISSUE,
        phase: 'review',
        health: 'waiting-human',
        nodeId: null,
        alias: null,
        gate: null,
      },
    ]);
    // The same item fires with the gate carried when acceptance facts were
    // supplied — and for a resolved Issue without a verified record (the
    // legacy-close upgrade path), which the projection also reads `review`.
    const withGate = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [{ nodeId: 'g-done', observation: 'run-terminal' }],
        {
          phase: 'review',
          health: 'waiting-human',
          acceptance: { conditions: null, gate: A_GATE, record: null } as unknown as IssueAcceptanceStatusBlock,
        }
      )
    );
    expect(withGate[0]).toMatchObject({ kind: 'acceptance-awaiting', gate: A_GATE });
  });

  it('every standing problem is an item, none dropped', () => {
    const plan: readonly ExecutionPlanNode[] = [changeNode('g-1', PROJECT_A), changeNode('g-2', PROJECT_A)];
    const problems: readonly IssueStatusProblem[] = [
      { kind: 'invalid-run-state', node: 'g-1', ref: 'C:/eph/g-1/auto-run.json', reason: 'not JSON' },
      { kind: 'unresolved-reference', node: 'g-2', ref: null, reason: 'no committed evidence (unresolved)' },
      { kind: 'unsearched-refs', node: null, ref: 'refs/heads/other', reason: 'line-0.2: fetch failed' },
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [
          { nodeId: 'g-1', observation: 'unknown', diagnostic: 'not JSON' },
          { nodeId: 'g-2', observation: 'unknown', diagnostic: 'no committed evidence (unresolved)' },
        ],
        { problems }
      )
    );
    // The unknown nodes are NOT failure or blocked-behind items — their
    // unreadability is the problem items' story, carried verbatim. The stable
    // (issueId, nodeId) order sorts the Issue-level problem (null node) first.
    expect(items.map(item => item.kind)).toEqual(['problem', 'problem', 'problem']);
    expect(items.map(item => item.problem)).toEqual([
      problems[2],
      problems[0],
      problems[1],
    ]);
    expect(items.map(item => item.nodeId)).toEqual([null, 'g-1', 'g-2']);
  });
});

describe('deriveIssueAttention — ordinary progress is not attention (the exclusions)', () => {
  it('a healthy in-flight Issue contributes no items for any of its nodes', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-a', PROJECT_A),
      changeNode('g-b', PROJECT_B),
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(plan, [
        { nodeId: 'g-a', observation: 'in-flight' },
        { nodeId: 'g-b', observation: 'advanced' },
      ])
    );
    expect(items).toEqual([]);
  });

  it('terminal, finalized, ready, and serial-wait nodes contribute nothing', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-term', PROJECT_A),
      changeNode('g-fin', PROJECT_A),
      changeNode('g-ready', PROJECT_A),
      changeNode('g-up', PROJECT_A),
      changeNode('g-serial', PROJECT_A, ['g-up']),
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(plan, [
        { nodeId: 'g-term', observation: 'run-terminal' },
        { nodeId: 'g-fin', observation: 'finalized' },
        { nodeId: 'g-ready', observation: 'not-started' },
        { nodeId: 'g-up', observation: 'in-flight' },
        // The serial wait: not-started behind a healthy in-flight dependency —
        // scheduling, not sickness, exactly as the health axis rules.
        { nodeId: 'g-serial', observation: 'not-started' },
      ])
    );
    expect(items).toEqual([]);
  });

  it('unwanted nodes contribute nothing even with attention-worthy observations', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-cut', PROJECT_A, [], { lifecycle: 'cancelled' }),
      changeNode('g-old', PROJECT_A, [], { lifecycle: 'superseded' }),
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT_B,
        targetLineId: LINE,
        summary: 'docs',
        dependsOn: [],
      },
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(plan, [
        { nodeId: 'g-cut', observation: 'failed', lifecycle: 'cancelled' },
        { nodeId: 'g-old', observation: 'waiting-human', lifecycle: 'superseded' },
        { nodeId: 'i-001', observation: 'not-started', kind: 'intent' },
      ])
    );
    expect(items).toEqual([]);
  });
});

describe('deriveIssueAttention — the one-hop blocked-behind boundary (task 1.3)', () => {
  const GRANDPARENT_FAILED: readonly ExecutionPlanNode[] = [
    changeNode('g-top', PROJECT_A),
    changeNode('g-mid', PROJECT_A, ['g-top']),
    changeNode('g-bot', PROJECT_A, ['g-mid']),
  ];

  it('a direct dependency observing failed, waiting-human, or unknown makes the item', () => {
    for (const trouble of ['failed', 'waiting-human', 'unknown'] as const) {
      const items = deriveIssueAttention(
        ISSUE,
        statusOver(GRANDPARENT_FAILED, [
          { nodeId: 'g-top', observation: 'not-started' },
          { nodeId: 'g-mid', observation: trouble },
          { nodeId: 'g-bot', observation: 'not-started' },
        ])
      );
      // Each hop lists itself: g-bot (behind the troubled g-mid) AND g-mid
      // itself when its trouble is a failure or a human wait — never a
      // transitive closure that would blur which node waits on what.
      const blockedBehind = items.filter(item => item.kind === 'blocked-behind');
      expect(
        blockedBehind.map(item => item.nodeId),
        `direct blocker ${trouble}`
      ).toEqual(['g-bot']);
      if (trouble === 'failed') {
        expect(items.filter(item => item.kind === 'failure').map(item => item.nodeId)).toEqual([
          'g-mid',
        ]);
      }
    }
  });

  it('a direct dependency that is not-started or healthy in-flight makes NO item, even when a grandparent failed', () => {
    for (const ordinary of ['not-started', 'in-flight'] as const) {
      const items = deriveIssueAttention(
        ISSUE,
        statusOver(GRANDPARENT_FAILED, [
          { nodeId: 'g-top', observation: 'failed' },
          { nodeId: 'g-mid', observation: ordinary },
          { nodeId: 'g-bot', observation: 'not-started' },
        ])
      );
      // The failed grandparent is its own failure item. When the hop between
      // is itself not-started, THAT hop lists itself blocked-behind (one hop
      // from the failure, on its own); when it is in-flight it lists nothing —
      // the blocked-behind trigger requires the node itself not-started. The
      // TWO-hop downstream (g-bot, whose direct blocker g-mid is ordinary
      // progress either way) is never an item.
      expect(
        items.map(item => `${item.kind}:${item.nodeId}`),
        `direct blocker ${ordinary}`
      ).toEqual(ordinary === 'not-started' ? ['failure:g-top', 'blocked-behind:g-mid'] : ['failure:g-top']);
      expect(
        items.some(item => item.nodeId === 'g-bot'),
        `direct blocker ${ordinary}: two hops down never lists`
      ).toBe(false);
    }
  });
});

describe('deriveIssueAttention — ordering and determinism', () => {
  it('orders kinds fail-first and nodes stably within every group', () => {
    const plan: readonly ExecutionPlanNode[] = [
      changeNode('g-z-fail', PROJECT_A),
      changeNode('g-a-fail', PROJECT_A),
      changeNode('g-park', PROJECT_A),
      changeNode('g-dead', PROJECT_A),
      changeNode('g-down', PROJECT_A, ['g-dead']),
    ];
    const items = deriveIssueAttention(
      ISSUE,
      statusOver(
        plan,
        [
          { nodeId: 'g-z-fail', observation: 'failed' },
          { nodeId: 'g-a-fail', observation: 'failed' },
          { nodeId: 'g-park', observation: 'waiting-human' },
          { nodeId: 'g-dead', observation: 'failed' },
          { nodeId: 'g-down', observation: 'not-started' },
        ],
        { health: 'failed' as IssueHealth }
      )
    );
    expect(items.map(item => `${item.kind}:${item.nodeId}`)).toEqual([
      // failure first, stable by nodeId within the group — the declaration
      // order of the plan does not survive, the stable order does.
      'failure:g-a-fail',
      'failure:g-dead',
      'failure:g-z-fail',
      'blocked-behind:g-down',
      'waiting-human:g-park',
    ]);
  });

  it('unchanged evidence yields the same items, twice', () => {
    const status = statusOver(
      [changeNode('g-dead', PROJECT_A), changeNode('g-down', PROJECT_A, ['g-dead'])],
      [
        { nodeId: 'g-dead', observation: 'failed' },
        { nodeId: 'g-down', observation: 'not-started' },
      ],
      { health: 'failed' as IssueHealth }
    );
    expect(deriveIssueAttention(ISSUE, status)).toEqual(deriveIssueAttention(ISSUE, status));
  });

  it('an Issue with an unreadable plan still derives — the problem is the item', () => {
    const items = deriveIssueAttention(
      ISSUE,
      statusOver([], [], {
        phase: 'planning',
        problems: [
          { kind: 'unreadable-plan', node: null, ref: '0003', reason: 'digest mismatch' },
        ],
      })
    );
    expect(items).toEqual([
      {
        kind: 'problem',
        issueId: ISSUE,
        phase: 'planning',
        health: 'healthy',
        nodeId: null,
        alias: null,
        problem: { kind: 'unreadable-plan', node: null, ref: '0003', reason: 'digest mismatch' },
      },
    ]);
  });
});
