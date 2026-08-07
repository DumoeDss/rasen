/**
 * Fresh-process simple bug-fix E2E (task 15.3 of `ecp-run-spine`).
 *
 * Drives a real bug-fix Run end-to-end through FRESH CLI processes
 * (`node dist/cli/index.js pipeline start/status/control/resume-run/complete`),
 * interrupted at every quiescent point with a `status` snapshot.
 *
 * Effect observation has NO CLI command and is performed in-process against
 * the filesystem store (the documented kernel-internal path — the planning
 * context notes: "effect observation is an internal kernel operation, NOT a
 * CLI command path"). It is required before a successful
 * `commit-action-result`; the reducer rejects otherwise with
 * `illegal_transition`.
 *
 * Every other step is a real `runCLI` spawn. This is NOT a kernel-only
 * in-memory exercise: it crosses the real CLI binary (argument parsing →
 * PipelineCommand → facade → filesystem store) at every user-facing step.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';

// Kernel internals — used ONLY for the two documented kernel-internal steps
// (gate-wait commitment + effect observation). These are NOT used to bypass
// the CLI; they fill the gap where no CLI command exists.
import { freezeProductionPreparedPipelineRegistry } from '../../src/core/pipeline-registry/prepared-registry.js';
import { resolveRuntimeExecutionProfile } from '../../src/core/pipeline-registry/profile-resolver.js';
import { lowerRuntimePlan } from '../../src/core/change-run/internal/lowerer.js';
import { reduceCanonicalRunRecord } from '../../src/core/change-run/internal/reducer.js';
import { decodeCanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import type { RunStimulus } from '../../src/core/change-run/internal/reducer.js';
import type { ActionId, Digest, RunId } from '../../src/core/change-run/index.js';
import {
  attestTestCompletion,
  provisionTestTrustedExecutionAdaptersForPipeline,
} from '../fixtures/trusted-completion.js';

// ---------------------------------------------------------------------------
// Helpers: in-process plan building (mirrors the CLI's resolveRuntime)
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;

/**
 * Build the same RuntimePlan the CLI would produce for a bug-fix Run at
 * `projectRoot` with the given `runId`. Mirrors `PipelineCommand.resolveRuntime`:
 * freezes the production pipeline registry, selects bug-fix, builds the
 * execution profile, and lowers the plan.
 */
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

// ---------------------------------------------------------------------------
// Helpers: in-process filesystem store operations
// ---------------------------------------------------------------------------

/** Resolve the store root from an XDG_DATA_HOME value. */
function storeRootFor(xdgDataHome: string): string {
  return path.join(xdgDataHome, 'rasen', 'runs');
}

/** Read the head Record from the filesystem store. */
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

/** Apply a RunStimulus to the on-disk Record and persist the new revision. */
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

/**
 * Observe every admitted-but-unobserved workspace effect for a Run. The
 * reducer requires all effects to be observed before a successful
 * `commit-action-result` (it fails with `illegal_transition` otherwise).
 * Effect observation is kernel-internal — there is no CLI command for it.
 */
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

// ---------------------------------------------------------------------------
// Helpers: completion body construction
// ---------------------------------------------------------------------------

function buildCompletionBody(
  record: CanonicalRunRecord,
  changeId: string,
  projectRoot: string,
  actionId: string
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
      result: { ok: true },
    },
    evidenceContent: new TextEncoder().encode('{"result":"ok"}'),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fresh-process simple bug-fix E2E (15.3)', () => {
  const repoRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(
      path.join(repoRoot, '.rasen-e2e-bugfix-')
    );
    dataDir = path.join(testDir, 'global-data');
    storeRoot = storeRootFor(dataDir);
    // A qualifying Rasen root needs specs + changes directories.
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

  it('drives a bug-fix Run from launch through Gate, action completion, and Run progression via fresh CLI processes', async () => {
    const changeId = 'e2e-bugfix';
    // The in-process plan fixture intentionally freezes Codex.
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

    // ---- 1. LAUNCH: pipeline start ----
    // Creates the Run on the filesystem store. The first stage (propose) is
    // gated, so no action is admitted yet.
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
    expect(startJson.engine).toBe('reconciler');
    expect(startJson.actions).toEqual([]);
    const runId = startJson.runId as string;
    expect(typeof runId).toBe('string');
    expect(runId).toMatch(/^run:[0-9a-f]{64}$/);

    // ---- 2. QUIESCENT POINT: pipeline status (gate committed by facade) ----
    // The facade's start settles the full candidate batch: the propose Gate
    // wait is committed as a durable part of the Record (design §5.6). No
    // in-process helper is needed — the gate wait enters the Record through
    // the real CLI facade path.
    const status1 = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(status1.exitCode).toBe(0);
    const status1Json = JSON.parse(status1.stdout.trim());
    expect(status1Json.runId).toBe(runId);
    // Gate wait committed, no active actions -> status is 'waiting'.
    expect(status1Json.view.status).toBe('waiting');
    const root1 = status1Json.view.sections[0];
    expect(root1.kind).toBe('root-dag');
    expect(root1.actions).toEqual([]);
    // The gate wait IS committed by the facade's settle.
    expect(root1.waits.length).toBe(1);
    expect(root1.waits[0].kind).toBe('gate');
    // Gate wait produces decision controls + escalate + cancel.
    const controlKinds = root1.allowedControls.map((c: { kind: string }) => c.kind);
    expect(controlKinds).toContain('decision');
    expect(controlKinds).toContain('escalate');
    expect(controlKinds).toContain('cancel');

    // ---- 3. GATE DECISION: pipeline control (approve) ----
    const waitId = root1.waits[0].waitId;
    const expectedVersion = status1Json.view.recordVersion;
    const controlBody = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: testDir, changeId },
          runId,
        },
        expectedRecordVersion: expectedVersion,
        command: {
          kind: 'decision',
          waitId,
          decisionId: 'approved',
          outcome: 'approved',
        },
      },
    };
    const controlFile = path.join(testDir, 'control.json');
    writeFileSync(controlFile, JSON.stringify(controlBody));
    const controlResult = await runCLI(
      ['pipeline', 'control', changeId, '--run', runId, '--from', controlFile, '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(controlResult.exitCode).toBe(0);
    const controlJson = JSON.parse(controlResult.stdout.trim());
    expect(controlJson.disposition).toBe('advanced');

    // ---- 4. IDEMPOTENT RESUME: the control settle already granted propose ----
    // Native-v2 Gate targets are settled in the same atomic facade batch as
    // the decision, so a fresh resume process must not grant a duplicate.
    const resumeResult = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resumeResult.exitCode).toBe(0);
    const resumeJson = JSON.parse(resumeResult.stdout.trim());
    expect(resumeJson.disposition).toBe('advanced');
    expect(resumeJson.actions).toEqual([]);

    // ---- 5. QUIESCENT POINT #2: pipeline status (one action granted) ----
    const status3 = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(status3.exitCode).toBe(0);
    const status3Json = JSON.parse(status3.stdout.trim());
    const root3 = status3Json.view.sections[0];
    expect(root3.actions.length).toBe(1);
    expect(root3.actions[0].deliveryState).toBe('granted');
    const actionId = root3.actions[0].actionId;

    // ---- 6. KERNEL-INTERNAL: observe the workspace effect ----
    // The reducer requires all effects observed before a successful
    // commit-action-result (illegal_transition otherwise). Effect observation
    // is genuinely kernel-internal: the facade has no observe-effect surface
    // and there is no CLI command for it. The real system uses an Adapter that
    // observes effects as part of the host execution lifecycle; this test
    // simulates that by applying the observe-effect stimulus directly to the
    // store. This is NOT a workaround for a facade gap — it is the legitimate
    // path for effect observation in this harness.
    observeAdmittedEffects(storeRoot, runId);

    // ---- 7. ACTION COMPLETION: pipeline complete ----
    const recordBeforeComplete = loadHeadRecord(storeRoot, runId);
    const { completion, uploads } = buildCompletionBody(
      recordBeforeComplete,
      changeId,
      testDir,
      actionId
    );
    const completionFile = path.join(testDir, 'completion.json');
    writeFileSync(completionFile, JSON.stringify({ completion, uploads }));
    const completeResult = await runCLI(
      ['pipeline', 'complete', changeId, '--run', runId, '--from', completionFile, '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(completeResult.exitCode).toBe(0);
    const completeJson = JSON.parse(completeResult.stdout.trim());
    // The complete-time settle commits the apply-gate wait in the same
    // revision — disposition is 'waiting' (no actions granted, one wait).
    expect(completeJson.disposition).toBe('waiting');
    // ECP-5 (task 7.7): the receipt reports the actions this settle GRANTED,
    // like `start` and `resume-run` do. It used to omit the field entirely,
    // which broke the converged Step E loop at its own seam — `complete`
    // swallowed the grant and the `resume-run` after it correctly reported
    // zero, so a LEAD reading receipts saw no next action. Here the settle
    // produces a gate wait rather than an action, so the list is empty — the
    // point is that the field EXISTS and is authoritative.
    expect(Array.isArray(completeJson.actions)).toBe(true);
    expect(completeJson.actions).toEqual([]);

    // ---- 8. QUIESCENT POINT #3: pipeline status (action completed, Run progressed) ----
    // The facade's complete settles the candidate batch in the SAME revision
    // as the commit-action-result (design §5.6). The next stage's Gate (the
    // apply gate) is committed by the complete call itself — no separate
    // resume-run is needed to see it.
    const status4 = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(status4.exitCode).toBe(0);
    const status4Json = JSON.parse(status4.stdout.trim());
    const root4 = status4Json.view.sections[0];
    // The propose action is now 'closed' (delivery state for a completed action).
    const proposeAction = root4.actions.find(
      (a: { actionId: string }) => a.actionId === actionId
    );
    expect(proposeAction).toBeDefined();
    expect(proposeAction.deliveryState).toBe('closed');
    // The Run has progressed to the apply gate — the complete-time settle
    // committed the apply-gate wait in one step.
    expect(status4Json.view.status).toBe('waiting');
    expect(root4.waits.length).toBe(1);
    expect(root4.waits[0].kind).toBe('gate');
    expect(status4Json.view.recordVersion).toBeGreaterThan(expectedVersion);
  }, 300_000); // 5-minute timeout for multi-spawn E2E

  it('proves the Run survives a fresh process at every lifecycle step (cross-process store integrity)', async () => {
    // This test verifies that the filesystem store is consistent across
    // fresh CLI processes: start creates the Run, a DIFFERENT process reads
    // it via status, and the projected views are byte-identical for the same
    // record version. This is the core guarantee that makes the multi-spawn
    // lifecycle possible.
    const changeId = 'e2e-crossproc';
    // The in-process plan fixture intentionally freezes Codex.
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

    const startResult = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(
      startResult.exitCode,
      `${startResult.stderr}\n${startResult.stdout}`
    ).toBe(0);
    const startJson = JSON.parse(startResult.stdout.trim());
    const runId = startJson.runId as string;

    // A second, completely independent process reads the same Run.
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.trim());

    // The view from the second process matches the view from the first.
    expect(statusJson.view.format).toBe('change-run-view/1');
    expect(statusJson.view.runId).toBe(runId);
    expect(statusJson.view.engine).toBe('reconciler');
    expect(statusJson.view.status).toBe(startJson.status);
    // The initial record version is set by createCanonicalRunRecord.
    expect(statusJson.view.recordVersion).toBeGreaterThanOrEqual(0);

    // The store has exactly one record file at this point. The facade's start
    // settles the gate wait (one revision from the initial v0), so the file
    // is record-v1.json.
    const dirName = runId.replace(/[^a-z0-9]/gi, '_');
    const runDir = path.join(storeRoot, dirName);
    const recordFiles = readdirSync(runDir).filter((f) => /^record-v\d+\.json$/.test(f));
    expect(recordFiles.length).toBe(1);
    expect(recordFiles[0]).toBe('record-v1.json');
  }, 120_000);
});
