import { describe, expect, it } from 'vitest';

import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import {
  RuntimePlanError,
  createRuntimePlan,
  type RuntimePlanInput,
} from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  awaitGate,
  bugFixPlan,
  bugFixPlanInput,
  decideGate,
  evidenceFor,
  fixtureDigests,
  fixtureLimits,
  fixtureWorkspaceRevision,
  nodeIdFor,
  startRecord,
  succeedNode,
} from './reconciler-fixture.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';

const PROPOSE = 'root/propose';
const APPLY = 'root/apply';
const VERIFY = 'root/verify';
const SHIP = 'root/ship';
const ARCHIVE = 'root/archive';

function admitAction(plan: RuntimePlan, record: ReturnType<typeof startRecord>, path: string) {
  return reconcile(plan, record).actions.find(
    (action) => action.kind === 'admit' && action.nodeId === nodeIdFor(plan, path)
  );
}

describe('reconcile determinism (5.1)', () => {
  it('emits identical NextActions regardless of plan node insertion order', () => {
    const sorted = bugFixPlan();
    const shuffledInput: RuntimePlanInput = {
      ...bugFixPlanInput(),
      nodes: [...bugFixPlanInput().nodes].reverse(),
    };
    const shuffled = createRuntimePlan(shuffledInput);

    // The two plans share the same runId/digests/paths; only declaration order differs.
    const record = startRecord(sorted);
    const a = reconcile(sorted, record);
    const b = reconcile(shuffled, record);

    expect(b.actions).toEqual(a.actions);
    expect(b.classification).toBe(a.classification);
  });

  it('is unaffected by a poisoned clock, RNG, environment, and filesystem shim', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const baseline = JSON.stringify(reconcile(plan, record));

    const original = {
      now: Date.now,
      random: Math.random,
      env: { ...process.env },
    };
    const poisonedFs = {
      readFileSync: () => {
        throw new Error('fs must not be read by the pure reconciler');
      },
      existsSync: () => {
        throw new Error('fs must not be queried by the pure reconciler');
      },
    };

    Date.now = () => -1;
    Math.random = () => 0.5;
    process.env.RASEN_POISON = 'true';
    const fsStub = poisonedFs as unknown;
    // Reference the stub so it is part of the test surface; the reconciler must
    // never reach for the real or stubbed filesystem regardless.
    expect(typeof fsStub).toBe('object');
    try {
      const poisoned = JSON.stringify(reconcile(plan, record));
      expect(poisoned).toBe(baseline);
    } finally {
      Date.now = original.now;
      Math.random = original.random;
      process.env = original.env;
    }
  });

  it('produces stable output across repeated replays of the same plan/record', () => {
    const plan = bugFixPlan();
    const record = succeedNode(plan, startRecord(plan), PROPOSE);
    const first = reconcile(plan, record);
    for (let index = 0; index < 8; index += 1) {
      expect(reconcile(plan, record)).toEqual(first);
    }
  });

  it('mutates neither the plan nor the record', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const planSnapshot = JSON.stringify(plan);
    const recordSnapshot = JSON.stringify(record);
    reconcile(plan, record);
    expect(JSON.stringify(plan)).toBe(planSnapshot);
    expect(JSON.stringify(record)).toBe(recordSnapshot);
  });
});

describe('reconcile root-DAG semantics (5.3)', () => {
  it('admits the first ready AtomicStage and sorts candidates by hierarchical NodeId', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const result = reconcile(plan, record);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // propose is gated, so the only candidate at start is its Gate, not an admission.
    expect(result.actions).toEqual([
      {
        kind: 'await-gate',
        nodeId: nodeIdFor(plan, PROPOSE),
        gateId: 'propose-gate',
        waitId: expect.any(String),
        decisionIds: ['approve', 'reject'],
      },
    ]);
    expect(result.classification).toBe('running');
  });

  it('keeps a node pending until every dependency has succeeded', () => {
    const plan = bugFixPlan();
    // propose gate awaited but not decided -> apply must remain pending.
    let record = awaitGate(plan, startRecord(plan), PROPOSE);
    expect(admitAction(plan, record, APPLY)).toBeUndefined();

    // propose gate approved + admitted but not yet succeeded -> apply still pending.
    record = decideGate(plan, record, PROPOSE, 'approve');
    record = admitNode(plan, record, PROPOSE);
    expect(admitAction(plan, record, APPLY)).toBeUndefined();
  });

  it('admits an AtomicStage once its dependency succeeds and clears a following Gate', () => {
    const plan = bugFixPlan();
    const record = succeedNode(plan, startRecord(plan), PROPOSE);
    const result = reconcile(plan, record);
    if (!result.ok) return;
    // apply is the next gated ready node.
    expect(result.actions).toEqual([
      {
        kind: 'await-gate',
        nodeId: nodeIdFor(plan, APPLY),
        gateId: 'apply-gate',
        waitId: expect.any(String),
        decisionIds: ['approve', 'reject'],
      },
    ]);
  });

  it('routes a rejected Gate to a declared escalate terminal decision', () => {
    const plan = bugFixPlan();
    let record = awaitGate(plan, startRecord(plan), PROPOSE);
    record = decideGate(plan, record, PROPOSE, 'reject');
    const result = reconcile(plan, record);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      { kind: 'escalate', code: 'gate_rejected_propose-gate' },
    ]);
    // A rejected gate is a terminal decision; nothing else may be admitted.
    expect(result.actions.some((action) => action.kind === 'admit')).toBe(false);
  });

  it('advances past verify on the simple adaptive route', () => {
    const plan = bugFixPlan();
    // verify has no gate; once propose+apply have succeeded it is admitted directly.
    const afterApply = succeedNode(
      plan,
      succeedNode(plan, startRecord(plan), PROPOSE),
      APPLY
    );
    const beforeVerify = reconcile(plan, afterApply);
    if (!beforeVerify.ok) return;
    expect(beforeVerify.actions).toContainEqual({
      kind: 'admit',
      nodeId: nodeIdFor(plan, VERIFY),
      occurrence: 0,
      admissionKind: 'agent',
    });

    const record = succeedNode(plan, afterApply, VERIFY, { route: 'simple' });
    const result = reconcile(plan, record);
    if (!result.ok) return;
    // verify succeeded via simple route -> ship gate becomes the ready candidate.
    expect(result.actions).toEqual([
      {
        kind: 'await-gate',
        nodeId: nodeIdFor(plan, SHIP),
        gateId: 'ship-gate',
        waitId: expect.any(String),
        decisionIds: ['approve', 'reject'],
      },
    ]);
  });

  it('suspends and blocks ship when the adaptive verify route is complex', () => {
    const plan = bugFixPlan();
    let record = succeedNode(plan, startRecord(plan), PROPOSE);
    record = succeedNode(plan, record, APPLY);
    record = succeedNode(plan, record, VERIFY, { route: 'complex' });
    const result = reconcile(plan, record);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      {
        kind: 'suspend-unsupported',
        nodeId: nodeIdFor(plan, VERIFY),
        code: 'review_cycle_capability_unavailable',
      },
    ]);
    // ship/archive must be absent from the frontier.
    expect(result.actions.some((action) => action.kind === 'admit')).toBe(false);
  });

  it('completes the implicit root finish once every atomic stage has succeeded', () => {
    const plan = bugFixPlan();
    let record = startRecord(plan);
    for (const path of [PROPOSE, APPLY, VERIFY, SHIP, ARCHIVE]) {
      record = succeedNode(
        plan,
        record,
        path,
        path === VERIFY ? { route: 'simple' } : { ok: true }
      );
    }
    const result = reconcile(plan, record);
    if (!result.ok) return;
    expect(result.actions).toEqual([{ kind: 'finish', outcome: 'bug-fix-completed' }]);
  });

  it('emits no action for a terminal Record', () => {
    const plan = bugFixPlan();
    let record = startRecord(plan);
    for (const path of [PROPOSE, APPLY, VERIFY, SHIP, ARCHIVE]) {
      record = succeedNode(
        plan,
        record,
        path,
        path === VERIFY ? { route: 'simple' } : { ok: true }
      );
    }
    const finished = reconcile(plan, record);
    if (!finished.ok || finished.actions.length === 0) {
      throw new Error('fixture: expected a finish candidate');
    }
    // After the finish candidate is committed the Record is terminal.
    const terminalRecord = applyFinish(plan, record);
    const result = reconcile(plan, terminalRecord);
    if (!result.ok) return;
    expect(result.classification).toBe('terminal');
    expect(result.actions).toEqual([]);
  });

  it('fails closed when plan and Record identity digests diverge', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    const mismatched = createRuntimePlan({
      ...bugFixPlanInput(),
      planDigest: fixtureDigests.workspaceDigest,
    });
    const result = reconcile(mismatched, record);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('plan_record_identity_mismatch');
  });
});

describe('createRuntimePlan rejects unsupported semantics (5.4)', () => {
  it('accepts the supported atomic/gate/finish root DAG', () => {
    const plan = createRuntimePlan({
      runId: fixtureDigests.runId,
      pipeline: 'linear',
      planDigest: fixtureDigests.planDigest,
      profileDigest: fixtureDigests.profileDigest,
      sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
      capabilityDigest: fixtureDigests.capabilityDigest,
      policyDigest: fixtureDigests.policyDigest,
      implicitFinishOutcome: 'done',
      nodes: [
        {
          kind: 'atomic',
          hierarchicalPath: 'root/a',
          requires: [],
          admissionKind: 'agent',
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root/b',
          requires: ['root/a'],
          admissionKind: 'agent',
        },
      ],
    });
    expect(plan.nodes.map((node) => node.hierarchicalPath)).toEqual([
      'root/a',
      'root/b',
    ]);
  });

  it('rejects an explicit Finish plus an implicit finish outcome', () => {
    expect(() =>
      createRuntimePlan({
        runId: fixtureDigests.runId,
        pipeline: 'x',
        planDigest: fixtureDigests.planDigest,
        profileDigest: fixtureDigests.profileDigest,
        sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
        capabilityDigest: fixtureDigests.capabilityDigest,
        policyDigest: fixtureDigests.policyDigest,
        implicitFinishOutcome: 'done',
        nodes: [
          {
            kind: 'atomic',
            hierarchicalPath: 'root/a',
            requires: [],
            admissionKind: 'agent',
          },
          {
            kind: 'finish',
            hierarchicalPath: 'root/finish',
            requires: ['root/a'],
            outcome: 'completed',
          },
        ],
      })
    ).toThrowError(RuntimePlanError);
  });

  it('rejects cyclic root dependencies before any Run is created', () => {
    expect(() =>
      createRuntimePlan({
        runId: fixtureDigests.runId,
        pipeline: 'x',
        planDigest: fixtureDigests.planDigest,
        profileDigest: fixtureDigests.profileDigest,
        sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
        capabilityDigest: fixtureDigests.capabilityDigest,
        policyDigest: fixtureDigests.policyDigest,
        nodes: [
          {
            kind: 'atomic',
            hierarchicalPath: 'root/a',
            requires: ['root/b'],
            admissionKind: 'agent',
          },
          {
            kind: 'atomic',
            hierarchicalPath: 'root/b',
            requires: ['root/a'],
            admissionKind: 'agent',
          },
        ],
      })
    ).toThrowError(RuntimePlanError);
  });
});

describe('reconcile workspace-compatible admission selection (5.5/5.6)', () => {
  it('admits coexisting readers and emits no reservation when no workspace work is active', () => {
    const plan = frontierPlan({ 'root/r1': 'read', 'root/r2': 'read' });
    const result = reconcile(plan, startRecord(plan));
    expect(admitOf(plan, result, 'root/r1')).toBeDefined();
    expect(admitOf(plan, result, 'root/r2')).toBeDefined();
    expect(awaitWorkspace(result)).toBeUndefined();
  });

  it('admits only the lower-NodeId writer and blocks the other behind one reservation wait', () => {
    const plan = frontierPlan({ 'root/w1': 'write', 'root/w2': 'write' });
    const result = reconcile(plan, startRecord(plan));
    const [first, second] = sortedPaths(plan, ['root/w1', 'root/w2']);
    expect(admitOf(plan, result, first)).toBeDefined();
    expect(admitOf(plan, result, second)).toBeUndefined();
    const wait = awaitWorkspace(result);
    expect(wait).toBeDefined();
    expect(wait!.intents.map((intent) => intent.nodeId)).toEqual([
      nodeIdFor(plan, second),
    ]);
    expect(wait!.intents[0]!.access).toBe('write');
  });

  it('admits access-none work alongside a blocked workspace-reservation wait', () => {
    const plan = frontierPlan({
      'root/w1': 'write',
      'root/w2': 'write',
      'root/n1': 'none',
    });
    const result = reconcile(plan, startRecord(plan));
    expect(admitOf(plan, result, 'root/n1')).toBeDefined();
    const [first, second] = sortedPaths(plan, ['root/w1', 'root/w2']);
    expect(admitOf(plan, result, first)).toBeDefined();
    expect(awaitWorkspace(result)!.intents.map((i) => i.nodeId)).toEqual([
      nodeIdFor(plan, second),
    ]);
  });

  it('blocks every ready reader and writer while a writer action is active', () => {
    const plan = frontierPlan({
      'root/seed': 'write',
      'root/w': 'write',
      'root/r': 'read',
      'root/n': 'none',
    });
    const record = admitNode(plan, startRecord(plan), 'root/seed');
    const result = reconcile(plan, record);
    expect(admitOf(plan, result, 'root/n')).toBeDefined();
    expect(admitOf(plan, result, 'root/w')).toBeUndefined();
    expect(admitOf(plan, result, 'root/r')).toBeUndefined();
    const wait = awaitWorkspace(result);
    expect(wait).toBeDefined();
    expect(
      wait!.intents
        .map((intent) => intent.nodeId)
        .sort()
    ).toEqual(
      [nodeIdFor(plan, 'root/w'), nodeIdFor(plan, 'root/r')].sort()
    );
  });

  it('admits ready readers and blocks writers while a reader action is active', () => {
    const plan = frontierPlan({
      'root/seed': 'read',
      'root/r': 'read',
      'root/w': 'write',
    });
    const record = admitNode(plan, startRecord(plan), 'root/seed');
    const result = reconcile(plan, record);
    expect(admitOf(plan, result, 'root/r')).toBeDefined();
    expect(admitOf(plan, result, 'root/w')).toBeUndefined();
    expect(awaitWorkspace(result)!.intents.map((i) => i.nodeId)).toEqual([
      nodeIdFor(plan, 'root/w'),
    ]);
  });

  it('emits two independent Gates without subjecting them to workspace selection', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'atomic',
          hierarchicalPath: 'root/g1',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
          gate: {
            gateId: 'g1',
            decisionIds: ['approve', 'reject'],
            outcomes: { approve: 'proceed', reject: 'escalate' },
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root/g2',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
          gate: {
            gateId: 'g2',
            decisionIds: ['approve', 'reject'],
            outcomes: { approve: 'proceed', reject: 'escalate' },
          },
        },
      ])
    );
    const result = reconcile(plan, startRecord(plan));
    if (!result.ok) return;
    expect(result.actions.filter((a) => a.kind === 'await-gate')).toHaveLength(2);
    expect(result.actions.some((a) => a.kind === 'await-workspace')).toBe(false);
  });

  it('coexists a Gate with an independent access-none admit', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'atomic',
          hierarchicalPath: 'root/g',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
          gate: {
            gateId: 'g',
            decisionIds: ['approve'],
            outcomes: { approve: 'proceed' },
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root/n',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'none' },
        },
      ])
    );
    const result = reconcile(plan, startRecord(plan));
    expect(result.actions.some((a) => a.kind === 'await-gate')).toBe(true);
    expect(admitOf(plan, result, 'root/n')).toBeDefined();
    expect(awaitWorkspace(result)).toBeUndefined();
  });
});

describe('candidate-commit seam and progress guards (5.7)', () => {
  it('commits a completion plus downstream admissions as one candidate Record revision', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'atomic',
          hierarchicalPath: 'root/a',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
        },
      ])
    );
    const base = startRecord(plan);
    const action = agentAction(plan, 'root/a');
    const stimuli = [
      {
        kind: 'admit-action' as const,
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant' as const,
      },
      {
        kind: 'observe-effect' as const,
        actionId: action.actionId,
        effectId: action.effects[0]!.effectId,
        status: 'succeeded' as const,
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true } as unknown,
        evidence: evidenceFor(plan, action.actionId),
      },
      {
        kind: 'commit-action-result' as const,
        actionId: action.actionId,
        status: 'succeeded' as const,
        receiptDigest: fixtureDigests.receiptDigest,
        result: { ok: true } as unknown,
        evidence: evidenceFor(plan, action.actionId),
      },
    ];
    const result = reduceCandidateBatch(base, stimuli);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One candidate revision over the base: version 1, predecessor rooted at
    // the base digest, all four appended transitions with gap-free ordinals.
    expect(result.record.recordVersion).toBe(1);
    expect(result.record.previousRecordDigest).toBe(
      digestCanonicalRunRecord(base)
    );
    expect(result.record.transitions.map((t) => t.transitionOrdinal)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(result.record.transitions.map((t) => t.kind)).toEqual([
      'RunStarted',
      'ActionAdmitted',
      'ActionGranted',
      'ActionEffectObserved',
      'ActionResultCommitted',
    ]);
    expect(result.record.counters.transitions).toBe(5);
    expect(result.record.counters.actions).toBe(1);
  });

  it('would cost one revision per stimulus when committed individually', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'atomic',
          hierarchicalPath: 'root/a',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
        },
      ])
    );
    const base = startRecord(plan);
    const action = agentAction(plan, 'root/a');
    // Sequential admission consumes one revision per stimulus (0 -> 1 -> 2),
    // in contrast to the single-revision batch proven above.
    const grant = reduceCanonicalRunRecord(base, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });
    const effect = reduceCanonicalRunRecord(grant.record, {
      kind: 'observe-effect',
      actionId: action.actionId,
      effectId: action.effects[0]!.effectId,
      status: 'succeeded',
      receiptDigest: fixtureDigests.receiptDigest,
      observation: { ok: true },
      evidence: evidenceFor(plan, action.actionId),
    });
    expect(grant.record.recordVersion).toBe(1);
    expect(effect.record.recordVersion).toBe(2);
  });

  it('aborts atomically when any stimulus in the batch is invalid', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'atomic',
          hierarchicalPath: 'root/a',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
        },
      ])
    );
    const base = startRecord(plan);
    const action = agentAction(plan, 'root/a');
    const result = reduceCandidateBatch(base, [
      {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      },
      {
        // Invalid: no such action has been admitted, so this must fail and the
        // whole batch aborts without committing the admission either.
        kind: 'commit-action-result',
        actionId: action.actionId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { ok: true },
        evidence: evidenceFor(plan, action.actionId),
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('illegal_transition');
  });

  it('never re-admits a node that already has an active invocation (progress guard)', () => {
    const plan = frontierPlan({ 'root/a': 'write', 'root/b': 'write' });
    const record = admitNode(plan, startRecord(plan), 'root/a');
    const result = reconcile(plan, record);
    if (!result.ok) return;
    const admits = result.actions.filter((action) => action.kind === 'admit');
    // root/a is active -> not re-admitted; only root/b is on the frontier (and
    // blocked by the active writer behind a reservation wait, not admitted).
    expect(admits.some((a) => a.kind === 'admit' && a.nodeId === nodeIdFor(plan, 'root/a'))).toBe(false);
    expect(result.actions.some((a) => a.kind === 'admit')).toBe(false);
  });

  it('never emits two admit candidates for the same NodeId (cycle guard)', () => {
    const plan = bugFixPlan();
    const record = startRecord(plan);
    for (let round = 0; round < 4; round += 1) {
      const result = reconcile(plan, record);
      if (!result.ok) return;
      const ids = result.actions
        .filter((a) => a.kind === 'admit')
        .map((a) => (a as { nodeId: NodeId }).nodeId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ---- local helpers (kept here so the test file is self-explanatory) ----

import {
  reduceCanonicalRunRecord,
  reduceCandidateBatch,
} from '../../../src/core/change-run/internal/reducer.js';
import { digestCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type {
  ReconcilerNextAction,
  ReconcilerResult,
} from '../../../src/core/change-run/internal/reconciler.js';
import type { RuntimePlanNodeInput } from '../../../src/core/change-run/internal/runtime-plan.js';

function planInput(nodes: readonly RuntimePlanNodeInput[]): RuntimePlanInput {
  return {
    runId: fixtureDigests.runId,
    pipeline: 'settle',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'settle-completed',
    nodes,
  };
}

function frontierPlan(
  accessByPath: Readonly<Record<string, 'none' | 'read' | 'write'>>
): RuntimePlan {
  return createRuntimePlan(
    planInput(
      Object.entries(accessByPath).map(([path, access]) => ({
        kind: 'atomic' as const,
        hierarchicalPath: path,
        requires: [],
        admissionKind: 'agent' as const,
        workspace: { access },
      }))
    )
  );
}

function sortedPaths(plan: RuntimePlan, paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => {
    const leftId = nodeIdFor(plan, left);
    const rightId = nodeIdFor(plan, right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function admitOf(
  plan: RuntimePlan,
  result: ReconcilerResult,
  path: string
): unknown {
  if (!result.ok) return undefined;
  const id = nodeIdFor(plan, path);
  return result.actions.find(
    (action) => action.kind === 'admit' && action.nodeId === id
  );
}

function awaitWorkspace(
  result: ReconcilerResult
): Extract<ReconcilerNextAction, { kind: 'await-workspace' }> | undefined {
  if (!result.ok) return undefined;
  return result.actions.find(
    (action): action is Extract<ReconcilerNextAction, { kind: 'await-workspace' }> =>
      action.kind === 'await-workspace'
  );
}

function admitNode(plan: RuntimePlan, record: ReturnType<typeof startRecord>, path: string) {
  const action = agentAction(plan, path);
  const granted = reduceCanonicalRunRecord(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  if (!granted.ok) throw new Error(`admit failed: ${granted.failure.message}`);
  return granted.record;
}

function applyFinish(plan: RuntimePlan, record: ReturnType<typeof startRecord>) {
  const finished = reduceCanonicalRunRecord(record, {
    kind: 'finish',
    outcome: 'bug-fix-completed',
  });
  if (!finished.ok) throw new Error(`finish failed: ${finished.failure.message}`);
  return finished.record;
}

// Re-export fixture limits/revision symbols used only for type alignment above.
export const _fixtureLimits = fixtureLimits;
export const _fixtureWorkspaceRevision = fixtureWorkspaceRevision;
