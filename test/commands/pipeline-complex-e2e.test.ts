/**
 * Fresh-process complex-route E2E (task 15.4 of `ecp-run-spine`).
 *
 * Proves the durable unsupported ReviewCycle wait when an adaptive verify
 * stage reports a complex route. The Run must NOT fall through to ship, must
 * NOT offer a human an uncertain resume, and MUST support safe escalate and
 * cancel paths.
 *
 * Drives a real bug-fix Run through FRESH CLI processes
 * (`node dist/cli/index.js pipeline start/status/resume-run/control`),
 * interrupted at every quiescent point. Two operations have NO CLI command and
 * are performed in-process against the filesystem store (documented
 * kernel-internal gaps, same pattern as 15.3):
 *   - Gate-wait commitment (`await-gate` stimulus).
 *   - Effect observation (`observe-effect` stimulus).
 *
 * What the complex route means: the verify stage has `verifyPolicy: 'adaptive'`.
 * When the verify action completes with `result.route === 'complex'`, the
 * reconciler classifies the node as `suspending-unsupported` and emits a
 * `suspend-unsupported` candidate with code `review_cycle_capability_unavailable`.
 * The facade's `grantAdmits` only processes `admit` candidates, so no further
 * action (especially ship) is ever granted. The Run is durably stuck — only
 * escalate and cancel can move it forward.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { runCLI } from '../helpers/run-cli.js';

// Kernel internals — used ONLY for the two documented kernel-internal steps
// (gate-wait commitment + effect observation). These fill the gap where no
// CLI command exists; they do NOT bypass the CLI for user-facing operations.
import { freezeProductionPreparedPipelineRegistry } from '../../src/core/pipeline-registry/prepared-registry.js';
import { resolveRuntimeExecutionProfile } from '../../src/core/pipeline-registry/profile-resolver.js';
import { lowerRuntimePlan } from '../../src/core/change-run/internal/lowerer.js';
import { reconcile } from '../../src/core/change-run/internal/reconciler.js';
import { reduceCanonicalRunRecord } from '../../src/core/change-run/internal/reducer.js';
import { decodeCanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import { createCanonicalWait } from '../../src/core/change-run/internal/waits.js';
import { deriveInvocationId } from '../../src/core/change-run/internal/identity.js';
import { computeCompletionReceiptDigest } from '../../src/core/change-run/internal/completion.js';
import { buildAgentActor } from '../../src/core/change-run/internal/actors.js';
import { buildEvidenceRef } from '../../src/core/change-run/internal/evidence.js';
import type { RuntimePlan } from '../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import type { RunStimulus } from '../../src/core/change-run/internal/reducer.js';
import type { Digest, RunId, JsonValue } from '../../src/core/change-run/index.js';

// ---------------------------------------------------------------------------
// Helpers (mirror pipeline-bugfix-e2e.test.ts — same documented pattern)
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;

async function buildBugFixPlan(projectRoot: string, runId: string): Promise<RuntimePlan> {
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, { reporter: false });
  const execution = await registry.selectForExecution('bug-fix', { reporter: false });
  const prepared = execution.resolution.prepared;
  const pipeline = prepared.authoredSource as {
    name: string;
    stages: Array<{
      id: string;
      role?: string;
      model?: string;
      gate?: boolean;
      verifyPolicy?: string;
    }>;
  };

  const sourceRevision = {
    layer: execution.resolution.source,
    kind: 'pipeline-yaml' as const,
    sourceId: `${execution.resolution.source}:${pipeline.name}`,
    authoredContentDigest: branded(`sha256:${prepared.digests.source}`),
    semanticDigest: branded(`sha256:${prepared.digests.source}`),
  };
  const policyStages = pipeline.stages.map((stage) => ({
    nodeId: `stage:${stage.id}`,
    role: stage.role ?? 'implementer',
    model: stage.model ?? 'default',
    effort: 'default',
    runtime: 'codex',
    sandbox:
      stage.verifyPolicy === 'adaptive' || stage.id === 'verify'
        ? ('read-only' as const)
        : ('workspace-write' as const),
    gate: stage.gate ?? false,
    sessionReuse: 'never' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'stage',
      model: stage.model ? 'stage' : 'default',
      effort: 'default',
      runtime: 'stage',
      sandbox: 'stage',
      gate: 'stage',
      sessionReuse: 'default',
      handoffTokenLimit: 'default',
      reuseRoundLimit: 'default',
    },
  }));
  const profile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    policyStages,
    sourceRevision,
    { maxAttempts: 3, maxActions: 64 }
  );
  return lowerRuntimePlan(prepared, profile, branded(runId));
}

function storeRootFor(xdgDataHome: string): string {
  return path.join(xdgDataHome, 'rasen', 'runs');
}

function loadHeadRecord(storeRoot: string, runId: string): CanonicalRunRecord {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDir = path.join(storeRoot, dirName);
  const files = readdirSync(runDir);
  let bestVersion = -1;
  for (const file of files) {
    const match = /^record-v(\d+)\.json$/.exec(file);
    if (match) {
      const version = Number.parseInt(match[1]!, 10);
      if (version > bestVersion) bestVersion = version;
    }
  }
  if (bestVersion === -1) throw new Error(`No record found for Run ${runId}`);
  const raw = readFileSync(path.join(runDir, `record-v${bestVersion}.json`), 'utf-8');
  return decodeCanonicalRunRecord(JSON.parse(raw));
}

function applyStimulusToStore(
  storeRoot: string,
  runId: string,
  stimulus: RunStimulus
): CanonicalRunRecord {
  const record = loadHeadRecord(storeRoot, runId);
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(
      `stimulus ${stimulus.kind} failed (${result.failure.code}): ${result.failure.message}`
    );
  }
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const newPath = path.join(
    storeRoot,
    dirName,
    `record-v${result.record.recordVersion}.json`
  );
  writeFileSync(newPath, JSON.stringify(result.record, null, 2));
  return result.record;
}

function commitGateWaits(storeRoot: string, plan: RuntimePlan, runId: string): void {
  const record = loadHeadRecord(storeRoot, runId);
  const reconciled = reconcile(plan, record);
  if (!reconciled.ok) throw new Error(`reconcile failed: ${reconciled.failure.message}`);
  for (const candidate of reconciled.actions) {
    if (candidate.kind !== 'await-gate') continue;
    const alreadyCommitted = record.waits.some((w) => w.waitId === candidate.waitId);
    if (alreadyCommitted) continue;
    const wait = createCanonicalWait(branded(runId), {
      kind: 'gate',
      nodeId: candidate.nodeId,
      invocationId: deriveInvocationId(branded(runId), candidate.nodeId, 0),
      occurrence: 0,
      gateId: candidate.gateId,
      decisionIds: [...candidate.decisionIds],
    });
    applyStimulusToStore(storeRoot, runId, { kind: 'await-gate', wait });
  }
}

function observeAdmittedEffects(storeRoot: string, runId: string): void {
  const record = loadHeadRecord(storeRoot, runId);
  const receiptDigest = branded<Digest>(`sha256:${'e'.repeat(64)}`);
  for (const committed of Object.values(record.actions)) {
    for (const effect of committed.effects) {
      if (effect.state === 'admitted') {
        applyStimulusToStore(storeRoot, runId, {
          kind: 'observe-effect',
          actionId: committed.action.actionId,
          effectId: effect.effectId,
          status: 'succeeded',
          receiptDigest,
          observation: { ok: true },
          evidence: [],
        });
      }
    }
  }
}

function buildCompletionBody(
  record: CanonicalRunRecord,
  runId: string,
  changeId: string,
  projectRoot: string,
  actionId: string,
  invocationId: string,
  result?: JsonValue
): { completion: Record<string, unknown>; uploads: Array<{ contentDigest: string; contentBase64: string }> } {
  const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
  const attestationContent = new TextEncoder().encode('{"signed":true}');
  const evidenceDigest = `sha256:${createHash('sha256').update(evidenceContent).digest('hex')}`;
  const attestationDigest = `sha256:${createHash('sha256').update(attestationContent).digest('hex')}`;

  const principalDigest = branded<Digest>(`sha256:${'a1'.repeat(32)}`);
  const sessionDigest = branded<Digest>(`sha256:${'b2'.repeat(32)}`);

  const evidenceRef = buildEvidenceRef({
    content: evidenceContent,
    mediaType: 'application/json',
    observationKind: 'completion-evidence',
    producer: {
      id: 'e2e-producer',
      version: '1',
      identityDigest: principalDigest,
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId,
      runId: branded(runId),
      actionId: branded(actionId),
      schema: 'evidence/1',
    },
  });
  const attestationRef = buildEvidenceRef({
    content: attestationContent,
    mediaType: 'application/json',
    observationKind: 'actor-attestation',
    producer: {
      id: 'e2e-actor',
      version: '1',
      identityDigest: sessionDigest,
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId,
      runId: branded(runId),
      actionId: branded(actionId),
      schema: 'attestation/1',
    },
  });

  const actor = buildAgentActor({
    role: 'implementer',
    provider: 'anthropic',
    runtime: 'claude',
    principalIdentityDigest: principalDigest,
    sessionIdentityDigest: sessionDigest,
    adapter: {
      id: 'adapter:e2e',
      version: '1',
      artifactDigest: sessionDigest,
    },
  });

  const base = {
    format: 'change-run-completion/1',
    kind: 'domain-action-result',
    change: { projectRoot, changeId },
    runId,
    actionId,
    invocationId,
    actor,
    actorAttestation: attestationRef,
    evidence: [evidenceRef],
    status: 'succeeded',
    result: result ?? { ok: true },
  };
  const receiptDigest = computeCompletionReceiptDigest(base as never);

  return {
    completion: { ...base, receiptDigest },
    uploads: [
      { contentDigest: evidenceDigest, contentBase64: Buffer.from(evidenceContent).toString('base64') },
      { contentDigest: attestationDigest, contentBase64: Buffer.from(attestationContent).toString('base64') },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared setup: drive a bug-fix Run through propose + apply + verify(complex)
// ---------------------------------------------------------------------------

interface DrivenRun {
  runId: string;
  expectedVersion: number;
  verifyActionId: string;
  verifyInvocationId: string;
}

/**
 * Drive a bug-fix Run from launch through the verify stage, completing verify
 * with a complex route. Returns the runId and verify action identifiers so
 * each test can assert on the suspended state and exercise terminal controls.
 */
async function driveToComplexVerify(
  testDir: string,
  dataDir: string,
  storeRoot: string,
  changeId: string
): Promise<DrivenRun> {
  const env = { XDG_DATA_HOME: dataDir };

  // ---- LAUNCH ----
  const startResult = await runCLI(
    ['pipeline', 'start', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  expect(startResult.exitCode).toBe(0);
  const startJson = JSON.parse(startResult.stdout.trim());
  expect(startJson.disposition).toBe('created');
  expect(startJson.actions).toEqual([]);
  const runId = startJson.runId as string;

  const plan = await buildBugFixPlan(testDir, runId);

  // ---- PROPOSE: gate → decide → resume(grant) → observe → complete ----
  // The facade's start settles and commits the propose gate wait; no
  // in-process commitGateWaits call is needed.

  let status = await runCLI(
    ['pipeline', 'status', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  let statusJson = JSON.parse(status.stdout.trim());
  let root = statusJson.view.sections[0];
  let waitId = root.waits[0].waitId;
  let expectedVersion = statusJson.view.recordVersion;

  let controlBody = {
    control: {
      format: 'change-run-control/1',
      ref: { change: { projectRoot: testDir, changeId }, runId },
      expectedRecordVersion: expectedVersion,
      command: { kind: 'decision', waitId, decisionId: 'approve', outcome: 'approve' },
    },
  };
  let controlFile = path.join(testDir, 'control-propose.json');
  writeFileSync(controlFile, JSON.stringify(controlBody));
  await runCLI(
    ['pipeline', 'control', changeId, '--run', runId, '--from', controlFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  await runCLI(
    ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  observeAdmittedEffects(storeRoot, runId);

  // Find the propose action (the only active action at this point) and complete it.
  let record = loadHeadRecord(storeRoot, runId);
  let proposeAction = Object.values(record.actions).find(
    (a) => a.state === 'active'
  )!;
  const proposeCompletion = buildCompletionBody(
    record, runId, changeId, testDir,
    proposeAction.action.actionId, proposeAction.action.invocationId
  );
  let completionFile = path.join(testDir, 'complete-propose.json');
  writeFileSync(completionFile, JSON.stringify(proposeCompletion));
  await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  // ---- APPLY: gate → decide → resume(grant) → observe → complete ----
  // After propose completes, the apply gate becomes pending. The facade's
  // complete does NOT settle (known limitation: complete commits only the
  // commit-action-result stimulus). A resume-run call settles and commits
  // the apply gate wait through the real CLI path.
  await runCLI(
    ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  status = await runCLI(
    ['pipeline', 'status', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  statusJson = JSON.parse(status.stdout.trim());
  root = statusJson.view.sections[0];
  waitId = root.waits[0].waitId;
  expectedVersion = statusJson.view.recordVersion;

  controlBody = {
    control: {
      format: 'change-run-control/1',
      ref: { change: { projectRoot: testDir, changeId }, runId },
      expectedRecordVersion: expectedVersion,
      command: { kind: 'decision', waitId, decisionId: 'approve', outcome: 'approve' },
    },
  };
  controlFile = path.join(testDir, 'control-apply.json');
  writeFileSync(controlFile, JSON.stringify(controlBody));
  await runCLI(
    ['pipeline', 'control', changeId, '--run', runId, '--from', controlFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  await runCLI(
    ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  observeAdmittedEffects(storeRoot, runId);

  record = loadHeadRecord(storeRoot, runId);
  const applyAction = Object.values(record.actions).find(
    (a) => a.state === 'active'
  )!;
  const applyCompletion = buildCompletionBody(
    record, runId, changeId, testDir,
    applyAction.action.actionId, applyAction.action.invocationId
  );
  completionFile = path.join(testDir, 'complete-apply.json');
  writeFileSync(completionFile, JSON.stringify(applyCompletion));
  await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  // ---- VERIFY: resume(grant) → observe → complete with complex route ----
  // verify has NO gate; once apply succeeded, resume-run grants verify directly.
  const verifyResume = await runCLI(
    ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  const verifyResumeJson = JSON.parse(verifyResume.stdout.trim());
  expect(verifyResumeJson.actions.length).toBe(1);
  expect(verifyResumeJson.actions[0].kind).toBe('agent');

  observeAdmittedEffects(storeRoot, runId);

  record = loadHeadRecord(storeRoot, runId);
  const verifyAction = Object.values(record.actions).find(
    (a) => a.state === 'active'
  )!;
  const verifyActionId = verifyAction.action.actionId;
  const verifyInvocationId = verifyAction.action.invocationId;

  // Complete verify with a COMPLEX route — this triggers the unsupported
  // ReviewCycle suspension.
  const verifyCompletion = buildCompletionBody(
    record, runId, changeId, testDir,
    verifyActionId, verifyInvocationId,
    { route: 'complex' } as JsonValue
  );
  completionFile = path.join(testDir, 'complete-verify-complex.json');
  writeFileSync(completionFile, JSON.stringify(verifyCompletion));
  const verifyCompleteResult = await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  expect(verifyCompleteResult.exitCode).toBe(0);

  return { runId, expectedVersion, verifyActionId, verifyInvocationId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fresh-process complex-route E2E (15.4)', () => {
  const projectRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    testDir = path.join(projectRoot, 'test-pipeline-e2e-complex-tmp');
    dataDir = path.join(testDir, 'global-data');
    storeRoot = storeRootFor(dataDir);
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('suspends durably when adaptive verify reports complex; blocks ship; offers no uncertain resume', async () => {
    const changeId = 'e2e-complex-suspend';
    const env = { XDG_DATA_HOME: dataDir };
    const { runId, verifyActionId } = await driveToComplexVerify(testDir, dataDir, storeRoot, changeId);

    // ---- ASSERT: verify action is closed with complex route ----
    const record = loadHeadRecord(storeRoot, runId);
    const verifyCommitted = record.actions[verifyActionId];
    expect(verifyCommitted).toBeDefined();
    expect(verifyCommitted.deliveryState).toBe('closed');
    expect(verifyCommitted.result?.result).toEqual({ route: 'complex' });

    // ---- ASSERT: no ship action was ever admitted ----
    // After propose + apply + verify, the Record has exactly 3 actions.
    // Ship requires verify to succeed via simple route; with a complex route
    // it is never admitted by the reconciler.
    expect(Object.keys(record.actions).length).toBe(3);

    // ---- QUIESCENT POINT: status via fresh CLI process ----
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.trim());
    const root = statusJson.view.sections[0];

    // No 4th (ship) action in the projected view.
    expect(root.actions.length).toBe(3);

    // Verify is present and closed (found by its known actionId).
    const verifyInView = root.actions.find((a: { actionId: string }) => a.actionId === verifyActionId);
    expect(verifyInView).toBeDefined();
    expect(verifyInView.deliveryState).toBe('closed');

    // ---- ASSERT: pre-resume state — complete does not settle (known
    // limitation: the facade's complete commits only the commit-action-result
    // stimulus without reconciling for downstream waits). No wait is committed
    // yet; the capability-unavailable wait enters the Record on the next
    // resume-run settle.
    // ----
    expect(root.waits).toEqual([]);

    const controlKinds = root.allowedControls.map((c: { kind: string }) => c.kind);
    expect(controlKinds).toContain('escalate');
    expect(controlKinds).toContain('cancel');
    // No decision control — no gate to decide.
    expect(controlKinds).not.toContain('decision');

    // ---- ASSERT: resume-run settles and commits the durable
    // capability-unavailable wait (the facade settle maps the reconciler's
    // suspend-unsupported candidate to a suspend stimulus and commits it).
    // The wait is bound to the already-closed verify action — the reducer
    // allows capability-unavailable on closed actions.
    // ----
    const resumeResult = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resumeResult.exitCode).toBe(0);
    const resumeJson = JSON.parse(resumeResult.stdout.trim());
    // No executable actions granted (ship is blocked by the unsupported route).
    expect(resumeJson.actions).toEqual([]);
    // Disposition is 'waiting' — the wait is now committed.
    expect(resumeJson.disposition).toBe('waiting');

    // ---- ASSERT: the durable capability-unavailable wait IS committed ----
    const suspendedRecord = loadHeadRecord(storeRoot, runId);
    const capWait = suspendedRecord.waits.find((w) => w.kind === 'capability-unavailable');
    expect(capWait).toBeDefined();
    expect(capWait.code).toBe('review_cycle_capability_unavailable');
    // The wait is bound to the verify action.
    expect(capWait.actionId).toBe(verifyActionId);

    // ---- ASSERT: the Run reaches stable suspended-unsupported status ----
    // (not 'running'-stuck). The reconciler sees the capability-unavailable
    // wait and classifies the verify node as suspended-unsupported — it does
    // NOT re-emit suspend-unsupported because the wait already exists.
    const suspendedPlan = await buildBugFixPlan(testDir, runId);
    const suspendedRerun = reconcile(suspendedPlan, suspendedRecord);
    expect(suspendedRerun.ok).toBe(true);
    if (suspendedRerun.ok) {
      expect(
        suspendedRerun.actions.some((a) => a.kind === 'suspend-unsupported')
      ).toBe(false);
    }

    // ---- ASSERT: the Run remains non-terminal (durable suspension) ----
    expect(suspendedRecord.terminal).toBeUndefined();
    expect(resumeJson.status).not.toBe('escalated');
    expect(resumeJson.status).not.toBe('cancelled');

    // ---- CROSS-PROCESS DURABILITY: a completely fresh status call sees the
    // suspended state (verify closed, no ship, capability-unavailable wait
    // committed, no terminal).
    // ----
    const status2Result = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(status2Result.exitCode).toBe(0);
    const status2Json = JSON.parse(status2Result.stdout.trim());
    const root2 = status2Json.view.sections[0];
    // Still exactly 3 actions — no ship admitted across processes.
    expect(root2.actions.length).toBe(3);
    // The durable wait survives across processes.
    expect(root2.waits.length).toBe(1);
    expect(root2.waits[0].kind).toBe('capability-unavailable');
    // Resume control is now available (capability-unavailable is resumable).
    const controlKinds2 = root2.allowedControls.map((c: { kind: string }) => c.kind);
    expect(controlKinds2).toContain('resume');
    expect(controlKinds2).toContain('escalate');
    expect(controlKinds2).toContain('cancel');
    expect(status2Json.view.terminal).toBeUndefined();
  }, 600_000); // 10-minute timeout for multi-spawn E2E

  it('escalates safely from the unsupported complex-route suspension', async () => {
    const changeId = 'e2e-complex-escalate';
    const env = { XDG_DATA_HOME: dataDir };
    const { runId } = await driveToComplexVerify(testDir, dataDir, storeRoot, changeId);

    // Status to get the expected version + allowed controls.
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    const statusJson = JSON.parse(statusResult.stdout.trim());
    const expectedVersion = statusJson.view.recordVersion;

    // Escalate via CLI control.
    const controlBody = {
      control: {
        format: 'change-run-control/1',
        ref: { change: { projectRoot: testDir, changeId }, runId },
        expectedRecordVersion: expectedVersion,
        command: { kind: 'escalate', reason: 'complex route unsupported' },
      },
    };
    const controlFile = path.join(testDir, 'control-escalate.json');
    writeFileSync(controlFile, JSON.stringify(controlBody));
    const controlResult = await runCLI(
      ['pipeline', 'control', changeId, '--run', runId, '--from', controlFile, '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(controlResult.exitCode).toBe(0);

    // The Run is now terminal (escalated).
    const finalStatus = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    const finalJson = JSON.parse(finalStatus.stdout.trim());
    const finalRoot = finalJson.view.sections[0];
    expect(finalRoot.terminal).toBeDefined();
    expect(finalRoot.terminal.kind).toBe('escalated');

    // No ship action was ever admitted — check the on-disk Record (terminal
    // views hide all actions, so the count must come from the store).
    const finalRecord = loadHeadRecord(storeRoot, runId);
    expect(Object.keys(finalRecord.actions).length).toBe(3);

    // A terminal Run has no allowed controls.
    const root = finalJson.view.sections[0];
    expect(root.allowedControls).toEqual([]);
  }, 600_000);

  it('cancels safely from the unsupported complex-route suspension', async () => {
    const changeId = 'e2e-complex-cancel';
    const env = { XDG_DATA_HOME: dataDir };
    const { runId } = await driveToComplexVerify(testDir, dataDir, storeRoot, changeId);

    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    const statusJson = JSON.parse(statusResult.stdout.trim());
    const expectedVersion = statusJson.view.recordVersion;

    const controlBody = {
      control: {
        format: 'change-run-control/1',
        ref: { change: { projectRoot: testDir, changeId }, runId },
        expectedRecordVersion: expectedVersion,
        command: { kind: 'cancel' },
      },
    };
    const controlFile = path.join(testDir, 'control-cancel.json');
    writeFileSync(controlFile, JSON.stringify(controlBody));
    const controlResult = await runCLI(
      ['pipeline', 'control', changeId, '--run', runId, '--from', controlFile, '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(controlResult.exitCode).toBe(0);

    const finalStatus = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    const finalJson = JSON.parse(finalStatus.stdout.trim());
    const finalRoot = finalJson.view.sections[0];
    expect(finalRoot.terminal).toBeDefined();
    expect(finalRoot.terminal.kind).toBe('cancelled');

    // No ship action was ever admitted — check the on-disk Record.
    const finalRecord = loadHeadRecord(storeRoot, runId);
    expect(Object.keys(finalRecord.actions).length).toBe(3);

    const root = finalJson.view.sections[0];
    expect(root.allowedControls).toEqual([]);
  }, 600_000);
});
