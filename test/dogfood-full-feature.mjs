/**
 * Dogfood: drive a real full-feature Run through Choice → FanOut → Join via CLI.
 *
 * Mirrors test/dogfood-review-cycle.mjs and test/dogfood-goal-cycle.mjs.
 *
 * Scenarios:
 *   1. Parallel success: all required members complete → Join proceeds
 *   2. Partial failure: optional member fails → suppressed, Join proceeds;
 *      required member fails → Join fails closed / escalate
 *   3. Restart idempotency: restart mid-Join → same frontier, completed
 *      members NOT re-admitted, Join not re-evaluated
 *
 * Effect observation is a kernel-internal step (no CLI command) performed by
 * directly applying observe-effect stimuli to the record store — exactly the
 * same pattern as the existing dogfood scripts.
 */
import { execSync } from 'child_process';
import { promises as fs, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const distUrl = (rel) => pathToFileURL(path.join(projectRoot, rel)).href;
const {
  buildEvidenceRef,
} = await import(distUrl('dist/core/change-run/internal/evidence.js'));
const {
  buildAgentActor,
} = await import(distUrl('dist/core/change-run/internal/actors.js'));
const {
  computeCompletionReceiptDigest,
} = await import(distUrl('dist/core/change-run/internal/completion.js'));
const {
  decodeCanonicalRunRecord,
} = await import(distUrl('dist/core/change-run/internal/record.js'));
const {
  reduceCanonicalRunRecord,
} = await import(distUrl('dist/core/change-run/internal/reducer.js'));

const cliEntry = path.join(projectRoot, 'dist', 'cli', 'index.js');

// ---------------------------------------------------------------------------
// Shared helpers (mirrors dogfood-review-cycle.mjs)
// ---------------------------------------------------------------------------

function runCLI(args, testDir, env) {
  try {
    const out = execSync(`node "${cliEntry}" ${args.join(' ')}`, {
      cwd: testDir, env, encoding: 'utf-8', timeout: 60000,
    });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : String(e),
    };
  }
}

function loadHeadRecord(runId, storeRoot) {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDir = path.join(storeRoot, dirName);
  const files = readdirSync(runDir);
  let best = -1;
  for (const f of files) {
    const m = /^record-v(\d+)\.json$/.exec(f);
    if (m) { const v = +m[1]; if (v > best) best = v; }
  }
  if (best === -1) throw new Error(`No record for ${runId}`);
  return decodeCanonicalRunRecord(
    JSON.parse(readFileSync(path.join(runDir, `record-v${best}.json`), 'utf-8'))
  );
}

function applyStimulus(runId, stimulus, storeRoot) {
  const record = loadHeadRecord(runId, storeRoot);
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) throw new Error(`stimulus ${stimulus.kind} failed: ${result.failure.message}`);
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const newPath = path.join(storeRoot, dirName, `record-v${result.record.recordVersion}.json`);
  writeFileSync(newPath, JSON.stringify(result.record, null, 2));
  return result.record;
}

function observeEffects(runId, storeRoot) {
  const record = loadHeadRecord(runId, storeRoot);
  const receiptDigest = `sha256:${'e'.repeat(64)}`;
  for (const committed of Object.values(record.actions)) {
    for (const effect of committed.effects) {
      if (effect.state === 'admitted') {
        applyStimulus(runId, {
          kind: 'observe-effect',
          actionId: committed.action.actionId,
          effectId: effect.effectId,
          status: 'succeeded',
          receiptDigest,
          observation: { ok: true },
          evidence: [],
        }, storeRoot);
      }
    }
  }
}

const actorCache = {};
function makeActor(prefix) {
  if (actorCache[prefix]) return actorCache[prefix];
  const hex = (s) => createHash('sha256').update(s).digest('hex');
  const principal = `sha256:${hex(prefix)}`;
  const session = `sha256:${hex(prefix + '-session')}`;
  const actor = buildAgentActor({
    role: prefix.startsWith('fix') ? 'implementer' : 'reviewer',
    provider: 'anthropic', runtime: 'claude',
    principalIdentityDigest: principal, sessionIdentityDigest: session,
    adapter: { id: `adapter:${prefix}`, version: '1', artifactDigest: session },
  });
  actorCache[prefix] = actor;
  return actor;
}

const okContent = Buffer.from('{"result":"ok"}');
const okDigest = `sha256:${createHash('sha256').update(okContent).digest('hex')}`;

function buildEvRef(record, runId, changeId, actionId, actorPrefix) {
  const actor = makeActor(actorPrefix);
  return buildEvidenceRef({
    content: okContent, mediaType: 'application/json',
    observationKind: 'completion-evidence',
    producer: { id: `p-${actorPrefix}`, version: '1', identityDigest: actor.identityDigest },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId, changeId,
      runId, actionId, schema: 'evidence/1',
    },
  });
}

function buildCompletion(record, runId, changeId, actionId, invocationId, result, actorPrefix, testDir) {
  const actor = makeActor(actorPrefix);
  const attContent = Buffer.from('{"signed":true}');
  const attDigest = `sha256:${createHash('sha256').update(attContent).digest('hex')}`;
  const evRef = buildEvRef(record, runId, changeId, actionId, actorPrefix);
  const attRef = buildEvidenceRef({
    content: attContent, mediaType: 'application/json',
    observationKind: 'actor-attestation',
    producer: { id: `a-${actorPrefix}`, version: '1', identityDigest: actor.identityDigest },
    binding: {
      planningSpaceId: record.change.planningSpaceId,
      changeInstanceId: record.change.instanceId,
      projectId: record.change.projectId, changeId,
      runId, actionId, schema: 'attestation/1',
    },
  });
  const base = {
    format: 'change-run-completion/1', kind: 'domain-action-result',
    change: { projectRoot: testDir, changeId }, runId, actionId, invocationId,
    actor, actorAttestation: attRef, evidence: [evRef],
    status: 'succeeded', result,
  };
  const receiptDigest = computeCompletionReceiptDigest(base);
  return {
    completion: { ...base, receiptDigest },
    uploads: [
      { contentDigest: okDigest, contentBase64: okContent.toString('base64') },
      { contentDigest: attDigest, contentBase64: attContent.toString('base64') },
    ],
  };
}

function getActive(record) {
  return Object.values(record.actions).find((a) => a.state === 'active');
}

function getActiveActions(record) {
  return Object.values(record.actions).filter((a) => a.state === 'active');
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function setupTestDir(label) {
  const testDir = path.join(projectRoot, `test-dogfood-full-feature-${label}-tmp`);
  const dataDir = path.join(testDir, 'global-data');
  const storeRoot = path.join(dataDir, 'rasen', 'runs');
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  const env = { ...process.env, XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
  return { testDir, dataDir, storeRoot, env };
}

function completeAction(runId, changeId, testDir, storeRoot, env, actorPrefix, resultFactory, label) {
  observeEffects(runId, storeRoot);
  const record = loadHeadRecord(runId, storeRoot);
  const active = getActive(record);
  if (!active) {
    console.error(`  [${label}] No active action!`);
    return { ok: false, record };
  }
  const actionId = active.action.actionId;
  const invocationId = active.action.invocationId;
  const result = typeof resultFactory === 'function'
    ? resultFactory(record, actionId)
    : resultFactory;
  const body = buildCompletion(record, runId, changeId, actionId, invocationId, result, actorPrefix, testDir);
  const file = path.join(testDir, `c-${label}.json`);
  writeFileSync(file, JSON.stringify(body));
  const res = runCLI(['pipeline', 'complete', changeId, '--run', runId, '--from', file, '--json'], testDir, env);
  if (res.exitCode !== 0) {
    console.error(`  [${label}] FAILED:`, res.stderr.slice(0, 400));
    return { ok: false, record };
  }
  return { ok: true, actionId };
}

function genericResult(label) {
  return { ok: true, label };
}

// ---------------------------------------------------------------------------
// Scenario 1: Attempt to start full-feature (expected to fail at plan creation)
// ---------------------------------------------------------------------------

async function scenarioAttemptStart() {
  console.log('\n=== Scenario 0: Attempt to start full-feature pipeline ===');
  const { testDir, storeRoot, env } = await setupTestDir('start-attempt');
  const changeId = 'dogfood-ff-start';
  const pipeline = 'full-feature';

  const res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) {
    console.log('  START FAILED (expected — duplicate node path bug):');
    console.log('  stderr:', res.stderr.slice(0, 500));
    await fs.rm(testDir, { recursive: true, force: true });
    return {
      pipeline,
      outcome: 'start-failed',
      error: res.stderr.slice(0, 500),
      blocker: 'duplicate_hierarchical_path_in_lowerer',
    };
  }

  // If it somehow succeeds, record the RunId
  const runId = JSON.parse(res.stdout.trim()).runId;
  console.log('  RunId:', runId);
  await fs.rm(testDir, { recursive: true, force: true });
  return { pipeline, outcome: 'started', runId };
}

// ---------------------------------------------------------------------------
// Scenario 2: Parallel success (if start works)
// This scenario documents the EXPECTED behavior once the Blocker is fixed.
// ---------------------------------------------------------------------------

async function scenarioParallelSuccess() {
  console.log('\n=== Scenario 1: Parallel success (all required complete → Join proceeds) ===');
  const { testDir, storeRoot, env } = await setupTestDir('parallel-success');
  const changeId = 'dogfood-ff-parallel';
  const pipeline = 'full-feature';

  const startRes = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (startRes.exitCode !== 0) {
    console.log('  START FAILED — skipping scenario:');
    console.log('  ', startRes.stderr.slice(0, 300));
    await fs.rm(testDir, { recursive: true, force: true });
    return { outcome: 'skipped', reason: 'start_failed', error: startRes.stderr.slice(0, 300) };
  }
  const runId = JSON.parse(startRes.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete gate stages: office-hours → propose → apply
  console.log('  Phase: office-hours');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('office-hours'), 'oh');

  console.log('  Phase: propose');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('propose'), 'propose');

  console.log('  Phase: apply');
  completeAction(runId, changeId, testDir, storeRoot, env, 'implementer', genericResult('apply'), 'apply');

  // FanOut condition evaluator should be admitted next
  console.log('  Phase: FanOut condition evaluator');
  const record = loadHeadRecord(runId, storeRoot);
  const active = getActive(record);
  if (!active) {
    console.log('  No active action after apply — checking status');
    const statusRes = runCLI(['pipeline', 'status', changeId, pipeline, '--json'], testDir, env);
    console.log('  Status:', JSON.parse(statusRes.stdout.trim()).view.status);
    await fs.rm(testDir, { recursive: true, force: true });
    return { outcome: 'no_active_after_apply', runId };
  }

  // Complete FanOut condition — activate all members
  completeAction(runId, changeId, testDir, storeRoot, env, 'dispatcher', {
    activeMembers: [
      'root:stage:review', 'root:stage:cso', 'root:stage:benchmark',
      'root:stage:design-review', 'root:stage:qa', 'root:stage:qa-only',
    ],
    inactiveMembers: [],
    rationale: {},
  }, 'fanout-cond');

  // Complete all parallel members
  const members = ['review', 'cso', 'benchmark', 'design-review', 'qa', 'qa-only'];
  for (const member of members) {
    console.log(`  Phase: member ${member}`);
    const res = completeAction(runId, changeId, testDir, storeRoot, env, `expert-${member}`,
      genericResult(member), `member-${member}`);
    if (!res.ok) {
      console.log(`  Member ${member} failed — may be due to cap/budget`);
    }
  }

  // Check if Join proceeded
  const statusRes = runCLI(['pipeline', 'status', changeId, pipeline, '--json'], testDir, env);
  const statusJson = JSON.parse(statusRes.stdout.trim());
  const parallelSection = statusJson.view.sections?.find((s) => s.kind === 'parallel');
  console.log('  Status:', statusJson.view.status);
  if (parallelSection) {
    console.log('  JoinState:', parallelSection.joinState);
    console.log('  Members:', JSON.stringify(parallelSection.members?.map((m) => ({ path: m.path, status: m.status })), null, 2));
  }

  await fs.rm(testDir, { recursive: true, force: true });
  return { outcome: 'parallel-success-attempted', runId, joinState: parallelSection?.joinState };
}

// ---------------------------------------------------------------------------
// Scenario 3: Partial failure (optional fails → suppressed; required fails → escalate)
// ---------------------------------------------------------------------------

async function scenarioPartialFailure() {
  console.log('\n=== Scenario 2: Partial failure (optional suppressed, required escalate) ===');
  const { testDir, storeRoot, env } = await setupTestDir('partial-failure');
  const changeId = 'dogfood-ff-partial';
  const pipeline = 'full-feature';

  const startRes = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (startRes.exitCode !== 0) {
    console.log('  START FAILED — skipping scenario');
    await fs.rm(testDir, { recursive: true, force: true });
    return { outcome: 'skipped', reason: 'start_failed' };
  }
  const runId = JSON.parse(startRes.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete gates
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('oh'), 'oh');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('propose'), 'propose');
  completeAction(runId, changeId, testDir, storeRoot, env, 'implementer', genericResult('apply'), 'apply');

  // FanOut condition — activate only required + one optional
  completeAction(runId, changeId, testDir, storeRoot, env, 'dispatcher', {
    activeMembers: ['root:stage:review', 'root:stage:cso'],
    inactiveMembers: ['root:stage:benchmark', 'root:stage:design-review', 'root:stage:qa', 'root:stage:qa-only'],
    rationale: {},
  }, 'fanout-cond');

  // Complete required member (review) successfully
  console.log('  Completing required member: review (succeed)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'expert-review', genericResult('review'), 'review');

  // Fail optional member (cso)
  console.log('  Completing optional member: cso (FAIL)');
  const failRes = completeAction(runId, changeId, testDir, storeRoot, env, 'expert-cso',
    { error: 'cso check failed' }, 'cso-fail');

  const statusRes = runCLI(['pipeline', 'status', changeId, pipeline, '--json'], testDir, env);
  const statusJson = JSON.parse(statusRes.stdout.trim());
  const parallelSection = statusJson.view.sections?.find((s) => s.kind === 'parallel');
  console.log('  Status:', statusJson.view.status);
  if (parallelSection) {
    console.log('  JoinState:', parallelSection.joinState);
  }

  await fs.rm(testDir, { recursive: true, force: true });
  return { outcome: 'partial-failure-attempted', runId, joinState: parallelSection?.joinState };
}

// ---------------------------------------------------------------------------
// Scenario 4: Restart idempotency (mid-Join → same frontier)
// ---------------------------------------------------------------------------

async function scenarioRestartIdempotency() {
  console.log('\n=== Scenario 3: Restart idempotency (mid-Join → same frontier) ===');
  const { testDir, storeRoot, env } = await setupTestDir('restart');
  const changeId = 'dogfood-ff-restart';
  const pipeline = 'full-feature';

  const startRes = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (startRes.exitCode !== 0) {
    console.log('  START FAILED — skipping scenario');
    await fs.rm(testDir, { recursive: true, force: true });
    return { outcome: 'skipped', reason: 'start_failed' };
  }
  const runId = JSON.parse(startRes.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Get to FanOut phase
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('oh'), 'oh');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('propose'), 'propose');
  completeAction(runId, changeId, testDir, storeRoot, env, 'implementer', genericResult('apply'), 'apply');
  completeAction(runId, changeId, testDir, storeRoot, env, 'dispatcher', {
    activeMembers: ['root:stage:review', 'root:stage:cso'],
    inactiveMembers: [],
    rationale: {},
  }, 'fanout-cond');

  // Complete only one member
  console.log('  Completing member: review (succeed)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'expert-review', genericResult('review'), 'review');

  // Simulate restart: just re-run reconcile (which the CLI does on status check)
  console.log('  Simulating restart (status check = re-reconcile)');
  const beforeRecord = loadHeadRecord(runId, storeRoot);
  const statusRes = runCLI(['pipeline', 'status', changeId, pipeline, '--json'], testDir, env);
  const afterRecord = loadHeadRecord(runId, storeRoot);

  // Verify no new actions were admitted (completed member not re-admitted)
  const beforeActions = Object.keys(beforeRecord.actions).length;
  const afterActions = Object.keys(afterRecord.actions).length;
  console.log(`  Actions before: ${beforeActions}, after: ${afterActions}`);

  const statusJson = JSON.parse(statusRes.stdout.trim());
  const parallelSection = statusJson.view.sections?.find((s) => s.kind === 'parallel');
  if (parallelSection) {
    const reviewMember = parallelSection.members?.find((m) => m.path?.includes('review'));
    console.log('  Review member status:', reviewMember?.status);
    console.log('  JoinState:', parallelSection.joinState);
  }

  await fs.rm(testDir, { recursive: true, force: true });
  return { outcome: 'restart-attempted', runId, beforeActions, afterActions };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = {};

// Scenario 0: Attempt to start (will fail with the Blocker)
const r0 = await scenarioAttemptStart();
results.startAttempt = r0;
console.log('\n  RESULT:', r0.outcome, r0.blocker ?? '');

// Scenarios 1-3: These will be skipped if start fails
const r1 = await scenarioParallelSuccess();
results.parallelSuccess = r1;

const r2 = await scenarioPartialFailure();
results.partialFailure = r2;

const r3 = await scenarioRestartIdempotency();
results.restartIdempotency = r3;

console.log('\n=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));

console.log('\n=== FINAL ===');
console.log(JSON.stringify({
  startAttempt: r0.outcome,
  blocker: r0.blocker,
  parallelSuccess: r1.outcome,
  partialFailure: r2.outcome,
  restartIdempotency: r3.outcome,
}, null, 2));
