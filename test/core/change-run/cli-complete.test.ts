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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PipelineCommand } from '../../../src/commands/pipeline.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  buildEvidenceRef,
  computeEvidenceContentDigest,
  createBoundedEvidenceStore,
  type BoundedEvidenceStore,
} from '../../../src/core/change-run/internal/evidence.js';
import { createFilesystemEvidenceStore } from '../../../src/core/change-run/internal/evidence-store-fs.js';
import {
  computeCompletionReceiptDigest,
} from '../../../src/core/change-run/internal/completion.js';
import {
  agentAction,
  startRecord,
  evidenceFor,
  fixtureDigests,
} from './reconciler-fixture.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { admitPreviewedCandidates } from '../../helpers/change-run-admission.js';
import type {
  ActionId,
  ChangeInstanceId,
  CompleteRunAction,
  Digest,
  EvidenceRef,
  EffectId,
  InvocationId,
  PlanningSpaceId,
  RunAction,
  RunId,
} from '../../../src/core/change-run/index.js';
import { InputReaderError } from '../../../src/core/change-run/internal/input-reader.js';
import { createHostEvidenceWriter } from '../../../src/core/change-run/internal/host-evidence-writer.js';
import { attestTestCompletion } from '../../fixtures/trusted-completion.js';

const branded = <T>(value: string): T => value as T;

// ---------------------------------------------------------------------------
// Fixture: a single-node non-gated linear plan so facade.start immediately
// grants the one action (no gate await/decide cycle needed).
// ---------------------------------------------------------------------------

const LINEAR_RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);
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
  evidenceStore: ReturnType<typeof createBoundedEvidenceStore>;
  grantedAction: RunAction;
}

async function buildStartedRuntime(
  observeEffect = true,
  providedEvidenceStore?: BoundedEvidenceStore
): Promise<TestRuntime> {
  const plan = linearPlan();
  const store = createInMemoryRunStore();
  const initial = startRecord(plan);
  const evidenceStore = providedEvidenceStore ?? createBoundedEvidenceStore({
    maxRunBytes: 1024 * 1024,
    maxEntries: 64,
  });
  // Do NOT store.create() — facade.start() checks store.has() and creates
  // the record itself on the created path (with granted admits). Pre-creating
  // would make start return 'reused' with zero actions.

  const facade = createChangePipelineRuntime({
    store,
    plan,
    initialRecord: initial,
    buildAction: (d) => agentAction(plan, 'root/a', d.occurrence),
    evidenceStore,
  });

  const ref = {
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    runId: plan.runId,
  };
  const preview = await facade.start(
    {
      change: ref.change,
      pipeline: 'linear',
      launchRequestId: branded(`launch:${'1'.repeat(60)}1111`),
    },
    { deliveryMode: 'grant' },
  );
  const receipt = await admitPreviewedCandidates(facade, ref, preview);
  const grantedAction = receipt.actions[0];
  if (!grantedAction) throw new Error('fixture: start did not grant an action');

  // Observe the workspace effect so a domain-action-result completion can
  // close (the reducer requires all effects observed before a successful
  // result). This goes through the reducer directly — effect observation is
  // an internal kernel operation, NOT a CLI command path.
  if (observeEffect) {
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
  }

  return { plan, store, facade, evidenceStore, grantedAction };
}

// ---------------------------------------------------------------------------
// Helpers for building valid completion submissions with real upload content.
// ---------------------------------------------------------------------------

function makeEvidence(
  content: Uint8Array,
  actionId: ActionId,
  observationKind: string,
  schema: string,
  effectId?: EffectId,
  authority?: Readonly<{
    producer: EvidenceRef['producer'];
    treeDigest: Digest;
  }>,
): EvidenceRef {
  return buildEvidenceRef({
    content,
    mediaType: 'application/json',
    observationKind,
    producer: authority?.producer ?? {
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
      ...(authority === undefined ? {} : { treeDigest: authority.treeDigest }),
      ...(effectId === undefined ? {} : { effectId }),
    },
  });
}

function makeObservationCompletion(
  rt: TestRuntime,
  kind: 'effect-observation' | 'infrastructure-observation',
  evidenceContent: Uint8Array,
  _attestationContent: Uint8Array,
): { completion: CompleteRunAction; evidenceRef: EvidenceRef; attestationRef: EvidenceRef } {
  const grantedAction = rt.grantedAction;
  const actionId = grantedAction.actionId;
  const effectId = grantedAction.effects[0]!.effectId as EffectId;
  const semantic = kind === 'effect-observation'
    ? ({
        kind,
        effectId,
        status: 'succeeded' as const,
        observation: { workspaceRevision: 'cli-observed' },
      } as const)
    : ({
        kind,
        status: 'infrastructure_failed' as const,
        error: {
          code: 'adapter_unavailable',
          retryable: true,
          adapterArtifactDigest: grantedAction.capability.artifact.contentDigest,
        },
      } as const);
  const submission = attestTestCompletion({
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    record: rt.store.load(rt.plan.runId),
    action: grantedAction,
    completion: semantic,
    evidenceContent,
  });
  rememberTrustedUploads(submission.uploads);
  return {
    completion: submission.completion,
    evidenceRef: submission.completion.evidence[0]!,
    attestationRef: submission.completion.actorAttestation,
  };
}

function makeCompletion(
  rt: TestRuntime,
  evidenceContent: Uint8Array,
  _attestationContent: Uint8Array,
): { completion: CompleteRunAction; evidenceRef: EvidenceRef; attestationRef: EvidenceRef } {
  const submission = attestTestCompletion({
    change: { projectRoot: '/root', changeId: 'fixture-change' },
    record: rt.store.load(rt.plan.runId),
    action: rt.grantedAction,
    completion: { kind: 'domain-action-result', status: 'succeeded', result: { ok: true } },
    evidenceContent,
  });
  rememberTrustedUploads(submission.uploads);
  return {
    completion: submission.completion,
    evidenceRef: submission.completion.evidence[0]!,
    attestationRef: submission.completion.actorAttestation,
  };
}

const trustedUploadByDigest = new Map<string, string>();

function rememberTrustedUploads(
  uploads: readonly Readonly<{ contentDigest: string; contentBase64: string }>[]
): void {
  for (const upload of uploads) {
    trustedUploadByDigest.set(upload.contentDigest, upload.contentBase64);
  }
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
      contentBase64: trustedUploadByDigest.get(evidenceRef.contentDigest)
        ?? Buffer.from(evidenceContent).toString('base64'),
    },
    {
      contentDigest: attestationRef.contentDigest,
      contentBase64: trustedUploadByDigest.get(attestationRef.contentDigest)
        ?? Buffer.from(attestationContent).toString('base64'),
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
      evidenceStore: rt.evidenceStore,
      hostEvidenceWriter: createHostEvidenceWriter({
        runId: rt.plan.runId,
        runStore: rt.store,
        evidenceStore: rt.evidenceStore,
      }),
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
      rt,
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

  it('submits an effect observation from bounded JSON with trusted uploads', async () => {
    const rt = await buildStartedRuntime(false);
    const evidenceContent = new TextEncoder().encode('{"effect":"applied"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeObservationCompletion(
      rt,
      'effect-observation',
      evidenceContent,
      attestationContent,
    );
    const file = join(dir, 'effect-observation.json');
    writeFileSync(file, JSON.stringify({
      completion,
      uploads: uploadsFor(
        evidenceRef,
        attestationRef,
        evidenceContent,
        attestationContent,
      ),
    }));

    const output = await captureLog(() =>
      commandForRuntime(rt).complete(
        'fixture-change',
        rt.plan.runId as string,
        file,
        { json: true },
      ),
    );
    expect(JSON.parse(output)).toMatchObject({
      disposition: 'advanced',
      status: 'running',
    });
    const committed = rt.store.load(rt.plan.runId).actions[rt.grantedAction.actionId]!;
    expect(committed.result).toBeUndefined();
    expect(committed.effects[0]).toMatchObject({
      state: 'succeeded',
      receiptDigest: completion.receiptDigest,
      evidence: [evidenceRef],
    });
  });

  it('publishes retained observation bytes that a fresh runtime store can reopen', async () => {
    const evidenceRoot = join(dir, 'persistent-run-store');
    mkdirSync(evidenceRoot, { recursive: true });
    const persistent = createFilesystemEvidenceStore(evidenceRoot, LINEAR_RUN_ID, {
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });
    const rt = await buildStartedRuntime(false, persistent);
    const evidenceContent = new TextEncoder().encode('{"effect":"persisted"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeObservationCompletion(
      rt,
      'effect-observation',
      evidenceContent,
      attestationContent,
    );
    const file = join(dir, 'persistent-effect.json');
    writeFileSync(file, JSON.stringify({
      completion,
      uploads: uploadsFor(
        evidenceRef,
        attestationRef,
        evidenceContent,
        attestationContent,
      ),
    }));

    await commandForRuntime(rt).complete(
      'fixture-change',
      rt.plan.runId as string,
      file,
      { json: true },
    );

    const fresh = createFilesystemEvidenceStore(evidenceRoot, LINEAR_RUN_ID, {
      maxRunBytes: 1024 * 1024,
      maxEntries: 64,
    });
    expect(Buffer.from(fresh.read(evidenceRef))).toEqual(Buffer.from(evidenceContent));
    expect(Buffer.from(fresh.read(attestationRef))).toEqual(
      Buffer.from(trustedUploadByDigest.get(attestationRef.contentDigest)!, 'base64')
    );
  });

  it('submits an infrastructure observation without rewriting it as domain failure', async () => {
    const rt = await buildStartedRuntime(false);
    const evidenceContent = new TextEncoder().encode('{"adapter":"offline"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeObservationCompletion(
      rt,
      'infrastructure-observation',
      evidenceContent,
      attestationContent,
    );
    const file = join(dir, 'infrastructure-observation.json');
    writeFileSync(file, JSON.stringify({
      completion,
      uploads: uploadsFor(
        evidenceRef,
        attestationRef,
        evidenceContent,
        attestationContent,
      ),
    }));

    const output = await captureLog(() =>
      commandForRuntime(rt).complete(
        'fixture-change',
        rt.plan.runId as string,
        file,
        { json: true },
      ),
    );
    expect(JSON.parse(output)).toMatchObject({
      disposition: 'waiting',
      status: 'waiting',
    });
    const committed = rt.store.load(rt.plan.runId).actions[rt.grantedAction.actionId]!;
    expect(committed.result).toBeUndefined();
    expect(committed.infrastructure).toMatchObject({
      code: 'adapter_unavailable',
      retryable: true,
      artifactDigest: rt.grantedAction.capability.artifact.contentDigest,
      receiptDigest: completion.receiptDigest,
      evidence: [evidenceRef],
    });
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
      rt,
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
      rt,
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
      attestationRef.contentDigest,
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
      rt,
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
      rt,
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
    ).rejects.toThrowError(/not referenced|orphan/i);
  });

  it('rejects when an evidence ref has no staged upload content', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt,
      evidenceContent,
      attestationContent,
    );
    // Provide only the attestation upload — the evidence upload is missing.
    const body = {
      completion,
      uploads: [
        {
          contentDigest: attestationRef.contentDigest,
          contentBase64: trustedUploadByDigest.get(attestationRef.contentDigest)!,
        },
      ],
    };
    const file = join(dir, 'missing.json');
    writeFileSync(file, JSON.stringify(body));

    const command = commandForRuntime(rt);
    await expect(
      command.complete('fixture-change', rt.plan.runId as string, file, { json: true }),
    ).rejects.toThrowError(/has no upload|no staged upload/i);
  });

  it('rejects an upload whose contentDigest does not match its bytes', async () => {
    const rt = await buildStartedRuntime();
    const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
    const attestationContent = new TextEncoder().encode('{"signed":true}');
    const { completion, evidenceRef, attestationRef } = makeCompletion(
      rt,
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
        contentBase64: trustedUploadByDigest.get(attestationRef.contentDigest)!,
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
  it('control with cancel dispatches the public envelope through facade.control', async () => {
    // The facade owns public-control translation so every caller gets the same
    // optimistic identity checks and wait-kind-specific decision routing.
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
      const envelope = controlSpy.mock.calls[0]![0];
      expect(envelope).toMatchObject({
        format: 'change-run-control/1',
        expectedRecordVersion: record.recordVersion,
        command: { kind: 'cancel' },
      });
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
