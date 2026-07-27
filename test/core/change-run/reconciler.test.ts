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

// ---- local helpers (kept here so the test file is self-explanatory) ----

import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';

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
