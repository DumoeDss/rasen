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
 * REVIEWER PROBE (re-review round 2, ecp-full-feature): the facade validators
 * are now scoped to `status: 'succeeded'` (12cc6131), so FAILED evaluator
 * completions commit unvalidated. The kernel readers
 * (`committedChoiceOutcome`, fan-out `committedResultForNode` +
 * `readActiveMembers`) are status-blind. These probes check whether a FAILED
 * evaluator completion is honoured as a selection / dispatch condition.
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

describe('REVIEWER PROBE r2: FAILED evaluator completions must not drive execution', () => {
  it('a FAILED choice evaluator naming a declared outcome must NOT select a branch', () => {
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
    let record = startRecord(plan);
    // The evaluator FAILED; its partial output still names a declared outcome.
    record = commitNode(
      plan,
      record,
      'root:my-choice',
      { outcome: 'simple', error: 'crashed mid-analysis' },
      'failed'
    );

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admitted = admittedPathsOf(plan, result.actions);
    // A failed evaluation is not a selection: no branch may be admitted.
    expect(admitted).not.toContain('root:simple-path');
    expect(admitted).not.toContain('root:complex-path');
  });

  it('a FAILED fan-out condition must NOT dispatch members (all-active fallback)', () => {
    const plan = createRuntimePlan(
      planInput([
        {
          kind: 'fan-out',
          hierarchicalPath: 'root:experts',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'none' },
          fanOut: {
            members: [
              { hierarchicalPath: 'root:experts/a', required: true, condition: 'always' },
              { hierarchicalPath: 'root:experts/b', required: false, condition: 'ui' },
            ],
            concurrencyCap: 2,
            budget: 2,
            joinNodeId: 'root:experts-join',
          },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:experts/a',
          requires: ['root:experts'],
          admissionKind: 'agent',
          workspace: { access: 'read' },
          fanOutTag: { nodeId: 'root:experts', required: true },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root:experts/b',
          requires: ['root:experts'],
          admissionKind: 'agent',
          workspace: { access: 'read' },
          fanOutTag: { nodeId: 'root:experts', required: false },
        },
        {
          kind: 'join',
          hierarchicalPath: 'root:experts-join',
          requires: ['root:experts/a', 'root:experts/b'],
          join: {
            requiredMembers: ['root:experts/a'],
            optionalMembers: ['root:experts/b'],
            outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
          },
        },
      ])
    );
    let record = startRecord(plan);
    // The condition evaluator FAILED with no member decision at all.
    record = commitNode(
      plan,
      record,
      'root:experts',
      { error: 'condition evaluation crashed' },
      'failed'
    );

    const result = reconcile(plan, record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const admitted = admittedPathsOf(plan, result.actions);
    // A failed condition evaluation must not be read as "all members active".
    expect(admitted).not.toContain('root:experts/a');
    expect(admitted).not.toContain('root:experts/b');
  });
});
