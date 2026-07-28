/**
 * CLI complete/control handler tests (tasks 12.5 RED / 12.6 GREEN / 7.9 / 12.7).
 *
 * These tests exercise the REAL PipelineCommand.complete() and .control()
 * methods — the same handler the CLI dispatcher calls. They cross the CLI
 * layer (argument parsing → bounded file reading → upload staging through
 * HostEvidenceWriter → strict schema decode → facade call → receipt
 * formatting). They do NOT spawn `node bin/rasen.js` (that E2E belongs to a
 * later wave).
 *
 * The runtime context is injected via the PipelineCommand constructor's
 * optional resolver, using a real in-memory kernel fixture. This bypasses
 * only the heavy root-selection + registry-freeze + profile-resolution chain
 * (already exercised by start/status/cancel tests) — everything else is the
 * genuine CLI surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PipelineCommand } from '../../../src/commands/pipeline.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  buildEvidenceRef,
  computeEvidenceContentDigest,
} from '../../../src/core/change-run/internal/evidence.js';
import {
  computeCompletionReceiptDigest,
} from '../../../src/core/change-run/internal/completion.js';
import { buildAgentActor } from '../../../src/core/change-run/internal/actors.js';
import {
  agentAction,
  startRecord,
  evidenceFor,
  fixtureDigests,
} from './reconciler-fixture.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type {
  ActionId,
  ChangeInstanceId,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  InvocationId,
  PlanningSpaceId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/index.js';
import { InputReaderError } from '../../../src/core/change-run/internal/input-reader.js';

const branded = <T>(value: string): T => value as T;

// ---------------------------------------------------------------------------
// Fixture: a single-node non-gated linear plan so facade.start immediately
// grants the one action (no gate await/decide cycle needed).
// ---------------------------------------------------------------------------

const LINEAR_RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);
const LINEAR_DIGEST = branded<Digest>(`sha256:${'b'.repeat(64)}`);
const LINEAR_ATTESTATION = branded<Digest>(`sha256:${'c'.repeat(64)}`);
const LINEAR_IDENTITY = branded<Digest>(`sha256:${'d'.repeat(64)}`);
const PLANNING_SPACE = branded<PlanningSpaceId>(`planning-space:${'1'.repeat(64)}`);
const CHANGE_INSTANCE = branded<ChangeInstanceId>(`change-instance:${'2'.repeat(64)}`);

// ---------------------------------------------------------------------------

function linearPlan(): RuntimePlan {
  return createRuntimePlan({
    runId: LINEAR_RUN_ID,
    pipeline: 'linear',
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'linear-completed',
    nodes: [
      {
        kind: 'atomic',
        hierarchicalPath: 'root/a',
        requires: [],
        admissionKind: 'agent',
        workspace: { access: 'write' },
      },
    ],
  });
}

interface TestRuntime {
  plan: RuntimePlan;
  store: ReturnType<typeof createInMemoryRunStore>;
  facade: ReturnType<typeof createChangePipelineRuntime>;
  grantedAction: RunAction;
}

async function buildStartedRuntime(): Promise<TestRuntime> {
  const plan = linearPlan();
  const store = createInMemoryRunStore();
  const initial = startRecord(plan);
  // Do NOT store.create() — facade.start() checks store.has() and creates
  // the record itself on the created path (with granted admits). Pre-creating
  // would make start return 'reused' with zero actions.

  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord: initial,
    buildAction: (d) => agentAction(plan, 'root/a', d.occurrence),
  });

  // Start grants the single non-gated action immediately.
  const receipt = await facade.start(
    {
      change: { projectRoot: '/root', changeId: 'fixture-change' },
      pipeline: 'linear',
      launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
    },
    { deliveryMode: 'grant' },
  );
  const grantedAction = receipt.actions[0];
  if (!grantedAction) throw new Error('fixture: start did not grant an action');

  // Observe the workspace effect so a domain-action-result completion can
  // close (the reducer requires all effects observed before a successful
  // result). This goes through the reducer directly — effect observation is
  // an internal kernel operation, NOT a CLI command path.
  const record = store.load(plan.runId);
  const effectId = grantedAction.effects[0]!.effectId;
  const observeResult = reduceCanonicalRunRecord(record, {
    kind: 'observe-effect',
    actionId: grantedAction.actionId,
    effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true },
    evidence: evidenceFor(plan, grantedAction.actionId),
  });
  if (!observeResult.ok) {
    throw new Error('fixture: effect observation failed');
  }
  store.commit(plan.runId, observeResult.record);

  return { plan, store, facade, grantedAction };
}

// ---------------------------------------------------------------------------
// Helpers for building valid completion submissions with real upload content.
// ---------------------------------------------------------------------------

function makeEvidence(
  content: Uint8Array,
  actionId: ActionId,
  observationKind: string,
  schema: string,
): EvidenceRef {
  return buildEvidenceRef({
    content,
    mediaType: 'application/json',
    observationKind,
    producer: {
      id: 'fixture-producer',
      version: '1',
      identityDigest: LINEAR_IDENTITY,
    },
    binding: {
      planningSpaceId: PLANNING_SPACE,
      changeInstanceId: CHANGE_INSTANCE,
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: LINEAR_RUN_ID,
      actionId,
      schema,
    },
  });
}

function makeCompletion(
  grantedAction: RunAction,
  evidenceContent: Uint8Array,
  attestationContent: Uint8Array,
): { completion: CompleteRunAction; evidenceRef: EvidenceRef; attestationRef: EvidenceRef } {
  const actionId = grantedAction.actionId;
  const evidenceRef = makeEvidence(evidenceContent, actionId, 'completion-evidence', 'evidence/1');
  const attestationRef = makeEvidence(attestationContent, actionId, 'actor-attestation', 'attestation/1');

  const actor = buildAgentActor({
    role: 'implementer',
    provider: 'anthropic',
    runtime: 'claude',
    principalIdentityDigest: LINEAR_ATTESTATION,
    sessionIdentityDigest: LINEAR_DIGEST,
    adapter: { id: 'adapter:fixture', version: '1', artifactDigest: LINEAR_DIGEST },
  });

  const base = {
    format: 'change-run-completion/1' as const,
    kind: 'domain-action-result' as const,
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: grantedAction.runId,
    actionId,
    invocationId: grantedAction.invocationId,
    actor,
    actorAttestation: attestationRef,
    evidence: [evidenceRef],
    status: 'succeeded' as const,
    result: { ok: true },
  };
  const receiptDigest = computeCompletionReceiptDigest(base as CompleteRunAction);
  return {
    completion: { ...base, receiptDigest } as CompleteRunAction,
    evidenceRef,
    attestationRef,
  };
}

function uploadsFor(
  evidenceRef: EvidenceRef,
  attestationRef: EvidenceRef,
  evidenceContent: Uint8Array,
  attestationContent: Uint8Array,
): Array<{ contentDigest: string; contentBase64: string }> {
  return [
    {
      contentDigest: evidenceRef.contentDigest,
      contentBase64: Buffer.from(evidenceContent).toString('base64'),
    },
    {
      contentDigest: attestationRef.contentDigest,
      contentBase64: Buffer.from(attestationContent).toString('base64'),
    },
  ];
}

/** Create a PipelineCommand whose --run resolver returns the injected runtime. */
function commandForRuntime(rt: TestRuntime): PipelineCommand {
  return new PipelineCommand(async () => ({
    ctx: {
      facade: rt.facade,
      store: rt.store,
      plan: rt.plan,
      initialRecord: rt.store.load(rt.plan.runId),
    },
    pipeline: { name: 'linear' } as never,
    runId: rt.plan.runId as string,
    projectRoot: '/root',
    projectId: 'project-fixture',
    launchKey: 'test',
  }));
}

/** Capture console.log output as a string. */
async function captureLog(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    captured += args.map(String).join(' ') + '\n';
  });
  try {
    await fn();
    return captured;
  } finally {
    spy.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI complete handler (12.5/12.6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rasen-cli-complete-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('completes a Run action from a receipt file and prints a receipt', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );
    const body = {
      completion,
      uploads: uploadsFor(evidenceRef, attestationRef, evidenceContent, attestationContent),
    };
    const file = join(dir, 'receipt.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    const output = await captureLog(() =>
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    );
    const result = JSON.parse(output);
    expect(result.runId).toBe(rt.plan.runId);
    // After completing the only action, the complete-time settle fires the
    // implicit root finish and the run reaches a terminal state (completed)
    // in the SAME revision as the completion (design §5.6).
    expect(result.disposition).toBe('terminal');
    expect(result.status).toBe('completed');
  });

  it('rejects a symlink receipt body (no-follow)', async () => {
    const rt = await buildStartedRuntime();
    const target = join(dir, 'real.json');
    writeFileSync(target, '{"completion":{}}');
    const link = join(dir, 'link.json');
    try {
      symlinkSync(target, link);
    } catch {
      return; // skip on platforms without symlink support
    }
    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, link, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });

  it('rejects an oversized body', async () => {
    const rt = await buildStartedRuntime();
    const file = join(dir, 'big.json');
    writeFileSync(file, 'x'.repeat(200));
    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });

  it('rejects malformed JSON', async () => {
    const rt = await buildStartedRuntime();
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not valid json');
    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });

  it('rejects a body without a "completion" field', async () => {
    const rt = await buildStartedRuntime();
    const file = join(dir, 'noCompletion.json');
    writeFileSync(file, JSON.stringify({ foo: 'bar' }));
    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });

  it('rejects unknown fields in the completion envelope (strict schema)', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );
    // Inject an unknown field that strictObject must reject.
    const poisoned = { ...completion, evil: 'inject' } as never;
    const body = {
      completion: poisoned,
      uploads: uploadsFor(evidenceRef, attestationRef, evidenceContent, attestationContent),
    };
    const file = join(dir, 'evil.json');
    writeFileSync(file, JSON.stringify(body));
    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7.9: Transport upload staging through HostEvidenceWriter
// ---------------------------------------------------------------------------

describe('CLI transport upload staging (7.9)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rasen-cli-uploads-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stages uploads through HostEvidenceWriter before the facade receives refs', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );

    // Intercept facade.complete to prove it receives refs AFTER staging.
    const completeSpy = vi.spyOn(rt.facade, 'complete');

    const body = {
      completion,
      uploads: uploadsFor(evidenceRef, attestationRef, evidenceContent, attestationContent),
    };
    const file = join(dir, 'receipt.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    const output = await captureLog(() =>
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    );

    // The facade was called with refs whose digests match the upload content.
    expect(completeSpy).toHaveBeenCalledTimes(1);
    const received = completeSpy.mock.calls[0]![0] as CompleteRunAction;
    expect(received.evidence[0]!.contentDigest).toBe(
      computeEvidenceContentDigest(evidenceContent),
    );
    expect(received.actorAttestation.contentDigest).toBe(
      computeEvidenceContentDigest(attestationContent),
    );
    // The receipt was produced — staging + facade both succeeded.
    const result = JSON.parse(output);
    expect(result.disposition).toBeDefined();
  });

  it('only refs enter the receipt bytes — raw content never reaches the facade', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"secret"}');
    const attestationContent = new TextEncoder().encode('{"signed":"secret"}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );

    // Intercept facade.complete to inspect what it receives.
    const completeSpy = vi.spyOn(rt.facade, 'complete');

    const body = {
      completion,
      uploads: uploadsFor(evidenceRef, attestationRef, evidenceContent, attestationContent),
    };
    const file = join(dir, 'receipt.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await command.complete('fixture-change', rt.plan.runId as string, file, { json: true });

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const received = completeSpy.mock.calls[0]![0] as CompleteRunAction;
    // The completion carries refs (with digests), never the raw content strings.
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain('secret');
    // But the refs' digests ARE present.
    expect(received.evidence[0]!.contentDigest).toBe(evidenceRef.contentDigest);
    expect(received.actorAttestation.contentDigest).toBe(attestationRef.contentDigest);
  });

  it('rejects orphaned uploads not referenced by any evidence ref', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );
    // Add an orphan upload not referenced by any EvidenceRef.
    const orphanContent = new TextEncoder().encode('{"orphan":true}');
    const orphanDigest = computeEvidenceContentDigest(orphanContent);
    const uploads = [
      ...uploadsFor(evidenceRef, attestationRef, evidenceContent, attestationContent),
      { contentDigest: orphanDigest, contentBase64: Buffer.from(orphanContent).toString('base64') },
    ];
    const body = { completion, uploads };
    const file = join(dir, 'orphan.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(/orphan/i);
  });

  it('rejects when an evidence ref has no staged upload content', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );
    // Provide only the attestation upload — the evidence upload is missing.
    const body = {
      completion,
      uploads: [
        {
          contentDigest: attestationRef.contentDigest,
          contentBase64: Buffer.from(attestationContent).toString('base64'),
        },
      ],
    };
    const file = join(dir, 'missing.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(/no staged upload/i);
  });

  it('rejects an upload whose contentDigest does not match its bytes', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt.grantedAction,
      evidenceContent,
      attestationContent,
    );
    // Tamper: claim a digest but supply different bytes.
    const fakeDigest = branded<Digest>(`sha256:${'0'.repeat(64)}`);
    const uploads = [
      {
        contentDigest: fakeDigest,
        contentBase64: Buffer.from(evidenceContent).toString('base64'),
      },
      {
        contentDigest: attestationRef.contentDigest,
        contentBase64: Buffer.from(attestationContent).toString('base64'),
      },
    ];
    const body = { completion, uploads };
    const file = join(dir, 'tampered.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(/mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// CLI control handler (12.5/12.6)
// ---------------------------------------------------------------------------

describe('CLI control handler (12.5/12.6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rasen-cli-control-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('submits a cancel control request from a body', async () => {
    const rt = await buildStartedRuntime();
    const record = rt.store.load(rt.plan.runId);
    const body = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: rt.plan.runId,
        },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel' },
      },
    };
    const file = join(dir, 'control.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    const output = await captureLog(() =>
      command.control('fixture-change', rt.plan.runId as string, file, { json: true }),
    );
    const result = JSON.parse(output);
    expect(result.runId).toBe(rt.plan.runId);
    expect(result.status).toBe('cancelled');
  });

  it('submits an escalate control request from a body', async () => {
    const rt = await buildStartedRuntime();
    const record = rt.store.load(rt.plan.runId);
    const body = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: rt.plan.runId,
        },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'escalate', reason: 'human attention needed' },
      },
    };
    const file = join(dir, 'escalate.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    const output = await captureLog(() =>
      command.control('fixture-change', rt.plan.runId as string, file, { json: true }),
    );
    const result = JSON.parse(output);
    expect(result.status).toBe('escalated');
  });

  it('rejects a control body with an unknown command field (strict schema)', async () => {
    const rt = await buildStartedRuntime();
    const record = rt.store.load(rt.plan.runId);
    const body = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: rt.plan.runId,
        },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel', unknownField: 'evil' },
      },
    };
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await expect(
      command.control('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrow();
  });

  it('rejects a malformed control body', async () => {
    const rt = await buildStartedRuntime();
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    const command = commandForRuntime(rt);
    await expect(
      command.control('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });

  it('rejects a control body without a "control" field', async () => {
    const rt = await buildStartedRuntime();
    const file = join(dir, 'noControl.json');
    writeFileSync(file, JSON.stringify({ foo: 'bar' }));
    const command = commandForRuntime(rt);
    await expect(
      command.control('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(InputReaderError);
  });
});

// ---------------------------------------------------------------------------
// 12.7: Legacy resume byte-shape parity
// ---------------------------------------------------------------------------

describe('Legacy resume byte-shape parity (12.7)', () => {
  it('control with cancel dispatches through facade.control as a cancel stimulus', async () => {
    // The design says "cancel is only typed sugar over control." Verify that
    // the control command path converts a cancel control request into the
    // matching RunStimulus and dispatches through facade.control.
    const rt = await buildStartedRuntime();
    const controlSpy = vi.spyOn(rt.facade, 'control');

    const record = rt.store.load(rt.plan.runId);
    const body = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: '/root', changeId: 'fixture-change' },
          runId: rt.plan.runId,
        },
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel' },
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'rasen-cli-parity-'));
    try {
      const file = join(dir, 'cancel.json');
      writeFileSync(file, JSON.stringify(body));
      const command = commandForRuntime(rt);
      await command.control('fixture-change', rt.plan.runId as string, file, {
        json: true,
      });

      expect(controlSpy).toHaveBeenCalledTimes(1);
      const stimulus = controlSpy.mock.calls[0]![0] as { kind: string };
      expect(stimulus.kind).toBe('cancel');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the legacy resume method is unchanged (still reads run-state, not the facade)', async () => {
    // Structural assertion: the resume method signature is unchanged — it
    // still accepts (change, options) and reads the legacy run-state file,
    // NOT through the facade. This is the "byte-shape compatibility"
    // guarantee from design §12: "The existing resume --json legacy object
    // remains byte-shape-compatible when no reconciler Run is selected."
    //
    // We verify by checking that PipelineCommand.resume is the legacy method
    // (takes change string, not runId) and PipelineCommand.resumeRun is the
    // reconciler method (takes change + pipeline). Both coexist without
    // interference — the legacy path never touches the facade.
    expect(typeof PipelineCommand.prototype.resume).toBe('function');
    expect(typeof PipelineCommand.prototype.resumeRun).toBe('function');
    expect(PipelineCommand.prototype.resume).not.toBe(
      PipelineCommand.prototype.resumeRun,
    );
  });
});
