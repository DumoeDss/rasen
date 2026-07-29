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
  startRecord,
} from './reconciler-fixture.js';
import type { JsonValue, RunId } from '../../../src/core/change-run/index.js';

/**
 * REVIEWER PROBE (re-review round 1, ecp-full-feature): the delta spec
 * `executable-parallel-pipelines` states "Un-selected branches SHALL never
 * become eligible for admission". These probes check that guarantee beyond
 * the single-snapshot assertion in reconciler-ecp4.test.ts — specifically
 * what happens AFTER the selected branch completes and the workspace lock
 * frees up, and whether a choice plan can ever reach implicit finish.
 */

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<never>(`sha256:${char.repeat(64)}`);

const RUN_ID = branded<RunId>(`run:${'e'.repeat(64)}`);

function planInput(nodes: RuntimePlanInput['nodes']): RuntimePlanInput {
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

function choicePlanInput(): RuntimePlanInput {
  return planInput([
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

function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(
      `fixture reducer failed (${result.failure.code}): ${result.failure.message}`
    );
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

function admittedPathsOf(plan: RuntimePlan, actions: readonly { kind: string; nodeId?: unknown }[]) {
  return actions
    .filter((a) => a.kind === 'admit')
    .map((a) => plan.nodes.find((n) => n.nodeId === a.nodeId)?.hierarchicalPath);
}

describe('REVIEWER PROBE: choice un-selected branch admission', () => {
  it('does NOT admit the un-selected branch after the selected branch completes', () => {
    const plan = createRuntimePlan(choicePlanInput());
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:my-choice', {
      outcome: 'simple',
      rationale: 'trivial change',
    });
    // The selected branch runs to completion; the workspace lock is now free.
    record = commitNode(plan, record, 'root:simple-path', { ok: true });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admitted = admittedPathsOf(plan, result.actions);
    // Spec: "Un-selected branches SHALL never become eligible for admission."
    expect(admitted).not.toContain('root:complex-path');
  });

  it('reaches implicit finish after only the selected branch completes', () => {
    const plan = createRuntimePlan(choicePlanInput());
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:my-choice', {
      outcome: 'simple',
      rationale: 'trivial change',
    });
    record = commitNode(plan, record, 'root:simple-path', { ok: true });

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finish = result.actions.find((a) => a.kind === 'finish');
    // If the un-selected branch blocks the implicit finish, a choice Run can
    // never complete without ALSO executing the branch the choice rejected.
    expect(finish).toBeDefined();
  });

  it('does not admit downstream-of-selected-branch before the branch itself runs', () => {
    const plan = createRuntimePlan(
      planInput([
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
        {
          kind: 'atomic',
          hierarchicalPath: 'root:after-simple',
          // Downstream of the SELECTED branch node. access:none so the
          // workspace lock cannot mask a premature readiness verdict.
          requires: ['root:simple-path'],
          admissionKind: 'agent',
          workspace: { access: 'none' },
        },
      ])
    );
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:my-choice', {
      outcome: 'simple',
      rationale: 'trivial change',
    });
    // simple-path has NOT run yet.
    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admitted = admittedPathsOf(plan, result.actions);
    // after-simple depends on simple-path COMPLETING, which has not happened.
    expect(admitted).not.toContain('root:after-simple');
  });
});
