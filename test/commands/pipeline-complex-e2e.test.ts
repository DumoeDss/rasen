/**
 * Fresh-process ReviewCycle blocking E2E (task 15.4 of `ecp-run-spine`).
 *
 * Proves that a bug-fix Run with an open ReviewCycle finding blocks ship,
 * remains durably non-terminal, and supports safe escalate and cancel paths.
 *
 * Drives a real bug-fix Run through FRESH CLI processes
 * (`node dist/cli/index.js pipeline start/status/resume-run/control`),
 * interrupted at every quiescent point. Effect observation has NO CLI command
 * and is performed in-process against the filesystem store (documented
 * kernel-internal path, same pattern as 15.3).
 *
 * With the D4 migration, bug-fix's verify stage is a ReviewCycle BoundedLoop
 * (not an adaptive atomic verify). After the apply phase completes, the
 * reconciler admits the review-cycle review phase. The test completes the
 * review with a Major finding, which blocks ship (bounded-loop not clean)
 * and admits the triage phase. The Run is durably stuck at triage — only
 * escalate and cancel can move it forward.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
import { buildEvidenceRef } from '../../src/core/change-run/internal/evidence.js';
import type { RuntimePlan } from '../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import type { RunStimulus } from '../../src/core/change-run/internal/reducer.js';
import type { ActionId, Digest, RunId, JsonValue } from '../../src/core/change-run/index.js';
import {
  attestTestCompletion,
  provisionTestTrustedExecutionAdaptersForPipeline,
} from '../fixtures/trusted-completion.js';

// ---------------------------------------------------------------------------
// Helpers (mirror pipeline-bugfix-e2e.test.ts — same documented pattern)
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;

async function buildBugFixPlan(projectRoot: string, runId: string): Promise<RuntimePlan> {
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, { reporter: false });
  const execution = await registry.selectForExecution('bug-fix', { reporter: false });
  const prepared = execution.resolution.prepared;

  const sourceRevision = {
    layer: execution.resolution.source,
    kind: 'pipeline-yaml' as const,
    sourceId: `${execution.resolution.source}:${prepared.definition.name}`,
    authoredContentDigest: branded(`sha256:${prepared.digests.source}`),
    semanticDigest: branded(`sha256:${prepared.digests.source}`),
  };
  const profile = resolveRuntimeExecutionProfile(
    prepared,
    registry.catalog,
    [],
    sourceRevision,
    { maxAttempts: 3, maxActions: 64 },
    undefined,
    registry.trustedExecutionAdapters
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
  changeId: string,
  projectRoot: string,
  actionId: string,
  result?: JsonValue
) {
  const committed = record.actions[actionId as ActionId];
  if (committed === undefined) {
    throw new Error(`No committed action ${actionId} exists in the Run.`);
  }
  return attestTestCompletion({
    change: { projectRoot, changeId },
    record,
    action: committed.action,
    completion: {
      kind: 'domain-action-result',
      status: 'succeeded',
      result: result ?? { ok: true },
    },
    evidenceContent: new TextEncoder().encode('{"result":"ok"}'),
  });
}

// ---------------------------------------------------------------------------
// Shared setup: drive a bug-fix Run through propose + apply + review(findings)
// ---------------------------------------------------------------------------

interface DrivenRun {
  runId: string;
  expectedVersion: number;
  reviewActionId: string;
  reviewInvocationId: string;
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
  // The in-process plan fixture intentionally freezes Codex.
  const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

  // ---- LAUNCH ----
  const startResult = await runCLI(
    ['pipeline', 'start', changeId, 'bug-fix', '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  expect(
    startResult.exitCode,
    `${startResult.stderr}\n${startResult.stdout}`
  ).toBe(0);
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
      command: { kind: 'decision', waitId, decisionId: 'approved', outcome: 'approved' },
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
    record, changeId, testDir,
    proposeAction.action.actionId
  );
  let completionFile = path.join(testDir, 'complete-propose.json');
  writeFileSync(completionFile, JSON.stringify(proposeCompletion));
  await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );

  // ---- APPLY: gate → decide → resume(grant) → observe → complete ----
  // After propose completes, the facade's complete settles and commits the
  // apply gate wait in the SAME revision (design §5.6 — complete, like
  // start/resume/control, settles to the next quiescent point). No separate
  // resume-run is required between the propose completion and the apply
  // gate decision.

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
      command: { kind: 'decision', waitId, decisionId: 'approved', outcome: 'approved' },
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
    record, changeId, testDir,
    applyAction.action.actionId
  );
  completionFile = path.join(testDir, 'complete-apply.json');
  writeFileSync(completionFile, JSON.stringify(applyCompletion));
  const applyCompleteResult = await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  expect(applyCompleteResult.exitCode).toBe(0);
  // ---- REVIEW: the apply-complete settle grants the ReviewCycle review
  // phase in the SAME revision. Once apply succeeds, the reconciler admits
  // the bounded-loop's review phase; the facade builds and grants the review
  // action. The review action is discoverable via the on-disk store.

  observeAdmittedEffects(storeRoot, runId);

  record = loadHeadRecord(storeRoot, runId);
  const reviewAction = Object.values(record.actions).find(
    (a) => a.state === 'active'
  )!;
  const reviewActionId = reviewAction.action.actionId;
  const reviewInvocationId = reviewAction.action.invocationId;

  // Complete the review phase with a Major finding. This blocks ship
  // (bounded-loop not clean) and admits the triage phase in the same settle.
  // Reuse the completion's own evidence content for the finding evidence so
  // the upload validation passes (the CLI only scans top-level evidence refs
  // for upload matching).
  const findingEvidenceRef = buildEvidenceRef({
    content: new TextEncoder().encode('{"result":"ok"}'),
    mediaType: 'application/json',
    observationKind: 'completion-evidence',
    producer: {
      id: 'e2e-producer',
      version: '1',
      identityDigest: branded<Digest>(`sha256:${'a1'.repeat(32)}`),
    },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId,
      changeId,
      runId: branded(runId),
      actionId: branded(reviewActionId),
      schema: 'evidence/1',
    },
  });
  const reviewResult: JsonValue = {
    contract: 'review-cycle/review-result/1',
    outcome: 'findings',
    findings: [
      {
        id: 'F1',
        severity: 'major',
        claim: 'E2E: ship must be blocked while ReviewCycle has open findings',
        evidence: [findingEvidenceRef],
        status: 'open',
      },
    ],
  };
  const reviewCompletion = buildCompletionBody(
    record, changeId, testDir,
    reviewActionId,
    reviewResult
  );
  completionFile = path.join(testDir, 'complete-review-findings.json');
  writeFileSync(completionFile, JSON.stringify(reviewCompletion));
  const reviewCompleteResult = await runCLI(
    ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
    { cwd: testDir, env, timeoutMs: 60_000 }
  );
  expect(reviewCompleteResult.exitCode).toBe(0);

  return { runId, expectedVersion, reviewActionId, reviewInvocationId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fresh-process ReviewCycle blocking E2E (15.4)', () => {
  const repoRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(repoRoot, '.rasen-e2e-complex-')
    );
    dataDir = path.join(testDir, 'global-data');
    storeRoot = storeRootFor(dataDir);
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    await provisionTestTrustedExecutionAdaptersForPipeline(
      testDir,
      path.join(dataDir, 'rasen'),
      'bug-fix'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('blocks ship durably when ReviewCycle reports findings; supports safe escalate and cancel', async () => {
    const changeId = 'e2e-review-block';
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
    const { runId, reviewActionId } = await driveToComplexVerify(testDir, dataDir, storeRoot, changeId);

    // ---- ASSERT: review action is closed with findings result ----
    const record = loadHeadRecord(storeRoot, runId);
    const reviewCommitted = record.actions[reviewActionId];
    expect(reviewCommitted).toBeDefined();
    expect(reviewCommitted.deliveryState).toBe('closed');
    expect(reviewCommitted.result?.result).toMatchObject({
      contract: 'review-cycle/review-result/1',
      outcome: 'findings',
    });

    // ---- ASSERT: no ship action was ever admitted ----
    // After propose + apply + review + triage, the Record has exactly 4
    // actions. Ship requires the bounded-loop to be clean; with open findings
    // it is never admitted by the reconciler.
    expect(Object.keys(record.actions).length).toBe(4);

    // ---- QUIESCENT POINT: status via fresh CLI process ----
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.trim());
    const root = statusJson.view.sections[0];

    // No 5th (ship) action in the projected view.
    expect(root.actions.length).toBe(4);

    // Review is present and closed (found by its known actionId).
    const reviewInView = root.actions.find((a: { actionId: string }) => a.actionId === reviewActionId);
    expect(reviewInView).toBeDefined();
    expect(reviewInView.deliveryState).toBe('closed');

    // ---- ASSERT: no waits — the Run is running (triage active), not suspended
    // ----
    expect(root.waits.length).toBe(0);

    const controlKinds = root.allowedControls.map((c: { kind: string }) => c.kind);
    expect(controlKinds).toContain('escalate');
    expect(controlKinds).toContain('cancel');
    // No decision control — no gate to decide.
    expect(controlKinds).not.toContain('decision');

    // ---- ASSERT: the Run remains non-terminal (durable blocking) ----
    expect(record.terminal).toBeUndefined();
    expect(statusJson.view.status).not.toBe('escalated');
    expect(statusJson.view.status).not.toBe('cancelled');

    // ---- CROSS-PROCESS DURABILITY: a completely fresh status call sees the
    // blocked state (review closed, triage active, no ship, no terminal).
    // ----
    const status2Result = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(status2Result.exitCode).toBe(0);
    const status2Json = JSON.parse(status2Result.stdout.trim());
    const root2 = status2Json.view.sections[0];
    // Still exactly 4 actions — no ship admitted across processes.
    expect(root2.actions.length).toBe(4);
    expect(status2Json.view.terminal).toBeUndefined();
  }, 600_000); // 10-minute timeout for multi-spawn E2E

  it('escalates safely from the ReviewCycle blocking state', async () => {
    const changeId = 'e2e-review-escalate';
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
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
        command: { kind: 'escalate', reason: 'ReviewCycle blocked — escalating' },
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
    expect(Object.keys(finalRecord.actions).length).toBe(4);

    // A terminal Run has no allowed controls.
    const root = finalJson.view.sections[0];
    expect(root.allowedControls).toEqual([]);
  }, 600_000);

  it('cancels safely from the ReviewCycle blocking state', async () => {
    const changeId = 'e2e-review-cancel';
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
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
    expect(Object.keys(finalRecord.actions).length).toBe(4);

    const root = finalJson.view.sections[0];
    expect(root.allowedControls).toEqual([]);
  }, 600_000);
});
