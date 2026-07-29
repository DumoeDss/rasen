import { describe, expect, it } from 'vitest';

import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { JsonValue, RunId } from '../../../src/core/change-run/index.js';

/**
 * REVIEWER PROBE (re-review round 3, ecp-full-feature): the Operations-plane
 * parity test (`packages/ui/test/components/ecp4-parallel-choice-parity.test.tsx`)
 * asserts the UI DOM against HAND-COPIED canonical section constants whose
 * provenance is a deleted throwaway harness. This probe re-derives the four
 * documented fixtures through the REAL projector and deep-equals the output
 * against the UI test's constants (copied verbatim below). If it passes, the
 * constants are mechanically faithful to today's projection; residual risk is
 * future drift only.
 */

const branded = <T>(value: string): T => value as T;
const RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);

function planFor(nodes: Parameters<typeof createRuntimePlan>[0]['nodes']): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline: 'ecp4-projection',
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'completed',
    nodes,
  });
}

function parallelPlan(): RuntimePlan {
  const members = [
    { id: 'review', required: true, condition: 'always' },
    { id: 'cso', required: false, condition: 'security-relevant' },
    { id: 'benchmark', required: false, condition: 'performance-sensitive' },
  ];
  return planFor([
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
        concurrencyCap: 2,
        budget: 3,
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
      requires: members.map((m) => `root:experts/${m.id}`),
      join: {
        requiredMembers: ['root:experts/review'],
        optionalMembers: ['root:experts/cso', 'root:experts/benchmark'],
        outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
      },
    },
  ]);
}

function choicePlan(): RuntimePlan {
  return planFor([
    {
      kind: 'choice',
      hierarchicalPath: 'root:pick',
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
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:complex-path',
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
  ]);
}

function apply(
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true },
  status: 'succeeded' | 'failed' = 'succeeded'
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
  next = apply(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  return apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
}

function wireSection(plan: RuntimePlan, record: CanonicalRunRecord, kind: string): unknown {
  const view = projectRunView(record, 'active', plan) as unknown as {
    sections: readonly { kind: string }[];
  };
  // JSON round-trip mirrors the wire: undefined-valued keys are dropped.
  return JSON.parse(JSON.stringify(view.sections.find((s) => s.kind === kind)));
}

// ---- Constants copied VERBATIM from ecp4-parallel-choice-parity.test.tsx ----

const CANONICAL_PARALLEL = {
  kind: 'parallel',
  version: 1,
  fanOutPath: 'root:experts',
  joinPath: 'root:experts-join',
  members: [
    { path: 'root:experts/review', status: 'succeeded', required: true, condition: 'always' },
    { path: 'root:experts/cso', status: 'ready', required: false, condition: 'security-relevant' },
    {
      path: 'root:experts/benchmark',
      status: 'suppressed',
      required: false,
      condition: 'performance-sensitive',
    },
  ],
  joinState: 'proceeding',
  concurrencyCap: 2,
  budget: { used: 1, max: 3 },
  activeCount: 1,
  succeededCount: 1,
  failedCount: 0,
  keyBlockers: [],
};

const CANONICAL_PARALLEL_FAILED = {
  kind: 'parallel',
  version: 1,
  fanOutPath: 'root:experts',
  joinPath: 'root:experts-join',
  members: [
    { path: 'root:experts/review', status: 'failed', required: true, condition: 'always' },
    {
      path: 'root:experts/cso',
      status: 'succeeded',
      required: false,
      condition: 'security-relevant',
    },
    {
      path: 'root:experts/benchmark',
      status: 'suppressed',
      required: false,
      condition: 'performance-sensitive',
    },
  ],
  joinState: 'failed',
  concurrencyCap: 2,
  budget: { used: 2, max: 3 },
  activeCount: 0,
  succeededCount: 1,
  failedCount: 1,
  keyBlockers: ["required member 'root:experts/review' failed"],
};

const CANONICAL_CHOICE = {
  kind: 'choice',
  version: 1,
  choicePath: 'root:pick',
  outcome: 'simple',
  branches: [
    { outcome: 'simple', path: 'root:simple-path', active: true },
    { outcome: 'complex', path: 'root:complex-path', active: false },
  ],
};

const CANONICAL_CHOICE_UNDECIDED = {
  kind: 'choice',
  version: 1,
  choicePath: 'root:pick',
  branches: [
    { outcome: 'simple', path: 'root:simple-path', active: false },
    { outcome: 'complex', path: 'root:complex-path', active: false },
  ],
};

describe('REVIEWER PROBE r3: UI parity constants match the real projection', () => {
  it('CANONICAL_PARALLEL is the real projection of the documented fixture', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
    });
    record = commitNode(plan, record, 'root:experts/review', { ok: true });
    expect(wireSection(plan, record, 'parallel')).toEqual(CANONICAL_PARALLEL);
  });

  it('CANONICAL_PARALLEL_FAILED is the real projection of the documented fixture', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
    });
    record = commitNode(plan, record, 'root:experts/review', { error: 'blocker' }, 'failed');
    record = commitNode(plan, record, 'root:experts/cso', { ok: true });
    expect(wireSection(plan, record, 'parallel')).toEqual(CANONICAL_PARALLEL_FAILED);
  });

  it('CANONICAL_CHOICE is the real projection of the documented fixture', () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:pick', { outcome: 'simple' });
    expect(wireSection(plan, record, 'choice')).toEqual(CANONICAL_CHOICE);
  });

  it('CANONICAL_CHOICE_UNDECIDED is the real projection of the fresh Record', () => {
    const plan = choicePlan();
    const record = startRecord(plan);
    expect(wireSection(plan, record, 'choice')).toEqual(CANONICAL_CHOICE_UNDECIDED);
  });
});

describe('REVIEWER PROBE r3: evaluator retry cap vs an in-flight attempt', () => {
  it('does not escalate while the final evaluator attempt is still ACTIVE', () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    // Two prior attempts failed (occurrences 0 and 1)…
    for (const occurrence of [0, 1]) {
      const attempt = agentAction(plan, 'root:pick', occurrence);
      record = apply(record, {
        kind: 'admit-action',
        action: attempt,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });
      record = apply(record, {
        kind: 'observe-effect',
        actionId: attempt.actionId,
        effectId: attempt.effects[0]!.effectId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, attempt.actionId),
      });
      record = apply(record, {
        kind: 'commit-action-result',
        actionId: attempt.actionId,
        status: 'failed',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { error: `boom-${occurrence}` },
        evidence: evidenceFor(plan, attempt.actionId),
      });
    }
    // …and the third (final permitted) attempt is admitted and IN FLIGHT.
    const action = agentAction(plan, 'root:pick', 2);
    record = apply(record, {
      kind: 'admit-action',
      action,
      attemptOrdinal: 0,
      deliveryMode: 'grant',
    });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const escalates = result.actions.filter(
      (a: { kind: string; code?: string }) =>
        a.kind === 'escalate' && a.code === 'choice_evaluator_unresolved'
    );
    // The third attempt may still succeed — escalating now discards live work
    // and terminates a recoverable Run.
    expect(escalates).toHaveLength(0);
  });
});

describe('REVIEWER PROBE r3: projector honours evaluator completion status', () => {
  it('does not report a FAILED choice attempt outcome as the selection', () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    // The evaluator FAILED; its partial output still names a declared outcome.
    record = commitNode(
      plan,
      record,
      'root:pick',
      { outcome: 'simple', error: 'crashed mid-analysis' },
      'failed'
    );
    const section = wireSection(plan, record, 'choice') as {
      outcome?: string;
      branches: readonly { active: boolean }[];
    };
    // Kernel rule (spec'd this round): only a SUCCEEDED completion is a
    // decision. The projection must not display a failed attempt as selected.
    expect(section.outcome).toBeUndefined();
    expect(section.branches.every((b) => b.active === false)).toBe(true);
  });

  it('does not treat a FAILED fan-out condition attempt as committed', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    // Failed condition attempt WITH partial member output.
    record = commitNode(
      plan,
      record,
      'root:experts',
      { activeMembers: ['root:experts/review'], error: 'crashed' },
      'failed'
    );
    const section = wireSection(plan, record, 'parallel') as {
      members: readonly { status: string }[];
      joinState: string;
    };
    // The kernel treats the condition as unresolved (re-admits, then
    // escalates). The projection must not claim the condition committed.
    expect(section.members.every((m) => m.status === 'waiting')).toBe(true);
    expect(section.joinState).toBe('not-reached');
  });
});
