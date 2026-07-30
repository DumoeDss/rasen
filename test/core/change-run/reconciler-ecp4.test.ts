import { describe, expect, it } from 'vitest';

import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import {
  createRuntimePlan,
  type RuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  fixtureLimits,
  fixtureWorkspaceRevision,
  startRecord,
} from './reconciler-fixture.js';
import {
  deriveInvocationId,
} from '../../../src/core/change-run/internal/identity.js';
import type {
  ActionId,
  JsonValue,
  NodeId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<never>(`sha256:${char.repeat(64)}`);

const RUN_ID = branded<RunId>(`run:${'e'.repeat(64)}`);

function ecp4PlanInput(nodes: RuntimePlanInput['nodes']): RuntimePlanInput {
  return {
    runId: RUN_ID,
    pipeline: 'ecp4-test',
    planDigest: digest('2') as never,
    profileDigest: digest('3') as never,
    sourceRevisionDigest: digest('4') as never,
    capabilityDigest: digest('5') as never,
    policyDigest: digest('6') as never,
    implicitFinishOutcome: 'completed',
    nodes,
  };
}

function fanOutPlanInput(opts?: {
  cap?: number;
  budget?: number;
  members?: ReadonlyArray<{ id: string; required: boolean; condition: string }>;
}): RuntimePlanInput {
  const cap = opts?.cap ?? 3;
  const budget = opts?.budget ?? 6;
  const members = opts?.members ?? [
    { id: 'review', required: true, condition: 'always' },
    { id: 'cso', required: false, condition: 'security-relevant' },
    { id: 'benchmark', required: false, condition: 'performance-sensitive' },
    { id: 'qa', required: false, condition: 'ui' },
  ];
  const memberPaths = members.map((m) => `root:experts/${m.id}`);
  return ecp4PlanInput([
    {
      kind: 'fan-out',
      hierarchicalPath: 'root:experts',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      fanOut: {
        members: members.map((m) => ({
          hierarchicalPath: `root:experts/${m.id}`,
          required: m.required,
          condition: m.condition,
        })),
        concurrencyCap: cap,
        budget,
        joinNodeId: 'root:experts-join',
      },
    },
    ...members.map((m) => ({
      kind: 'atomic' as const,
      hierarchicalPath: `root:experts/${m.id}`,
      requires: ['root:experts'],
      admissionKind: 'agent' as const,
      workspace: { access: 'read' as const },
      fanOutTag: { nodeId: 'root:experts', required: m.required },
    })),
    {
      kind: 'join',
      hierarchicalPath: 'root:experts-join',
      requires: memberPaths,
      join: {
        requiredMembers: members.filter((m) => m.required).map((m) => `root:experts/${m.id}`),
        optionalMembers: members.filter((m) => !m.required).map((m) => `root:experts/${m.id}`),
        outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
      },
    },
  ]);
}

function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

/**
 * Build a valid agent RunAction for any node (not just atomic). Uses the
 * same identity equations as agentAction from the fixture, but works for
 * choice/fan-out/join nodes too.
 */
function actionForNode(
  plan: RuntimePlan,
  hierarchicalPath: string
): RunAction {
  return agentAction(plan, hierarchicalPath);
}

/**
 * Commit a succeeded result for a node by path. Admits the action,
 * observes the effect, and commits the result.
 */
function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true },
  status: 'succeeded' | 'failed' = 'succeeded'
): CanonicalRunRecord {
  const action = actionForNode(plan, path);
  let next = apply(plan, record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(plan, next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  next = apply(plan, next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
  return next;
}

describe('reconciler ECP-4: FanOut + Join passes', () => {
  it('emits admit for FanOut condition evaluator when no committed result', () => {
    const plan = createRuntimePlan(fanOutPlanInput());
    const record = startRecord(plan);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fanOutNode = plan.nodes.find((n) => n.kind === 'fan-out')!;
    const admits = result.actions.filter(
      (a) => a.kind === 'admit' && a.nodeId === fanOutNode.nodeId
    );
    expect(admits.length).toBe(1);
  });

  it('admits active members up to concurrency cap', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
      { id: 'c', required: false, condition: 'always' },
      { id: 'd', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 4, members }));
    let record = startRecord(plan);
    const fanOutNode = plan.nodes.find((n) => n.kind === 'fan-out')!;
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    const memberAdmits = admits.filter((a) =>
      plan.nodes.some(
        (n) => n.kind === 'atomic' && n.nodeId === a.nodeId && n.fanOut !== undefined
      )
    );
    expect(memberAdmits.length).toBe(2);
  });

  it('does not re-admit completed members (idempotency)', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 2, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/a', { ok: true });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    const admittedPaths = admits.map((a) => {
      const node = plan.nodes.find((n) => n.nodeId === a.nodeId);
      return node?.hierarchicalPath;
    });
    expect(admittedPaths).toContain('root:experts/b');
    expect(admittedPaths).not.toContain('root:experts/a');
  });

  it('required member fails → Join emits escalate', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 2, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/a', { error: 'failed' }, 'failed');

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const escalates = result.actions.filter((a) => a.kind === 'escalate');
    expect(escalates.length).toBeGreaterThanOrEqual(1);
  });

  it('optional member fails → Join suppresses and proceeds', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 2, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/a', { ok: true });
    record = commitNode(plan, record, 'root:experts/b', { error: 'failed' }, 'failed');

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const escalates = result.actions.filter((a) => a.kind === 'escalate');
    expect(escalates.length).toBe(0);
    const finish = result.actions.find((a) => a.kind === 'finish');
    expect(finish).toBeDefined();
  });

  it('budget=3 with 5 active members → only 3 admitted', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: true, condition: 'always' },
      { id: 'c', required: true, condition: 'always' },
      { id: 'd', required: false, condition: 'always' },
      { id: 'e', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 5, budget: 3, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    const memberAdmits = admits.filter((a) =>
      plan.nodes.some(
        (n) => n.kind === 'atomic' && n.nodeId === a.nodeId && n.fanOut !== undefined
      )
    );
    expect(memberAdmits.length).toBe(3);
  });
});

describe('reconciler ECP-4: Choice pass', () => {
  function choicePlanInput(): RuntimePlanInput {
    return ecp4PlanInput([
      {
        kind: 'choice',
        hierarchicalPath: 'root:my-choice',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'none' },
        choice: {
          outcomes: ['simple', 'complex'],
          branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:simple-path',
        requires: ['root:my-choice'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:complex-path',
        requires: ['root:my-choice'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ]);
  }

  it('emits admit for choice condition evaluator when no committed result', () => {
    const plan = createRuntimePlan(choicePlanInput());
    const record = startRecord(plan);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const choiceNode = plan.nodes.find((n) => n.kind === 'choice')!;
    const admits = result.actions.filter(
      (a) => a.kind === 'admit' && a.nodeId === choiceNode.nodeId
    );
    expect(admits.length).toBe(1);
  });

  it('choice selects "simple" → only simple branch becomes ready, complex never ready', () => {
    const plan = createRuntimePlan(choicePlanInput());
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:my-choice', {
      outcome: 'simple',
      rationale: 'trivial change',
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admits = result.actions.filter((a) => a.kind === 'admit');
    const admittedPaths = admits.map((a) => {
      const node = plan.nodes.find((n) => n.nodeId === a.nodeId);
      return node?.hierarchicalPath;
    });
    expect(admittedPaths).toContain('root:simple-path');
    expect(admittedPaths).not.toContain('root:complex-path');
  });
});

describe('reconciler ECP-4: failure-first tests', () => {
  it('FanOut condition suppresses required member → escalate', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 2, members }));
    let record = startRecord(plan);
    // Condition result suppresses the required member 'a'
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/b'],  // 'a' is NOT active
      inactiveMembers: ['root:experts/a'],
      rationale: {},
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const escalates = result.actions.filter((a) => a.kind === 'escalate');
    expect(escalates.some((e) => e.kind === 'escalate' && e.code === 'fan_out_required_member_suppressed')).toBe(true);
  });

  it('restart ready-set determinism: same plan+Record → same candidates', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
      { id: 'c', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 3, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });

    const result1 = reconcile(plan, record);
    const result2 = reconcile(plan, record);
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    // Both reconciles should produce identical action lists
    expect(JSON.stringify(result1.actions)).toBe(JSON.stringify(result2.actions));
  });

  it('restart after member completion: completed members not re-admitted', () => {
    const members = [
      { id: 'a', required: true, condition: 'always' },
      { id: 'b', required: false, condition: 'always' },
    ];
    const plan = createRuntimePlan(fanOutPlanInput({ cap: 2, budget: 2, members }));
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: members.map((m) => `root:experts/${m.id}`),
      inactiveMembers: [],
      rationale: {},
    });
    // Both members committed
    record = commitNode(plan, record, 'root:experts/a', { ok: true });
    record = commitNode(plan, record, 'root:experts/b', { ok: true });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should emit finish (join satisfied, all members done)
    const finish = result.actions.find((a) => a.kind === 'finish');
    expect(finish).toBeDefined();
    // No admits for completed members
    const admits = result.actions.filter((a) => a.kind === 'admit');
    expect(admits.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ECP-4 Choice branch gating (N1). The spec requires that un-selected branches
// never become eligible, that the Run can finish without executing them, and
// that a branch enters the succeeded set only by committing its own Action.
// The reviewer's probes in reviewer-choice-semantics.test.ts cover the three
// headline violations; these cover the transitive and malformed-result edges.
// ---------------------------------------------------------------------------

describe('reconciler ECP-4: choice branch exclusion (N1)', () => {
  /** simple/complex branches, each with one downstream node of its own. */
  function branchedChoicePlanInput(): RuntimePlanInput {
    return ecp4PlanInput([
      {
        kind: 'choice',
        hierarchicalPath: 'root:my-choice',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'none' },
        choice: {
          outcomes: ['simple', 'complex'],
          branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
        },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:simple-path',
        requires: ['root:my-choice'],
        admissionKind: 'agent',
        workspace: { access: 'none' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:complex-path',
        requires: ['root:my-choice'],
        admissionKind: 'agent',
        workspace: { access: 'none' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root:after-complex',
        requires: ['root:complex-path'],
        admissionKind: 'agent',
        workspace: { access: 'none' },
      },
    ]);
  }

  function admittedPaths(plan: RuntimePlan, actions: readonly { kind: string; nodeId?: unknown }[]) {
    return actions
      .filter((a) => a.kind === 'admit')
      .map((a) => plan.nodes.find((n) => n.nodeId === a.nodeId)?.hierarchicalPath);
  }

  it('excludes the WHOLE rejected branch subtree, not just its entry node', () => {
    const plan = createRuntimePlan(branchedChoicePlanInput());
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:my-choice', { outcome: 'simple' });
    record = commitNode(plan, record, 'root:simple-path');

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = admittedPaths(plan, result.actions);
    expect(paths).not.toContain('root:complex-path');
    // `after-complex` is downstream of the rejected entry — excluding only the
    // entry node would leave it permanently blocking the implicit finish.
    expect(paths).not.toContain('root:after-complex');
    expect(result.actions.some((a) => a.kind === 'finish')).toBe(true);
  });

  it('rejects a plan whose rejoin node depends on BOTH branches (R2-M1)', () => {
    // `requires` is AND semantics and only one branch is ever selected, so a
    // rejoin node downstream of both can never have all its requires satisfied.
    // Leaving it in the plan produced the worst failure mode available: not
    // excluded, so never admitted; still counted by the implicit-finish check,
    // so the Run stalled at `waiting` forever with no escalate and no
    // diagnostic. Rejected at build time instead — it is a static property of
    // the plan, so `pipeline start` fails with the node named.
    expect(() =>
      createRuntimePlan(
        ecp4PlanInput([
          {
            kind: 'choice',
            hierarchicalPath: 'root:my-choice',
            requires: [],
            admissionKind: 'agent',
            workspace: { access: 'none' },
            choice: {
              outcomes: ['simple', 'complex'],
              branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
            },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:simple-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:complex-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:rejoin',
            requires: ['root:simple-path', 'root:complex-path'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
        ])
      )
    ).toThrow(/"root:rejoin" depends on 2 branches of choice "root:my-choice"/);
  });

  it('rejects a TRANSITIVE rejoin two hops below both branches', () => {
    // The convergence need not be a direct dependent of the branch entries.
    expect(() =>
      createRuntimePlan(
        ecp4PlanInput([
          {
            kind: 'choice',
            hierarchicalPath: 'root:my-choice',
            requires: [],
            admissionKind: 'agent',
            workspace: { access: 'none' },
            choice: {
              outcomes: ['simple', 'complex'],
              branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
            },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:simple-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:after-simple',
            requires: ['root:simple-path'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:complex-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:rejoin',
            requires: ['root:after-simple', 'root:complex-path'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
        ])
      )
    ).toThrow(/"root:rejoin" depends on 2 branches/);
  });

  it('accepts branches that never rejoin', () => {
    // The rejection must not fire on the ordinary shape: each branch has its
    // own downstream and they never converge.
    expect(() =>
      createRuntimePlan(
        ecp4PlanInput([
          {
            kind: 'choice',
            hierarchicalPath: 'root:my-choice',
            requires: [],
            admissionKind: 'agent',
            workspace: { access: 'none' },
            choice: {
              outcomes: ['simple', 'complex'],
              branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
            },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:simple-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:after-simple',
            requires: ['root:simple-path'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root:complex-path',
            requires: ['root:my-choice'],
            admissionKind: 'agent',
            workspace: { access: 'none' },
          },
        ])
      )
    ).not.toThrow();
  });

  it('treats an undeclared outcome as no selection and re-admits the evaluator', () => {
    const plan = createRuntimePlan(branchedChoicePlanInput());
    let record = startRecord(plan);
    // 'medium' is not in outcomes — the facade rejects this, but the kernel
    // must not depend on that: an unrecognised result previously marked the
    // choice succeeded and unblocked EVERY branch at once.
    record = commitNode(plan, record, 'root:my-choice', { outcome: 'medium' });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = admittedPaths(plan, result.actions);
    expect(paths).not.toContain('root:simple-path');
    expect(paths).not.toContain('root:complex-path');
    expect(paths).toContain('root:my-choice');
  });
});

// ---------------------------------------------------------------------------
// ECP-4 evaluator retry cap (R2-m1). An unresolved evaluator is re-admitted so
// a transient failure can recover, but only a bounded number of times — an
// uncapped loop spends paid agent dispatches until the sealed attempt budget
// dies and reports a generic `execution_budget_exhausted` naming nothing.
// ---------------------------------------------------------------------------

describe('reconciler ECP-4: evaluator retry cap (R2-m1)', () => {
  function soloChoicePlan(): RuntimePlan {
    return createRuntimePlan(
      ecp4PlanInput([
        {
          kind: 'choice',
          hierarchicalPath: 'root:my-choice',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'none' },
          choice: {
            outcomes: ['simple', 'complex'],
            branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:simple-path',
          requires: ['root:my-choice'],
          admissionKind: 'agent',
          workspace: { access: 'none' },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:complex-path',
          requires: ['root:my-choice'],
          admissionKind: 'agent',
          workspace: { access: 'none' },
        },
      ])
    );
  }

  function soloFanOutPlan(): RuntimePlan {
    return createRuntimePlan(
      fanOutPlanInput({
        cap: 2,
        budget: 2,
        members: [
          { id: 'a', required: true, condition: 'always' },
          { id: 'b', required: false, condition: 'ui' },
        ],
      })
    );
  }

  /** Commit N successive FAILED results for one evaluator node. */
  function failEvaluator(
    plan: RuntimePlan,
    record: CanonicalRunRecord,
    path: string,
    times: number
  ): CanonicalRunRecord {
    let next = record;
    for (let occurrence = 0; occurrence < times; occurrence += 1) {
      const action = agentAction(plan, path, occurrence);
      next = apply(plan, next, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });
      next = apply(plan, next, {
        kind: 'observe-effect',
        actionId: action.actionId,
        effectId: action.effects[0]!.effectId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, action.actionId),
      });
      next = apply(plan, next, {
        kind: 'commit-action-result',
        actionId: action.actionId,
        status: 'failed',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { error: 'evaluator crashed' },
        evidence: evidenceFor(plan, action.actionId),
      });
    }
    return next;
  }

  it('re-admits a choice evaluator that failed once', () => {
    const plan = soloChoicePlan();
    const record = failEvaluator(plan, startRecord(plan), 'root:my-choice', 1);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const choiceNode = plan.nodes.find((n) => n.kind === 'choice')!;
    expect(
      result.actions.some((a) => a.kind === 'admit' && a.nodeId === choiceNode.nodeId)
    ).toBe(true);
    expect(result.actions.some((a) => a.kind === 'escalate')).toBe(false);
  });

  it('escalates with a named code once the choice evaluator hits the cap', () => {
    const plan = soloChoicePlan();
    const record = failEvaluator(plan, startRecord(plan), 'root:my-choice', 3);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const choiceNode = plan.nodes.find((n) => n.kind === 'choice')!;
    expect(
      result.actions.some((a) => a.kind === 'admit' && a.nodeId === choiceNode.nodeId)
    ).toBe(false);
    const escalate = result.actions.find((a) => a.kind === 'escalate');
    expect(escalate).toMatchObject({ code: 'choice_evaluator_unresolved' });
    expect((escalate as { reason?: string }).reason).toContain('root:my-choice');
  });

  it('escalates with a named code once the fan-out condition hits the cap', () => {
    const plan = soloFanOutPlan();
    const record = failEvaluator(plan, startRecord(plan), 'root:experts', 3);
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fanOutNode = plan.nodes.find((n) => n.kind === 'fan-out')!;
    expect(
      result.actions.some((a) => a.kind === 'admit' && a.nodeId === fanOutNode.nodeId)
    ).toBe(false);
    const escalate = result.actions.find(
      (a) => a.kind === 'escalate' && a.code === 'fan_out_condition_unresolved'
    );
    expect(escalate).toBeDefined();
    expect((escalate as { reason?: string }).reason).toContain('root:experts');
  });
});
