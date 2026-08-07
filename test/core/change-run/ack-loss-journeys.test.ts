/**
 * ACK-loss journeys (task 15.5 of `ecp-run-spine`).
 *
 * Proves the delivery-state and recovery contract for three Action classes
 * under launch / completion / downstream-admission ACK loss:
 *
 *  (a) deferred-undelivered — action admitted via defer (browser/management
 *      path). Browser replay grants empty; the trusted CLI first-claim
 *      atomically transitions admitted_undelivered → granted. Pre-grant loss
 *      does NOT invoke recovery.
 *
 *  (b) granted-executed — action granted via CLI, effects observed, result
 *      committed. The Record is the source of truth; a fresh read shows the
 *      action closed even if the completion response was lost. Downstream
 *      admission proceeds from committed Record truth.
 *
 *  (c) granted-never-executed — action granted but execution/observation
 *      lost. Post-grant loss invokes typed recovery: the action is suspended
 *      with an uncertain-effect wait. Uncertain-effect waits are NOT
 *      human-resumable (no ordinary resume control).
 *
 * The recovery semantics are exercised facade/reducer-level (in-process). One
 * fresh-process CLI spawn proves the trusted first-claim path.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  bugFixPlan,
  startRecord,
  agentAction,
  gateWait,
  evidenceFor,
  fixtureDigests,
  nodeIdFor,
} from './reconciler-fixture.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createCanonicalWait } from '../../../src/core/change-run/internal/waits.js';
import { reconcile } from '../../../src/core/change-run/internal/reconciler.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { decodeCanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RunStimulus, RunReductionResult } from '../../../src/core/change-run/internal/reducer.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { JsonValue } from '../../../src/core/change-run/index.js';

import { runCLI } from '../../helpers/run-cli.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';
import { resolveRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { deriveInvocationId } from '../../../src/core/change-run/internal/identity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROPOSE = 'root/propose';

/** Apply a stimulus, throwing on failure (test-only convenience). */
function apply(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  stimulus: RunStimulus
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(
      `fixture reducer failed (${result.failure.code}): ${result.failure.message}`
    );
  }
  return result.record;
}

/** Apply a stimulus that may fail, returning the full result. */
function tryApply(
  record: CanonicalRunRecord,
  stimulus: RunStimulus
): RunReductionResult {
  return reduceCanonicalRunRecord(record, stimulus);
}

/** Resolve a node to its gate-processed state (await + decide approve). */
function gateDecided(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  nodePath: string
): CanonicalRunRecord {
  const wait = gateWait(plan, nodePath);
  let next = apply(plan, record, { kind: 'await-gate', wait });
  next = apply(plan, next, {
    kind: 'decide-gate',
    waitId: wait.waitId,
    decisionId: 'approve',
    outcome: 'approve',
  });
  return next;
}

// ---------------------------------------------------------------------------
// In-process ACK-loss journeys
// ---------------------------------------------------------------------------

describe('ACK-loss journeys — in-process delivery-state transitions (15.5)', () => {

  describe('(a) deferred-undelivered: pre-grant ACK loss', () => {
    it('admit-defer leaves the action admitted_undelivered and active', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'defer',
      });

      const committed = record.actions[action.actionId];
      expect(committed).toBeDefined();
      expect(committed.deliveryState).toBe('admitted_undelivered');
      expect(committed.state).toBe('active');

      // No ActionGranted transition exists — the action was admitted but NOT
      // granted. This is the browser/management path: the receipt would carry
      // actions: [] (no executable grant).
      const granted = record.transitions.some(
        (t) => t.kind === 'ActionGranted' && t.actionId === action.actionId
      );
      expect(granted).toBe(false);
    });

    it('trusted first-claim (grant-action) atomically transitions to granted in one revision', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'defer',
      });

      const versionBeforeGrant = record.recordVersion;

      // First-claim: grant the undelivered action.
      record = apply(plan, record, {
        kind: 'grant-action',
        actionId: action.actionId,
      });

      // Exactly one revision was committed (atomic transition).
      expect(record.recordVersion).toBe(versionBeforeGrant + 1);

      const committed = record.actions[action.actionId];
      expect(committed.deliveryState).toBe('granted');
      expect(committed.state).toBe('active');

      // Exactly one ActionGranted transition in this revision.
      const granted = record.transitions.filter(
        (t) => t.kind === 'ActionGranted' && t.actionId === action.actionId
      );
      expect(granted.length).toBe(1);
    });

    it('replay grant on an already-granted action fails (not idempotent — first claim is unique)', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'defer',
      });
      record = apply(plan, record, {
        kind: 'grant-action',
        actionId: action.actionId,
      });

      // A second grant attempt fails: the action is no longer
      // admitted_undelivered (it is granted).
      const replay = tryApply(record, {
        kind: 'grant-action',
        actionId: action.actionId,
      });
      expect(replay.ok).toBe(false);
      if (!replay.ok) {
        expect(replay.failure.code).toBe('action_not_active');
      }
    });

    it('pre-grant loss does NOT invoke recovery — no wait is created', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'defer',
      });

      // No waits exist — the action is simply undelivered, not suspended.
      expect(record.waits).toEqual([]);
      expect(record.terminal).toBeUndefined();

      // The action can still be granted later (no recovery needed).
      record = apply(plan, record, {
        kind: 'grant-action',
        actionId: action.actionId,
      });
      expect(record.actions[action.actionId].deliveryState).toBe('granted');
    });
  });

  describe('(b) granted-executed: completion ACK loss', () => {
    it('completion is committed to the Record even if the response is lost', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });

      // Observe the workspace effect (required before a successful result).
      record = apply(plan, record, {
        kind: 'observe-effect',
        actionId: action.actionId,
        effectId: action.effects[0]!.effectId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, action.actionId),
      });

      // Commit the result — the "response" is conceptual: the Record IS the
      // source of truth. A fresh read (simulating a new process) sees the
      // same committed state.
      record = apply(plan, record, {
        kind: 'commit-action-result',
        actionId: action.actionId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, action.actionId),
      });

      // Simulate a fresh-process read: re-decode the Record from its JSON form.
      const reDecoded = decodeCanonicalRunRecord(JSON.parse(JSON.stringify(record)));
      const committed = reDecoded.actions[action.actionId];
      expect(committed.deliveryState).toBe('closed');
      expect(committed.state).toBe('closed');
      expect(committed.result).toBeDefined();
      expect(committed.result!.status).toBe('succeeded');
    });

    it('downstream admission proceeds from committed Record truth after completion', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);

      // Succeed the propose node fully (gate + admit + grant + observe + complete).
      record = gateDecided(plan, record, PROPOSE);
      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });
      record = apply(plan, record, {
        kind: 'observe-effect',
        actionId: action.actionId,
        effectId: action.effects[0]!.effectId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        observation: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, action.actionId),
      });
      record = apply(plan, record, {
        kind: 'commit-action-result',
        actionId: action.actionId,
        status: 'succeeded',
        receiptDigest: fixtureDigests.receiptDigest,
        result: { ok: true } as JsonValue,
        evidence: evidenceFor(plan, action.actionId),
      });

      // The reconciler now sees propose as succeeded and identifies the apply
      // gate as the next candidate. This proves downstream admission is driven
      // by committed Record truth, not by any transient response.
      const result = reconcile(plan, record);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const applyCandidate = result.actions.find(
        (a) => a.kind === 'await-gate' && a.nodeId === nodeIdFor(plan, 'root/apply')
      );
      expect(applyCandidate).toBeDefined();
    });
  });

  describe('(c) granted-never-executed: post-grant loss → typed recovery', () => {
    it('post-grant loss suspends with uncertain-effect wait (typed recovery)', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      // Admit + grant — the action is now granted but effects are unobserved.
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });

      // Simulate post-grant loss: the action was granted but never executed.
      // Effects remain in 'admitted' state (never observed). The trusted
      // system cannot know whether the action ran. Recovery: suspend with an
      // uncertain-effect wait.
      const wait = createCanonicalWait(plan.runId, {
        kind: 'uncertain-effect',
        nodeId: action.nodeId,
        invocationId: action.invocationId,
        occurrence: 0,
        attemptId: action.attemptId,
        actionId: action.actionId,
        effectIds: [action.effects[0]!.effectId],
      });
      record = apply(plan, record, { kind: 'suspend', wait });

      // The action is blocked, deliveryState closed, effects uncertain.
      const committed = record.actions[action.actionId];
      expect(committed.state).toBe('blocked');
      expect(committed.deliveryState).toBe('closed');
      expect(committed.effects[0]!.state).toBe('uncertain');

      // An uncertain-effect wait exists.
      const uncertainWait = record.waits.find((w) => w.kind === 'uncertain-effect');
      expect(uncertainWait).toBeDefined();
    });

    it('uncertain-effect wait offers NO resume control (not human-resumable)', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });

      const wait = createCanonicalWait(plan.runId, {
        kind: 'uncertain-effect',
        nodeId: action.nodeId,
        invocationId: action.invocationId,
        occurrence: 0,
        attemptId: action.attemptId,
        actionId: action.actionId,
        effectIds: [action.effects[0]!.effectId],
      });
      record = apply(plan, record, { kind: 'suspend', wait });

      // Project the view and check allowed controls.
      const view = projectRunView(record);
      const root = view.sections[0] as Extract<(typeof view.sections)[number], { kind: 'root-dag' }>;
      const controlKinds = root.allowedControls.map((c: { kind: string }) => c.kind);

      // Escalate and cancel are always available on a non-terminal Run.
      expect(controlKinds).toContain('escalate');
      expect(controlKinds).toContain('cancel');
      // Uncertain-effect waits do NOT offer a resume control.
      expect(controlKinds).not.toContain('resume');
    });

    it('resume-wait on uncertain-effect fails with control_not_allowed', () => {
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'grant',
      });

      const wait = createCanonicalWait(plan.runId, {
        kind: 'uncertain-effect',
        nodeId: action.nodeId,
        invocationId: action.invocationId,
        occurrence: 0,
        attemptId: action.attemptId,
        actionId: action.actionId,
        effectIds: [action.effects[0]!.effectId],
      });
      record = apply(plan, record, { kind: 'suspend', wait });

      // Attempting an ordinary resume on an uncertain-effect wait fails.
      const result = tryApply(record, {
        kind: 'resume-wait',
        waitId: wait.waitId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('control_not_allowed');
      }
    });

    it('deferred-undelivered loss is safe — no recovery wait, no uncertain effects', () => {
      // Contrast: an admitted_undelivered action that loses its response is
      // fundamentally safe. The action has NO granted effects, so there is
      // nothing to be uncertain about. It can be granted later.
      const plan = bugFixPlan();
      let record = startRecord(plan);
      record = gateDecided(plan, record, PROPOSE);

      const action = agentAction(plan, PROPOSE);
      record = apply(plan, record, {
        kind: 'admit-action',
        action,
        attemptOrdinal: 0,
        deliveryMode: 'defer',
      });

      const committed = record.actions[action.actionId];
      // Effects are admitted (pre-execution) — NOT uncertain.
      expect(committed.effects[0]!.state).toBe('admitted');
      // No waits — no recovery invoked.
      expect(record.waits).toEqual([]);
      // The action is not terminal-blocked; it can be granted.
      expect(committed.state).toBe('active');
    });
  });
});

// ---------------------------------------------------------------------------
// Fresh-process CLI: trusted first-claim via resume-run
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;

function storeRootFor(xdgDataHome: string): string {
  return path.join(xdgDataHome, 'rasen', 'runs');
}

function loadHeadRecord(storeRoot: string, runId: string) {
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
): void {
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
}

async function buildBugFixPlan(projectRoot: string, runId: string) {
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, { reporter: false });
  // Use registry.load() instead of selectForExecution() because bug-fix's
  // normalized form now routes through the reconciler (ReviewCycle BoundedLoop),
  // which selectForExecution's preflight rejects as non-legacy.
  const resolution = registry.load('bug-fix');
  const prepared = resolution.prepared;
  const pipeline = prepared.authoredSource as {
    name: string;
    stages: Array<{ id: string; role?: string; model?: string; gate?: boolean; verifyPolicy?: string }>;
  };
  const sourceRevision = {
    layer: resolution.source,
    kind: 'pipeline-yaml' as const,
    sourceId: `${resolution.source}:${pipeline.name}`,
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
      role: 'stage', model: stage.model ? 'stage' : 'default', effort: 'default',
      runtime: 'host', sandbox: 'default', gate: 'stage', sessionReuse: 'default',
      handoffTokenLimit: 'default', reuseRoundLimit: 'default',
    },
  }));
  const profile = resolveRuntimeExecutionProfile(
    prepared, registry.catalog, policyStages, sourceRevision,
    { maxAttempts: 3, maxActions: 64 }
  );
  return lowerRuntimePlan(prepared, profile, branded(runId));
}

function commitGateWaits(
  storeRoot: string,
  plan: Awaited<ReturnType<typeof buildBugFixPlan>>,
  runId: string
): void {
  const record = loadHeadRecord(storeRoot, runId);
  const reconciled = reconcile(plan, record);
  if (!reconciled.ok) {
    throw new Error(
      `reconcile failed: ${reconciled.failure.message}\n` +
      JSON.stringify({
        plan: {
          planDigest: plan.planDigest,
          sourceRevisionDigest: plan.sourceRevisionDigest,
          capabilityDigest: plan.capabilityDigest,
          policyDigest: plan.policyDigest,
          executionProfileDigest: plan.profileDigest,
        },
        record: {
          planDigest: record.planDigest,
          sourceRevisionDigest: record.sourceRevisionDigest,
          capabilityDigest: record.capabilityDigest,
          policyDigest: record.policyDigest,
          executionProfileDigest: record.executionProfileDigest,
        },
      })
    );
  }
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

describe('trusted first-claim via fresh-process CLI (15.5)', () => {
  const projectRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    testDir = path.join(projectRoot, 'test-pipeline-e2e-ackloss-tmp');
    dataDir = path.join(testDir, 'global-data');
    storeRoot = storeRootFor(dataDir);
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('freezes the host-aware execution runtime into reconciler Actions', async () => {
    const changeId = 'e2e-host-aware-runtime';
    await fs.mkdir(path.join(testDir, 'rasen', 'changes', changeId), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(testDir, 'rasen', 'config.yaml'),
      ['schema: spec-driven', 'autopilot:', '  gates: off', ''].join('\n')
    );
    const result = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      {
        cwd: testDir,
        env: {
          XDG_DATA_HOME: dataDir,
          RASEN_AGENT_RUNTIME: 'claude',
        },
        timeoutMs: 60_000,
      }
    );
    expect(result.exitCode).toBe(0);

    const runId = JSON.parse(result.stdout.trim()).runId as string;
    const record = loadHeadRecord(storeRoot, runId);
    const admitted = Object.values(record.actions);
    expect(admitted).toHaveLength(1);
    expect(admitted[0]!.action.kind).toBe('agent');
    if (admitted[0]!.action.kind !== 'agent') {
      throw new Error('Expected the first bug-fix Action to be an agent Action.');
    }
    expect(admitted[0]!.action.agent.runtime).toBe('claude');
  });

  it('resume-run atomically grants the ready frontier; replay grants empty', async () => {
    const changeId = 'e2e-ackloss-firstclaim';
    // The in-process plan fixture below intentionally freezes Codex; pin the
    // CLI host to the same runtime so the test is independent of ambient CI.
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

    // ---- LAUNCH ----
    const startResult = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(startResult.exitCode).toBe(0);
    const startJson = JSON.parse(startResult.stdout.trim());
    expect(startJson.actions).toEqual([]); // propose is gated, nothing granted at start.
    const runId = startJson.runId as string;

    // ---- KERNEL-INTERNAL: decide the propose gate wait ----
    // pipeline start already committed the gate wait via the facade's settle
    // (design §5.6). We only need to decide it so resume-run can admit.
    const record = loadHeadRecord(storeRoot, runId);
    const wait = record.waits.find((w) => w.kind === 'gate')!;
    applyStimulusToStore(storeRoot, runId, {
      kind: 'decide-gate',
      waitId: wait.waitId,
      decisionId: 'approved',
      outcome: 'approved',
    });

    // ---- FIRST-CLAIM: resume-run grants the propose action ----
    const versionBefore = loadHeadRecord(storeRoot, runId).recordVersion;
    const resumeResult = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(resumeResult.exitCode).toBe(0);
    const resumeJson = JSON.parse(resumeResult.stdout.trim());
    expect(resumeJson.disposition).toBe('advanced');
    expect(resumeJson.actions.length).toBe(1);
    expect(resumeJson.actions[0].kind).toBe('agent');

    // The Record advanced by exactly one revision (atomic admit+grant).
    const versionAfter = loadHeadRecord(storeRoot, runId).recordVersion;
    expect(versionAfter).toBe(versionBefore + 1);

    // ---- STATUS: action is granted ----
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(statusResult.exitCode).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.trim());
    const root = statusJson.view.sections[0];
    const grantedActionId = resumeJson.actions[0].actionId;
    const proposeAction = root.actions.find((a: { actionId: string }) => a.actionId === grantedActionId);
    expect(proposeAction).toBeDefined();
    expect(proposeAction.deliveryState).toBe('granted');

    // ---- REPLAY: a second resume-run grants nothing (already granted) ----
    const replayResult = await runCLI(
      ['pipeline', 'resume-run', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(replayResult.exitCode).toBe(0);
    const replayJson = JSON.parse(replayResult.stdout.trim());
    // No new actions — the propose action is already granted (active).
    // The disposition is 'waiting' because the action is active but not
    // completed (the reconciler sees no new admit candidates).
    expect(replayJson.actions).toEqual([]);

    // No additional Record revision was committed by the replay.
    const versionAfterReplay = loadHeadRecord(storeRoot, runId).recordVersion;
    expect(versionAfterReplay).toBe(versionAfter);
  }, 300_000); // 5-minute timeout
});
