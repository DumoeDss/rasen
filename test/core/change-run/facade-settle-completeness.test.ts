/**
 * Gap A + Gap B facade tests for `ecp-settle-completeness`.
 *
 * A: `complete` settles the candidate batch that becomes admissible as a
 *    direct consequence of the completion — the next stage's Gate wait is
 *    committed in the SAME complete call, with no post-complete `resume`
 *    required.
 *
 * B: two Runs sharing one workspace-reservation registry and targeting the
 *    same WorkspaceInstanceId are serialized — the first Run admits its
 *    writer, the second Run's writer is blocked behind a durable
 *    `workspace-reservation` wait, and completing the first Run's writer
 *    releases the lease so a single resume of the second Run admits its
 *    previously-blocked writer in one revision.
 *
 * Both tests cross the real `ChangePipelineRuntime` facade (start / resume /
 * complete), not just the pure reconciler or reducer.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  createCanonicalRunRecord,
  digestCanonicalRunRecord,
  type CanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { buildAgentActor, buildHostActor } from '../../../src/core/change-run/internal/actors.js';
import {
  buildEvidenceRef,
  createBoundedEvidenceStore,
  type BoundedEvidenceStore,
} from '../../../src/core/change-run/internal/evidence.js';
import { createWorkspaceReservationRegistry } from '../../../src/core/change-run/internal/reservations.js';
import {
  fixtureDigests,
  fixtureLimits,
  fixtureWorkspaceRevision,
  agentAction,
} from './reconciler-fixture.js';
import type { RuntimePlan, RuntimePlanInput } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { CompleteRunAction } from '../../../src/core/change-run/contracts.js';
import { decodeCompletion } from '../../../src/core/change-run/contracts.js';
import type {
  ActionId,
  Digest,
  RunAction,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';
import {
  attestTestCompletion,
  stageTestCompletion,
} from '../../fixtures/trusted-completion.js';

const branded = <T>(value: string): T => value as T;

// ---------------------------------------------------------------------------
// Plan factories
// ---------------------------------------------------------------------------

const PLAN_DIGITS = '0123456789abcdef';

/** Build a `sha256:` + 64-hex digest by repeating a lowercase-hex seed. */
function seedDigest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

/**
 * A two-stage root DAG: root/a (write, no gate) → root/b (write, gated).
 * Completing root/a makes root/b's dependencies met, so root/b's gate
 * becomes pending — the reconciler emits an `await-gate` candidate that the
 * facade's complete-time settle must commit.
 */
function gatedSuccessorPlan(runIdChar: string): RuntimePlan {
  return createRuntimePlan({
    runId: branded<RunId>(`run:${runIdChar.repeat(64)}`),
    pipeline: 'gated-successor',
    planDigest: branded(seedDigest(runIdChar)),
    profileDigest: branded(seedDigest('1')),
    sourceRevisionDigest: branded(seedDigest('2')),
    capabilityDigest: branded(seedDigest('3')),
    policyDigest: branded(seedDigest('4')),
    implicitFinishOutcome: 'gated-successor-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/a',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
      {
        kind: 'atomic',
        hierarchicalPath: 'root/b',
        requires: ['root/a'],
        admissionKind: 'agent',
        workspace: { access: 'write' },
        gate: {
          gateId: 'b-gate',
          decisionIds: ['approve', 'reject'],
          outcomes: { approve: 'proceed', reject: 'escalate' },
        },
      },
    ],
  } as RuntimePlanInput);
}

/**
 * A single-writer root DAG: root/w (write, no gate, no dependencies). Used
 * for the two-Run contention test — each Run contributes one writer against
 * a shared WorkspaceInstanceId.
 */
function singleWriterPlan(runIdChar: string): RuntimePlan {
  return createRuntimePlan({
    runId: branded<RunId>(`run:${runIdChar.repeat(64)}`),
    pipeline: 'single-writer',
    planDigest: branded(seedDigest(runIdChar + '0')),
    profileDigest: branded(seedDigest(runIdChar + '1')),
    sourceRevisionDigest: branded(seedDigest(runIdChar + '2')),
    capabilityDigest: branded(seedDigest(runIdChar + '3')),
    policyDigest: branded(seedDigest(runIdChar + '4')),
    implicitFinishOutcome: 'single-writer-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/w',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ],
  } as RuntimePlanInput);
}

const SHARED_WORKSPACE = branded<WorkspaceInstanceId>(
  `workspace-instance:${'a'.repeat(64)}`
);

/**
 * Extract the root-dag section from a receipt. The projected view always
 * carries exactly one root section at index 0; for a terminal Record it is
 * replaced by a terminal-bearing section, also at index 0.
 */
function rootOf(receipt: { readonly view: { readonly sections: readonly any[] } }): any {
  return receipt.view.sections[0];
}

function startRecordFor(plan: RuntimePlan, workspaceInstanceId: WorkspaceInstanceId): CanonicalRunRecord {
  return createCanonicalRunRecord({
    runId: plan.runId,
    runOrdinal: 1,
    change: {
      planningSpaceId: branded('planning-space:' + '1'.repeat(64)),
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      instanceId: branded('change-instance:' + '2'.repeat(64)),
    },
    workspaceInstanceId,
    pipeline: plan.pipeline,
    launchRequestDigest: fixtureDigests.launchRequestDigest,
    planDigest: plan.planDigest,
    sourceRevisionDigest: plan.sourceRevisionDigest,
    capabilityDigest: plan.capabilityDigest,
    policyDigest: plan.policyDigest,
    executionProfileDigest: plan.profileDigest,
    initialWorkspaceRevision: fixtureWorkspaceRevision,
    inputs: {},
    limits: fixtureLimits,
  });
}

function buildActionForPlan(plan: RuntimePlan): (descriptor: {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly admissionKind: 'agent' | 'command' | 'host';
}) => RunAction {
  return (descriptor) => {
    const node = plan.nodes.find(
      (n) => n.kind === 'atomic' && n.nodeId === descriptor.nodeId
    );
    if (node === undefined || node.kind !== 'atomic') {
      throw new Error(`test setup: unknown nodeId ${descriptor.nodeId}`);
    }
    return agentAction(plan, node.hierarchicalPath, descriptor.occurrence);
  };
}

// ---------------------------------------------------------------------------
// Completion body helper (mirrors the e2e helper, trimmed to the minimum
// the facade's verifyCompletion + reducer paths consume)
// ---------------------------------------------------------------------------

function buildSubstitutedDomainCompletion(
  record: CanonicalRunRecord,
  action: RunAction
): CompleteRunAction {
  const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
  const principalDigest = branded<Digest>(`sha256:${'a1'.repeat(32)}`);
  const sessionDigest = branded<Digest>(`sha256:${'b2'.repeat(32)}`);

  const evidenceRef = buildEvidenceRef({
    content: evidenceContent,
    mediaType: 'application/json',
    observationKind: 'completion-evidence',
    producer: {
      id: 'settle-test-producer',
      version: '1',
      identityDigest: principalDigest,
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId: 'fixture-change',
      runId: record.runId,
      actionId: action.actionId as ActionId,
      schema: 'evidence/1',
    },
  });
  const actor = buildAgentActor({
    role: 'implementer',
    provider: 'anthropic',
    runtime: 'claude',
    principalIdentityDigest: principalDigest,
    sessionIdentityDigest: sessionDigest,
    adapter: {
      id: 'adapter:settle-test',
      version: '1',
      artifactDigest: sessionDigest,
    },
  });
  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'domain-action-result' as const,
    change: {
      projectRoot: '/test',
      changeId: 'fixture-change',
    },
    runId: record.runId,
    actionId: action.actionId,
    invocationId: action.invocationId,
    actor,
    actorAttestation: evidenceRef,
    evidence: [evidenceRef],
    status: 'succeeded' as const,
    result: { ok: true },
  };
  const receiptDigest = computeCompletionReceiptDigest(base);
  return { ...base, receiptDigest };
}

function buildCompletion(
  record: CanonicalRunRecord,
  action: RunAction,
  evidenceStore: BoundedEvidenceStore
): CompleteRunAction {
  const resultContent = new TextEncoder().encode('{"kind":"domain-action-result"}');
  const submission = attestTestCompletion({
    change: {
      projectRoot: '/test',
      changeId: record.change.changeId,
    },
    record,
    action,
    completion: {
      kind: 'domain-action-result',
      status: 'succeeded',
      result: { ok: true },
    },
    evidenceContent: resultContent,
  });
  return stageTestCompletion(evidenceStore, submission);
}

const observationUploads = new Map<string, Uint8Array>();

function buildObservationCompletion(
  record: CanonicalRunRecord,
  action: RunAction,
  kind: 'effect-observation' | 'infrastructure-observation',
  observation: unknown = { workspaceRevision: 'after-observation' }
): CompleteRunAction {
  const content = new TextEncoder().encode(JSON.stringify({ kind, observation }));
  const submission = attestTestCompletion({
    change: {
      projectRoot: '/test',
      changeId: record.change.changeId,
    },
    record,
    action,
    completion: kind === 'effect-observation'
      ? {
          kind,
          effectId: action.effects[0]!.effectId,
          status: 'succeeded',
          observation,
        }
      : {
          kind,
          status: 'infrastructure_failed',
          error: {
            code: 'adapter_unavailable',
            retryable: true,
            adapterArtifactDigest: action.capability.artifact.contentDigest,
          },
        },
    evidenceContent: content,
  });
  for (const upload of submission.uploads) {
    observationUploads.set(
      upload.contentDigest,
      Buffer.from(upload.contentBase64, 'base64')
    );
  }
  return submission.completion;
}

/**
 * Apply the `observe-effect` stimulus directly to the store so a successful
 * `commit-action-result` is not rejected by the reducer's
 * "cannot close before required effects" rule. Effect observation is a
 * documented kernel-internal step with no facade surface (same pattern as
 * the e2e dogfood).
 */
function observeWorkspaceEffect(store: { load: (runId: RunId) => CanonicalRunRecord; commit: (runId: RunId, record: CanonicalRunRecord) => void }, plan: RuntimePlan, action: RunAction): CanonicalRunRecord {
  const record = store.load(plan.runId);
  const result = reduceCanonicalRunRecord(record, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: [],
  });
  if (!result.ok) {
    throw new Error(`observe-effect failed: ${result.failure.message}`);
  }
  store.commit(plan.runId, result.record);
  return result.record;
}

const startRequest = (plan: RuntimePlan) => ({
  change: { projectRoot: '/test', changeId: 'fixture-change' },
  pipeline: plan.pipeline,
  launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
});

const resumeRequest = (plan: RuntimePlan) => ({
  change: { projectRoot: '/test', changeId: 'fixture-change' },
  runId: plan.runId,
});

async function startSingleWriter(runIdChar: string) {
  const plan = singleWriterPlan(runIdChar);
  const store = createInMemoryRunStore();
  const evidenceStore = createBoundedEvidenceStore({
    maxRunBytes: 1024 * 1024,
    maxEntries: 64,
  });
  const runtime = createChangePipelineRuntime({
    store,
    plan,
    initialRecord: startRecordFor(plan, SHARED_WORKSPACE),
    buildAction: buildActionForPlan(plan),
    evidenceStore,
  });
  const started = await runtime.start(startRequest(plan), { deliveryMode: 'grant' });
  const action = started.actions[0]!;
  return { plan, store, evidenceStore, runtime, action };
}

function stageObservationEvidence(
  store: BoundedEvidenceStore,
  request: Extract<
    CompleteRunAction,
    { kind: 'effect-observation' | 'infrastructure-observation' }
  >
): void {
  store.stageClaimed(
    request.actorAttestation,
    observationUploads.get(request.actorAttestation.contentDigest)!
  );
  store.stageClaimed(
    request.evidence[0]!,
    observationUploads.get(request.evidence[0]!.contentDigest)!
  );
}

function resealObservation(
  request: Extract<
    CompleteRunAction,
    { kind: 'effect-observation' | 'infrastructure-observation' }
  >,
  patch: Record<string, unknown>
): CompleteRunAction {
  const unsealed = { ...request, ...patch };
  return decodeCompletion({
    ...unsealed,
    receiptDigest: computeCompletionReceiptDigest(unsealed as CompleteRunAction),
  });
}

describe('public observation completion dispatch', () => {
  it('rejects a self-consistent substituted domain authority after effects are satisfied', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('7');
    const admitted = store.load(plan.runId);
    const observation = buildObservationCompletion(
      admitted,
      action,
      'effect-observation'
    ) as Extract<CompleteRunAction, { kind: 'effect-observation' }>;
    stageObservationEvidence(evidenceStore, observation);
    await runtime.complete(observation, { deliveryMode: 'grant' });

    const before = store.load(plan.runId);
    const beforeDigest = digestCanonicalRunRecord(before);
    const substitutedDomain = buildSubstitutedDomainCompletion(before, action);

    expect(() =>
      runtime.complete(substitutedDomain, { deliveryMode: 'grant' })
    ).toThrow(/authority|actor|producer|schema|EvidenceStore|authenticated|proof/i);
    const after = store.load(plan.runId);
    expect(after.recordVersion).toBe(before.recordVersion);
    expect(digestCanonicalRunRecord(after)).toBe(beforeDigest);
  });

  it('rejects a domain completion for a legacy Action without frozen authority', async () => {
    const plan = singleWriterPlan('6');
    const store = createInMemoryRunStore();
    const evidenceStore = createBoundedEvidenceStore({
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: startRecordFor(plan, SHARED_WORKSPACE),
      evidenceStore,
      buildAction: (descriptor) => {
        const current = buildActionForPlan(plan)(descriptor);
        const { completionAuthority: _legacyOmission, ...legacy } = current;
        return legacy;
      },
    });
    const started = await runtime.start(startRequest(plan), { deliveryMode: 'grant' });
    const action = started.actions[0]!;
    observeWorkspaceEffect(store, plan, action);
    const before = store.load(plan.runId);
    const beforeDigest = digestCanonicalRunRecord(before);

    expect(() =>
      runtime.complete(buildSubstitutedDomainCompletion(before, action), { deliveryMode: 'grant' })
    ).toThrow(/no frozen completion authority|legacy or unsigned Action/i);
    const after = store.load(plan.runId);
    expect(after.recordVersion).toBe(before.recordVersion);
    expect(digestCanonicalRunRecord(after)).toBe(beforeDigest);
  });

  it('rejects a fully self-valid actor, producer, and schema substitution before mutation', async () => {
    const { plan, store, runtime, action } = await startSingleWriter('9');
    const before = store.load(plan.runId);
    const valid = buildObservationCompletion(
      before,
      action,
      'effect-observation'
    ) as Extract<CompleteRunAction, { kind: 'effect-observation' }>;
    const inventedPrincipal = branded<Digest>(seedDigest('8'));
    const inventedArtifact = branded<Digest>(seedDigest('7'));
    const actor = buildHostActor({
      adapter: {
        id: 'adapter:caller-invented',
        version: '999',
        artifactDigest: inventedArtifact,
      },
      principalIdentityDigest: inventedPrincipal,
    });
    const actorAttestation = buildEvidenceRef({
      content: new TextEncoder().encode('{"attestedBy":"caller"}'),
      mediaType: 'application/json',
      observationKind: 'actor-attestation',
      producer: {
        id: 'caller-invented-attestor',
        version: '999',
        identityDigest: inventedPrincipal,
      },
      binding: {
        ...valid.actorAttestation.binding,
        schema: 'caller-invented-attestation/999',
      },
    });
    const evidence = buildEvidenceRef({
      content: new TextEncoder().encode('{"claimed":"succeeded"}'),
      mediaType: 'application/json',
      observationKind: 'effect-observation',
      producer: {
        id: 'caller-invented-producer',
        version: '999',
        identityDigest: inventedPrincipal,
      },
      binding: {
        ...valid.evidence[0]!.binding,
        schema: 'caller-invented-evidence/999',
      },
    });
    const substituted = resealObservation(valid, {
      actor,
      actorAttestation,
      evidence: [evidence],
    });

    expect(() =>
      runtime.complete(substituted, { deliveryMode: 'grant' })
    ).toThrow(/authority|actor|producer|schema/i);
    expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
      digestCanonicalRunRecord(before)
    );
  });

  it('accepts a decoded effect observation and commits only the addressed effect', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('e');
    const before = store.load(plan.runId);

    const request = buildObservationCompletion(before, action, 'effect-observation');
    stageObservationEvidence(evidenceStore, request as Extract<CompleteRunAction, { kind: 'effect-observation' }>);
    const completed = await runtime.complete(request, { deliveryMode: 'grant' });

    const after = store.load(plan.runId);
    expect(completed.view.recordVersion).toBe(before.recordVersion + 1);
    expect(after.actions[action.actionId]?.effects[0]).toMatchObject({
      effectId: action.effects[0]!.effectId,
      state: 'succeeded',
      receiptDigest: request.receiptDigest,
      evidence: request.evidence,
    });
    expect(after.actions[action.actionId]?.result).toBeUndefined();
    expect(after.actions[action.actionId]?.state).toBe('active');
    expect(request.actorAttestation).toMatchObject({
      observationKind: 'actor-attestation',
      binding: {
        actionId: action.actionId,
        runId: action.runId,
      },
    });
    expect(request.evidence[0]?.binding.effectId).toBe(action.effects[0]!.effectId);
  });

  it('accepts a decoded infrastructure observation without fabricating a domain result', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('f');
    const before = store.load(plan.runId);

    const request = buildObservationCompletion(
      before,
      action,
      'infrastructure-observation'
    );
    stageObservationEvidence(evidenceStore, request as Extract<CompleteRunAction, { kind: 'infrastructure-observation' }>);
    const completed = await runtime.complete(request, { deliveryMode: 'grant' });

    const after = store.load(plan.runId);
    expect(completed.view.recordVersion).toBe(before.recordVersion + 1);
    expect(after.actions[action.actionId]?.infrastructure).toMatchObject({
      code: 'adapter_unavailable',
      retryable: true,
      artifactDigest: request.kind === 'infrastructure-observation'
        ? request.error.adapterArtifactDigest
        : undefined,
      receiptDigest: request.receiptDigest,
      evidence: request.evidence,
    });
    expect(after.actions[action.actionId]?.result).toBeUndefined();
    expect(after.actions[action.actionId]?.state).toBe('blocked');
    expect(after.actions[action.actionId]?.effects[0]?.state).toBe(
      'infrastructure_failed'
    );
    expect(completed.view.status).toBe('waiting');
  });

  it('reuses an identical observation and rejects a conflicting receipt without mutation', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('c');
    const request = buildObservationCompletion(
      store.load(plan.runId),
      action,
      'effect-observation'
    );
    stageObservationEvidence(evidenceStore, request as Extract<CompleteRunAction, { kind: 'effect-observation' }>);
    await runtime.complete(request, { deliveryMode: 'grant' });
    const committed = store.load(plan.runId);

    const replay = await runtime.complete(request, { deliveryMode: 'grant' });
    expect(replay.disposition).toBe('reused');
    expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
      digestCanonicalRunRecord(committed)
    );

    const conflicting = buildObservationCompletion(
      committed,
      action,
      'effect-observation',
      { workspaceRevision: 'conflicting-observation' }
    );
    stageObservationEvidence(
      evidenceStore,
      conflicting as Extract<CompleteRunAction, { kind: 'effect-observation' }>
    );
    expect(() =>
      runtime.complete(conflicting, { deliveryMode: 'grant' })
    ).toThrow(/conflicts with the committed effect-observation slot/);
    expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
      digestCanonicalRunRecord(committed)
    );
  });

  it('rejects domain success until its required effect arrives through the public seam', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('d');
    const before = store.load(plan.runId);
    const domain = buildCompletion(before, action, evidenceStore);

    expect(() =>
      runtime.complete(domain, { deliveryMode: 'grant' })
    ).toThrow(/cannot close before required effects/);
    expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
      digestCanonicalRunRecord(before)
    );

    const observation = buildObservationCompletion(before, action, 'effect-observation');
    stageObservationEvidence(evidenceStore, observation as Extract<CompleteRunAction, { kind: 'effect-observation' }>);
    await runtime.complete(
      observation,
      { deliveryMode: 'grant' }
    );
    const completed = await runtime.complete(domain, { deliveryMode: 'grant' });
    expect(completed.disposition).toBe('terminal');
    expect(store.load(plan.runId).actions[action.actionId]?.result?.status).toBe(
      'succeeded'
    );
  });

  it('rejects malformed authority and identity combinations before Record mutation', async () => {
    const { plan, store, evidenceStore, runtime, action } = await startSingleWriter('b');
    const before = store.load(plan.runId);
    const valid = buildObservationCompletion(
      before,
      action,
      'effect-observation'
    ) as Extract<CompleteRunAction, { kind: 'effect-observation' }>;
    stageObservationEvidence(evidenceStore, valid);
    const wrongEffectId = branded(`effect:${'7'.repeat(64)}`);
    const wrongActionId = branded<ActionId>(`action:${'8'.repeat(64)}`);
    const badAttestation = buildEvidenceRef({
      content: new TextEncoder().encode('{"attested":false}'),
      mediaType: 'application/json',
      observationKind: 'actor-attestation',
      producer: valid.actorAttestation.producer,
      binding: {
        ...valid.actorAttestation.binding,
        actionId: wrongActionId,
      },
    });
    const badEffectEvidence = buildEvidenceRef({
      content: new TextEncoder().encode('{"wrongEffect":true}'),
      mediaType: 'application/json',
      observationKind: 'effect-observation',
      producer: valid.evidence[0]!.producer,
      binding: {
        ...valid.evidence[0]!.binding,
        effectId: wrongEffectId,
      },
    });
    const cases: Array<readonly [CompleteRunAction, RegExp]> = [
      [
        decodeCompletion({
          ...valid,
          actionId: wrongActionId,
        }),
        /action .* is not admitted/,
      ],
      [
        decodeCompletion({
          ...valid,
          invocationId: branded(`invocation:${'6'.repeat(64)}`),
        }),
        /exact admitted Action/,
      ],
      [
        resealObservation(valid, { effectId: wrongEffectId }),
        /EvidenceRef binding|canonical completion claim|proof/i,
      ],
      [
        resealObservation(valid, {
          actor: {
            ...valid.actor,
            identityDigest: branded(seedDigest('5')),
          },
        }),
        /ActorRef identityDigest|canonical completion claim/i,
      ],
      [
        resealObservation(valid, { actorAttestation: badAttestation }),
        /EvidenceRef binding|authenticated EvidenceRef v2|proof|no staged content/i,
      ],
      [
        resealObservation(valid, { evidence: [badEffectEvidence] }),
        /EvidenceRef binding|authenticated EvidenceRef v2|proof|no staged content/i,
      ],
      [
        resealObservation(valid, { evidence: [] }),
        /at least one evidence ref|exactly one labeled evidence object/,
      ],
      [
        decodeCompletion({
          ...valid,
          receiptDigest: branded(seedDigest('4')),
        }),
        /receiptDigest/,
      ],
    ];

    for (const [request, message] of cases) {
      expect(() =>
        runtime.complete(request, { deliveryMode: 'grant' })
      ).toThrow(message);
      expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
        digestCanonicalRunRecord(before)
      );
    }

    expect(() =>
      decodeCompletion({
        ...valid,
        kind: 'infrastructure-observation',
        status: 'infrastructure_failed',
      })
    ).toThrow(/expected object|Unrecognized keys/);
    expect(digestCanonicalRunRecord(store.load(plan.runId))).toBe(
      digestCanonicalRunRecord(before)
    );
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('complete settles the candidate batch (Gap A)', () => {
  it('commits the next Gate wait in the SAME complete call — no resume-run needed', async () => {
    const plan = gatedSuccessorPlan('a');
    const store = createInMemoryRunStore();
    const evidenceStore = createBoundedEvidenceStore({
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: startRecordFor(plan, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(plan),
      evidenceStore,
    });

    // Start: root/a has no gate and no deps → settle admits root/a.
    const started = await runtime.start(startRequest(plan), {
      deliveryMode: 'grant',
    });
    expect(started.disposition).toBe('created');
    expect(started.actions).toHaveLength(1);
    const actionA = started.actions[0]!;
    expect(actionA.nodeId).toBe(
      plan.nodes.find((n) => n.kind === 'atomic' && n.hierarchicalPath === 'root/a')!
        .nodeId
    );

    // Kernel-internal: observe root/a's workspace effect before completing.
    observeWorkspaceEffect(store, plan, actionA);

    // Complete root/a. Per design §5.6 the complete settles the resulting
    // Record, so root/b's Gate wait MUST be committed in this same call —
    // no separate resume-run is required.
    const completion = buildCompletion(store.load(plan.runId), actionA, evidenceStore);
    const completed = await runtime.complete(completion, {
      deliveryMode: 'grant',
    });

    // The Gate wait for root/b is now committed in the receipt's view.
    const root = rootOf(completed);
    const gateWaits = root.waits.filter((w: { kind: string }) => w.kind === 'gate');
    expect(gateWaits.length).toBe(1);
    const expectedBNodeId = plan.nodes.find(
      (n) => n.kind === 'atomic' && n.hierarchicalPath === 'root/b'
    )!.nodeId;
    expect(gateWaits[0]!.nodeId).toBe(expectedBNodeId);

    // The Run reached its next quiescent point — disposition reflects the
    // committed Gate wait (no executable actions granted, at least one
    // active wait → 'waiting').
    expect(completed.disposition).toBe('waiting');
    expect(completed.actions).toEqual([]);

    // Controls for the new Gate wait are exposed.
    const controlKinds = root.allowedControls.map((c: { kind: string }) => c.kind);
    expect(controlKinds).toContain('decision');
  });
});

describe('await-workspace commits a durable wait (Gap B)', () => {
  it('serializes two Runs contending for one workspace via a workspace-reservation wait', async () => {
    const registry = createWorkspaceReservationRegistry();
    const planA = singleWriterPlan('a');
    const planB = singleWriterPlan('b');
    const storeA = createInMemoryRunStore();
    const storeB = createInMemoryRunStore();
    const evidenceStoreA = createBoundedEvidenceStore({
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });
    const evidenceStoreB = createBoundedEvidenceStore({
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });

    const runtimeA = createChangePipelineRuntime({
      store: storeA,
      plan: planA,
      initialRecord: startRecordFor(planA, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(planA),
      reservationRegistry: registry,
      evidenceStore: evidenceStoreA,
    });
    const runtimeB = createChangePipelineRuntime({
      store: storeB,
      plan: planB,
      initialRecord: startRecordFor(planB, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(planB),
      reservationRegistry: registry,
      evidenceStore: evidenceStoreB,
    });

    // ---- Run A starts first: admits its writer, reserves the workspace. ----
    const startedA = await runtimeA.start(startRequest(planA), {
      deliveryMode: 'grant',
    });
    expect(startedA.disposition).toBe('created');
    expect(startedA.actions).toHaveLength(1);
    const actionA = startedA.actions[0]!;
    expect(registry.isBusy(SHARED_WORKSPACE)).toBe(true);

    // ---- Run B starts second: its writer is blocked behind a durable
    // workspace-reservation wait. No conflicting write is committed. The
    // `start` disposition is 'created' (the Run IS created); the projected
    // view's status reflects the waiting state. ----
    const startedB = await runtimeB.start(startRequest(planB), {
      deliveryMode: 'grant',
    });
    expect(startedB.disposition).toBe('created');
    expect(startedB.actions).toEqual([]);
    expect(startedB.view.status).toBe('waiting');
    const startedBRoot = rootOf(startedB);
    const reservationWaits = startedBRoot.waits.filter(
      (w: { kind: string }) => w.kind === 'workspace-reservation'
    );
    expect(reservationWaits.length).toBe(1);
    const reservation = reservationWaits[0]!;
    expect(reservation.workspaceInstanceId).toBe(SHARED_WORKSPACE);
    // The wait carries only stable local candidate identity — no ActionId or
    // AttemptId (the blocked candidate has not been admitted).
    expect(reservation.intents.length).toBe(1);
    const intent = reservation.intents[0]!;
    expect(intent.access).toBe('write');
    expect('actionId' in intent).toBe(false);
    expect('attemptId' in intent).toBe(false);
    // Run B's writer was NOT admitted (no conflicting write).
    const recordB = storeB.load(planB.runId);
    expect(Object.keys(recordB.actions)).toHaveLength(0);

    // ---- Run A completes its writer: the reservation is released and the
    // post-complete settle reaches the implicit finish. ----
    observeWorkspaceEffect(storeA, planA, actionA);
    const completionA = buildCompletion(
      storeA.load(planA.runId),
      actionA,
      evidenceStoreA
    );
    const completedA = await runtimeA.complete(completionA, {
      deliveryMode: 'grant',
    });
    // Run A finished — the implicit finish outcome is committed by the
    // complete-time settle.
    expect(completedA.disposition).toBe('terminal');
    expect(registry.isBusy(SHARED_WORKSPACE)).toBe(false);

    // ---- Run B resumes: the pre-pass sees the workspace free and
    // auto-resumes the wait; the admit pass then admits Run B's writer in
    // the SAME revision. No conflicting write ever occurred. ----
    const resumedB = await runtimeB.resume(resumeRequest(planB), {
      deliveryMode: 'grant',
    });
    expect(resumedB.actions).toHaveLength(1);
    expect(resumedB.disposition).toBe('advanced');

    // The workspace-reservation wait is gone from the resumed Record.
    const resumedRecordB = storeB.load(planB.runId);
    const remainingReservations = resumedRecordB.waits.filter(
      (w) => w.kind === 'workspace-reservation'
    );
    expect(remainingReservations).toHaveLength(0);
    // Run B's writer IS now admitted.
    expect(Object.keys(resumedRecordB.actions)).toHaveLength(1);
  });

  it('keeps the workspace-reservation wait idempotent while the workspace stays held', async () => {
    const registry = createWorkspaceReservationRegistry();
    const planA = singleWriterPlan('a');
    const planB = singleWriterPlan('b');
    const storeA = createInMemoryRunStore();
    const storeB = createInMemoryRunStore();

    const runtimeA = createChangePipelineRuntime({
      store: storeA,
      plan: planA,
      initialRecord: startRecordFor(planA, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(planA),
      reservationRegistry: registry,
    });
    const runtimeB = createChangePipelineRuntime({
      store: storeB,
      plan: planB,
      initialRecord: startRecordFor(planB, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(planB),
      reservationRegistry: registry,
    });

    // A holds the workspace.
    const startedA = await runtimeA.start(startRequest(planA), {
      deliveryMode: 'grant',
    });
    expect(startedA.actions).toHaveLength(1);

    // B is blocked; the wait is committed.
    const startedB = await runtimeB.start(startRequest(planB), {
      deliveryMode: 'grant',
    });
    const versionAfterStart = startedB.view.recordVersion;
    const waitIdAfterStart = rootOf(startedB).waits.find(
      (w: { kind: string }) => w.kind === 'workspace-reservation'
    )!.waitId;

    // B resumes while A still holds the lease. The settle re-derives the
    // SAME waitId, sees it already in the Record, and skips the suspend
    // stimulus — no new version (the "retryable and non-churning" scenario).
    const resumedB = await runtimeB.resume(resumeRequest(planB), {
      deliveryMode: 'grant',
    });
    expect(resumedB.view.recordVersion).toBe(versionAfterStart);
    const waitIdAfterResume = rootOf(resumedB).waits.find(
      (w: { kind: string }) => w.kind === 'workspace-reservation'
    )!.waitId;
    expect(waitIdAfterResume).toBe(waitIdAfterStart);
    expect(resumedB.actions).toEqual([]);
  });

  it('commits a workspace-reservation wait for intra-Run await-workspace candidates (no registry)', async () => {
    // Two writers in ONE Run with no shared registry: the reconciler's
    // selectCompatibleAdmissions admits the lower-NodeId writer and emits
    // await-workspace for the other. The facade commits a
    // workspace-reservation wait for the blocked writer.
    const plan = createRuntimePlan({
      runId: branded<RunId>(`run:${'c'.repeat(64)}`),
      pipeline: 'two-writers',
      planDigest: branded(seedDigest('c')),
      profileDigest: branded(seedDigest('d')),
      sourceRevisionDigest: branded(seedDigest('e')),
      capabilityDigest: branded(seedDigest('f')),
      policyDigest: branded(seedDigest('9')),
      implicitFinishOutcome: 'two-writers-completed',
      nodes: [
        {
          kind: 'atomic',
          hierarchicalPath: 'root/w1',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
        },
        {
          kind: 'atomic',
          hierarchicalPath: 'root/w2',
          requires: [],
          admissionKind: 'agent',
          workspace: { access: 'write' },
        },
      ],
    } as RuntimePlanInput);
    const store = createInMemoryRunStore();
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: startRecordFor(plan, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(plan),
    });

    const started = await runtime.start(startRequest(plan), {
      deliveryMode: 'grant',
    });
    // Exactly one writer is admitted (lower NodeId). The other is blocked
    // behind a workspace-reservation wait.
    expect(started.actions).toHaveLength(1);
    const startedRoot = rootOf(started);
    const reservation = startedRoot.waits.find(
      (w: { kind: string }) => w.kind === 'workspace-reservation'
    );
    expect(reservation).toBeDefined();
    expect(reservation!.intents.length).toBe(1);
    expect(reservation!.intents[0]!.access).toBe('write');
    // The blocked intent carries no ActionId/AttemptId (not-yet-admitted).
    expect('actionId' in reservation!.intents[0]!).toBe(false);
    expect('attemptId' in reservation!.intents[0]!).toBe(false);
  });
});
