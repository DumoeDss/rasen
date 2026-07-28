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
  type CanonicalRunRecord,
} from '../../../src/core/change-run/internal/record.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { createWorkspaceReservationRegistry } from '../../../src/core/change-run/internal/reservations.js';
import {
  fixtureDigests,
  fixtureLimits,
  fixtureWorkspaceRevision,
  agentAction,
} from './reconciler-fixture.js';
import type { RuntimePlan, RuntimePlanInput } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { CompleteRunAction } from '../../../src/core/change-run/contracts.js';
import type {
  ActionId,
  Digest,
  RunAction,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';

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
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
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

function buildCompletion(record: CanonicalRunRecord, action: RunAction): CompleteRunAction {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('complete settles the candidate batch (Gap A)', () => {
  it('commits the next Gate wait in the SAME complete call — no resume-run needed', async () => {
    const plan = gatedSuccessorPlan('a');
    const store = createInMemoryRunStore();
    const runtime = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: startRecordFor(plan, SHARED_WORKSPACE),
      buildAction: buildActionForPlan(plan),
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
    const completion = buildCompletion(store.load(plan.runId), actionA);
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
    const completionA = buildCompletion(storeA.load(planA.runId), actionA);
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
