/**
 * ECP-4 task 7.4: pre-commit validation of Choice and FanOut condition
 * evaluator completions, exercised through the REAL facade `complete()` path
 * (`verifyCompletion` → validators → commit).
 *
 * These tests were ticked as delivered but never written. The gap also hid a
 * bypass: both validators used "result is a non-array object" as the
 * PRECONDITION for validating at all, so a string result skipped validation
 * entirely, committed, and left the Run permanently stalled with no branch
 * selected and no diagnostic.
 */
import { describe, expect, it } from 'vitest';

import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type {
  ActionId,
  ChangeInstanceId,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  JsonValue,
  PlanningSpaceId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;

const RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);
const IDENTITY = branded<Digest>(`sha256:${'d'.repeat(64)}`);
const SESSION = branded<Digest>(`sha256:${'b'.repeat(64)}`);
const PRINCIPAL = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const PLANNING_SPACE = branded<PlanningSpaceId>(`planning-space:${'1'.repeat(64)}`);
const CHANGE_INSTANCE = branded<ChangeInstanceId>(`change-instance:${'2'.repeat(64)}`);

function planFor(nodes: Parameters<typeof createRuntimePlan>[0]['nodes']): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline: 'evaluator-validation',
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'completed',
    nodes,
  });
}

/** Choice with two branches; the evaluator is the only initially-ready node. */
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

/** FanOut with one REQUIRED and one optional member, plus its Join. */
function fanOutPlan(): RuntimePlan {
  return planFor([
    {
      kind: 'fan-out',
      hierarchicalPath: 'root:experts',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      fanOut: {
        members: [
          { hierarchicalPath: 'root:experts/review', required: true, condition: 'always' },
          { hierarchicalPath: 'root:experts/cso', required: false, condition: 'security-relevant' },
        ],
        concurrencyCap: 2,
        budget: 2,
        joinNodeId: 'root:experts-join',
      },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:experts/review',
      requires: ['root:experts'],
      admissionKind: 'agent',
      workspace: { access: 'read' },
      fanOutTag: { nodeId: 'root:experts', required: true },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:experts/cso',
      requires: ['root:experts'],
      admissionKind: 'agent',
      workspace: { access: 'read' },
      fanOutTag: { nodeId: 'root:experts', required: false },
    },
    {
      kind: 'join',
      hierarchicalPath: 'root:experts-join',
      requires: ['root:experts/review', 'root:experts/cso'],
      join: {
        requiredMembers: ['root:experts/review'],
        optionalMembers: ['root:experts/cso'],
        outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
      },
    },
  ]);
}

interface Harness {
  plan: RuntimePlan;
  facade: ReturnType<typeof createChangePipelineRuntime>;
  granted: RunAction;
}

/** Start the Run so the evaluator is granted, then observe its effect. */
async function startAt(plan: RuntimePlan, evaluatorPath: string): Promise<Harness> {
  const store = createInMemoryRunStore();
  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord: startRecord(plan),
    buildAction: (d) => {
      const node = plan.nodes.find((n) => n.nodeId === d.nodeId)!;
      return agentAction(plan, node.hierarchicalPath, d.occurrence);
    },
  });
  const receipt = await facade.start(
    {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      pipeline: 'evaluator-validation',
      launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
    },
    { deliveryMode: 'grant' }
  );
  const granted = receipt.actions[0];
  if (granted === undefined) throw new Error('fixture: start granted no action');
  const evaluatorNodeId = plan.nodes.find(
    (n) => n.hierarchicalPath === evaluatorPath
  )!.nodeId;
  if (granted.nodeId !== evaluatorNodeId) {
    throw new Error(`fixture: expected ${evaluatorPath} to be granted first`);
  }

  // Observe the workspace effect — the reducer requires it before a succeeded
  // domain result can commit. Effect observation is a kernel-internal step.
  const record = store.load(plan.runId);
  const observed = reduceCanonicalRunRecord(record, {
    kind: 'observe-effect',
    actionId: granted.actionId,
    effectId: granted.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: evidenceFor(plan, granted.actionId),
  });
  if (!observed.ok) throw new Error('fixture: effect observation failed');
  store.commit(plan.runId, observed.record);

  return { plan, facade, granted };
}

function evidenceRefFor(actionId: ActionId, kind: string, schema: string): EvidenceRef {
  return buildEvidenceRef({
    content: Buffer.from('{"result":"ok"}'),
    mediaType: 'application/json',
    observationKind: kind,
    producer: { id: 'fixture-producer', version: '1', identityDigest: IDENTITY },
    binding: {
      planningSpaceId: PLANNING_SPACE,
      changeInstanceId: CHANGE_INSTANCE,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: RUN_ID,
      actionId,
      schema,
    },
  });
}

function completionWith(
  granted: RunAction,
  result: JsonValue,
  status: 'succeeded' | 'failed' = 'succeeded'
): CompleteRunAction {
  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'domain-action-result' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: granted.runId,
    actionId: granted.actionId,
    invocationId: granted.invocationId,
    actor: buildAgentActor({
      role: 'reviewer',
      provider: 'anthropic',
      runtime: 'claude',
      principalIdentityDigest: PRINCIPAL,
      sessionIdentityDigest: SESSION,
      adapter: { id: 'adapter:fixture', version: '1', artifactDigest: SESSION },
    }),
    actorAttestation: evidenceRefFor(granted.actionId, 'actor-attestation', 'attestation/1'),
    evidence: [evidenceRefFor(granted.actionId, 'completion-evidence', 'evidence/1')],
    status,
    result,
  };
  return {
    ...base,
    receiptDigest: computeCompletionReceiptDigest(base as CompleteRunAction),
  } as CompleteRunAction;
}

const grant = { deliveryMode: 'grant' } as const;

describe('ECP-4 facade validation: Choice evaluator completions (7.4)', () => {
  it('accepts a well-formed choice result naming a declared outcome', async () => {
    const h = await startAt(choicePlan(), 'root:pick');
    const receipt = await h.facade.complete(
      completionWith(h.granted, { outcome: 'simple', rationale: 'trivial' }),
      grant
    );
    expect(receipt.view.runId).toBe(RUN_ID);
  });

  it('rejects an outcome that is not one of the choice declared outcomes', async () => {
    const h = await startAt(choicePlan(), 'root:pick');
    expect(() =>
      h.facade.complete(completionWith(h.granted, { outcome: 'medium' }), grant)
    ).toThrow(/has invalid outcome "medium"/);
  });

  it('rejects a result object with no outcome field', async () => {
    const h = await startAt(choicePlan(), 'root:pick');
    expect(() =>
      h.facade.complete(completionWith(h.granted, { rationale: 'forgot the outcome' }), grant)
    ).toThrow(/has invalid outcome/);
  });

  it('rejects a NON-OBJECT result instead of silently skipping validation', async () => {
    // Before the fix this string committed: the object-shape check was the
    // precondition for validating at all, so the Run stalled with no selection.
    const h = await startAt(choicePlan(), 'root:pick');
    expect(() =>
      h.facade.complete(completionWith(h.granted, 'simple'), grant)
    ).toThrow(/must be an object carrying an outcome; received a string/);
  });

  it('rejects an array result', async () => {
    const h = await startAt(choicePlan(), 'root:pick');
    expect(() =>
      h.facade.complete(completionWith(h.granted, ['simple']), grant)
    ).toThrow(/must be an object carrying an outcome; received an array/);
  });
});

describe('ECP-4 facade validation: FanOut condition completions (7.4)', () => {
  it('accepts a well-formed condition result that activates the required member', async () => {
    const h = await startAt(fanOutPlan(), 'root:experts');
    const receipt = await h.facade.complete(
      completionWith(h.granted, {
        activeMembers: ['root:experts/review'],
        inactiveMembers: ['root:experts/cso'],
        rationale: {},
      }),
      grant
    );
    expect(receipt.view.runId).toBe(RUN_ID);
  });

  it('rejects a result with no activeMembers array', async () => {
    const h = await startAt(fanOutPlan(), 'root:experts');
    expect(() =>
      h.facade.complete(completionWith(h.granted, { inactiveMembers: [] }), grant)
    ).toThrow(/must include activeMembers array/);
  });

  it('rejects a condition result that suppresses a REQUIRED member', async () => {
    const h = await startAt(fanOutPlan(), 'root:experts');
    expect(() =>
      h.facade.complete(
        completionWith(h.granted, {
          activeMembers: ['root:experts/cso'],
          inactiveMembers: ['root:experts/review'],
        }),
        grant
      )
    ).toThrow(/suppressed required member root:experts\/review/);
  });

  it('rejects a NON-OBJECT result instead of silently skipping validation', async () => {
    const h = await startAt(fanOutPlan(), 'root:experts');
    expect(() =>
      h.facade.complete(completionWith(h.granted, 'all'), grant)
    ).toThrow(/must be an object carrying activeMembers; received a string/);
  });
});

describe('ECP-4 facade validation: failed evaluator completions', () => {
  it('does not demand an outcome from a FAILED choice evaluator', async () => {
    // A failed evaluator legitimately carries no selection; requiring one would
    // make the failure unrecordable.
    const h = await startAt(choicePlan(), 'root:pick');
    const receipt = await h.facade.complete(
      completionWith(h.granted, { error: 'evaluator crashed' }, 'failed'),
      grant
    );
    expect(receipt.view.runId).toBe(RUN_ID);
  });

  it('does not demand activeMembers from a FAILED fan-out evaluator', async () => {
    const h = await startAt(fanOutPlan(), 'root:experts');
    const receipt = await h.facade.complete(
      completionWith(h.granted, { error: 'dispatch failed' }, 'failed'),
      grant
    );
    expect(receipt.view.runId).toBe(RUN_ID);
  });
});
