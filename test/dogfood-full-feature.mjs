/**
 * Dogfood: drive a real `full-feature` Run through Choice/FanOut/Join via the
 * REAL CLI (ECP-4 tasks 13.3-13.5).
 *
 * Mirrors test/dogfood-review-cycle.mjs and test/dogfood-goal-cycle.mjs.
 *
 * Scenarios:
 *   A. Parallel success — office-hours -> propose -> apply -> FanOut condition
 *      -> 6 members -> Join -> review-loop (findings round) -> ship -> retain
 *      -> archive -> completed. Captures a `pipeline status` snapshot DURING
 *      the FanOut phase (task 13.5).
 *   B1. Partial failure, OPTIONAL member fails -> suppressed, Join proceeds.
 *   B2. Partial failure, REQUIRED member fails -> Join escalates, Run does not
 *       reach the review-loop.
 *   C. Restart idempotency — reconcile again mid-FanOut: same frontier,
 *      completed members are NOT re-admitted, Join is not re-evaluated.
 *
 * Effect observation is a kernel-internal step (no CLI command) performed by
 * directly applying observe-effect stimuli to the record store — exactly the
 * same pattern as the existing dogfood scripts.
 *
 * Run with:  node test/dogfood-full-feature.mjs      (after `node build.js`)
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
const PIPELINE = 'full-feature';
const FANOUT_PATH = 'root:fanout:experts';
const JOIN_PATH = 'root:join:experts-join';
const REVIEW_LOOP_PATH = 'root:stage:review-loop';
/** Member hierarchical paths — the FULL plan paths the FanOut node carries. */
const MEMBERS = [
  'root:stage:review',        // condition: always   -> REQUIRED
  'root:stage:cso',           // condition: security-relevant
  'root:stage:benchmark',     // condition: performance-sensitive
  'root:stage:design-review', // condition: ui
  'root:stage:qa',            // condition: ui
  'root:stage:qa-report-only', // condition: non-ui
];

// ---------------------------------------------------------------------------
// Shared helpers (mirrors dogfood-review-cycle.mjs)
// ---------------------------------------------------------------------------

function runCLI(args, testDir, env) {
  try {
    const out = execSync(`node "${cliEntry}" ${args.join(' ')}`, {
      cwd: testDir, env, encoding: 'utf-8', timeout: 120000,
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

function runDir(runId, storeRoot) {
  return path.join(storeRoot, runId.replace(/[^a-z0-9]/gi, '_'));
}

function loadPlan(runId, storeRoot) {
  return JSON.parse(readFileSync(path.join(runDir(runId, storeRoot), 'plan.json'), 'utf-8'));
}

/** nodeId -> hierarchicalPath, read from the persisted plan. */
function pathByNodeId(runId, storeRoot) {
  const map = new Map();
  for (const node of loadPlan(runId, storeRoot).nodes) {
    map.set(node.nodeId, node.hierarchicalPath);
  }
  return map;
}

function loadHeadRecord(runId, storeRoot) {
  const dir = runDir(runId, storeRoot);
  let best = -1;
  for (const f of readdirSync(dir)) {
    const m = /^record-v(\d+)\.json$/.exec(f);
    if (m) { const v = +m[1]; if (v > best) best = v; }
  }
  if (best === -1) throw new Error(`No record for ${runId}`);
  return decodeCanonicalRunRecord(
    JSON.parse(readFileSync(path.join(dir, `record-v${best}.json`), 'utf-8'))
  );
}

function applyStimulus(runId, stimulus, storeRoot) {
  const record = loadHeadRecord(runId, storeRoot);
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) throw new Error(`stimulus ${stimulus.kind} failed: ${result.failure.message}`);
  const newPath = path.join(runDir(runId, storeRoot), `record-v${result.record.recordVersion}.json`);
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
  const actor = buildAgentActor({
    role: prefix.startsWith('fix') ? 'implementer' : 'reviewer',
    provider: 'anthropic', runtime: 'claude',
    principalIdentityDigest: `sha256:${hex(prefix)}`,
    sessionIdentityDigest: `sha256:${hex(prefix + '-session')}`,
    adapter: { id: `adapter:${prefix}`, version: '1', artifactDigest: `sha256:${hex(prefix + '-session')}` },
  });
  actorCache[prefix] = actor;
  return actor;
}

const okContent = Buffer.from('{"result":"ok"}');
const okDigest = `sha256:${createHash('sha256').update(okContent).digest('hex')}`;

function evRef(record, runId, changeId, actionId, actorPrefix) {
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

function buildCompletion(record, runId, changeId, actionId, invocationId, result, actorPrefix, testDir, status = 'succeeded') {
  const actor = makeActor(actorPrefix);
  const attContent = Buffer.from('{"signed":true}');
  const attDigest = `sha256:${createHash('sha256').update(attContent).digest('hex')}`;
  const evidenceRef = evRef(record, runId, changeId, actionId, actorPrefix);
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
    actor, actorAttestation: attRef, evidence: [evidenceRef],
    status, result,
  };
  return {
    completion: { ...base, receiptDigest: computeCompletionReceiptDigest(base) },
    uploads: [
      { contentDigest: okDigest, contentBase64: okContent.toString('base64') },
      { contentDigest: attDigest, contentBase64: attContent.toString('base64') },
    ],
  };
}

function activeActions(record) {
  return Object.values(record.actions).filter((a) => a.state === 'active');
}

// ---------------------------------------------------------------------------
// Run driver
// ---------------------------------------------------------------------------

async function setupTestDir(label) {
  const testDir = path.join(projectRoot, `test-dogfood-ff-${label}-tmp`);
  const dataDir = path.join(testDir, 'global-data');
  const storeRoot = path.join(dataDir, 'rasen', 'runs');
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  const env = { ...process.env, XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
  return { testDir, dataDir, storeRoot, env };
}

/**
 * A Run harness bound to one test directory. Holds the actionId ledger the
 * dogfood evidence is built from.
 */
class RunHarness {
  constructor(ctx, changeId, runId) {
    Object.assign(this, ctx);
    this.changeId = changeId;
    this.runId = runId;
    this.paths = pathByNodeId(runId, this.storeRoot);
    /** hierarchicalPath -> ordered actionIds committed for it. */
    this.ledger = {};
  }

  status() {
    const res = runCLI(['pipeline', 'status', this.changeId, PIPELINE, '--json'], this.testDir, this.env);
    if (res.exitCode !== 0) throw new Error(`status failed: ${res.stderr.slice(0, 400)}`);
    return JSON.parse(res.stdout.trim());
  }

  section(kind) {
    return this.status().view.sections?.find((s) => s.kind === kind);
  }

  record() {
    return loadHeadRecord(this.runId, this.storeRoot);
  }

  pathOf(action) {
    const direct = this.paths.get(action.action.nodeId);
    if (direct !== undefined) return direct;
    // BoundedLoop phase actions carry a body-phase nodeId that is NOT a root
    // plan node; the admit payload (under `agent.input`) names the loop.
    const input = action.action.agent?.input ?? {};
    const loopPath = input.reviewCycle?.loopPath ?? input.goalCycle?.loopPath;
    if (typeof loopPath === 'string') return loopPath;
    return `unknown(${action.action.nodeId.slice(0, 16)})`;
  }

  /** Active actions annotated with their hierarchical path. */
  frontier() {
    return activeActions(this.record()).map((a) => ({
      actionId: a.action.actionId,
      invocationId: a.action.invocationId,
      path: this.pathOf(a),
    }));
  }

  /** Complete ONE specific active action. Returns { ok, actionId, error }. */
  complete(target, result, actorPrefix, label, status = 'succeeded') {
    observeEffects(this.runId, this.storeRoot);
    const record = this.record();
    const active = activeActions(record).find((a) => a.action.actionId === target.actionId);
    if (!active) return { ok: false, error: `action ${label} no longer active` };
    const actionId = active.action.actionId;
    const body = buildCompletion(
      record, this.runId, this.changeId, actionId, active.action.invocationId,
      typeof result === 'function' ? result(record, actionId) : result,
      actorPrefix, this.testDir, status
    );
    const file = path.join(this.testDir, `c-${label.replace(/[^a-z0-9-]/gi, '_')}.json`);
    writeFileSync(file, JSON.stringify(body));
    const res = runCLI(
      ['pipeline', 'complete', this.changeId, '--run', this.runId, '--from', file, '--json'],
      this.testDir, this.env
    );
    if (res.exitCode !== 0) {
      return { ok: false, actionId, error: res.stderr.slice(0, 600) };
    }
    const p = target.path;
    (this.ledger[p] ??= []).push(actionId);
    return { ok: true, actionId };
  }

  /** Complete every currently-active action whose path matches `predicate`. */
  completeMatching(predicate, resultFor, actorFor, labelFor, statusFor) {
    const done = [];
    let guard = 0;
    for (;;) {
      if (guard++ > 40) throw new Error('completeMatching guard tripped');
      const target = this.frontier().find((f) => predicate(f.path) && !done.some((d) => d.actionId === f.actionId));
      if (!target) break;
      const res = this.complete(
        target, resultFor(target.path), actorFor(target.path), labelFor(target.path),
        statusFor ? statusFor(target.path) : 'succeeded'
      );
      done.push({ path: target.path, actionId: target.actionId, ok: res.ok, error: res.error });
      if (!res.ok) break;
    }
    return done;
  }
}

function startRun(ctx, changeId) {
  const res = runCLI(['pipeline', 'start', changeId, PIPELINE, '--json'], ctx.testDir, ctx.env);
  if (res.exitCode !== 0) {
    throw new Error(`pipeline start ${PIPELINE} FAILED: ${res.stderr.slice(0, 800)}`);
  }
  const parsed = JSON.parse(res.stdout.trim());
  return { harness: new RunHarness(ctx, changeId, parsed.runId), start: parsed };
}

const genericResult = (label) => ({ ok: true, stage: label });

function fanOutResult(active) {
  return {
    activeMembers: active,
    inactiveMembers: MEMBERS.filter((m) => !active.includes(m)),
    rationale: Object.fromEntries(MEMBERS.map((m) => [m, active.includes(m) ? 'selected' : 'not applicable'])),
  };
}

/** Drive the three lead-in gate stages. */
function driveLeadIn(h) {
  const seq = [
    ['root:stage:office-hours', 'planner', 'office-hours'],
    ['root:stage:propose', 'planner', 'propose'],
    ['root:stage:apply', 'implementer', 'apply'],
  ];
  for (const [wantPath, actor, label] of seq) {
    const target = h.frontier().find((f) => f.path === wantPath);
    if (!target) throw new Error(`expected ${wantPath} on the frontier, saw ${JSON.stringify(h.frontier())}`);
    const res = h.complete(target, genericResult(label), actor, label);
    if (!res.ok) throw new Error(`${label} completion failed: ${res.error}`);
  }
}

/** Drive one full ReviewCycle round: review(findings) -> triage -> fix -> re-review(clean). */
function driveReviewLoop(h) {
  const phases = [];
  let guard = 0;
  for (;;) {
    if (guard++ > 12) throw new Error('review-loop guard tripped');
    const target = h.frontier().find((f) => f.path === REVIEW_LOOP_PATH);
    if (!target) {
      const rcNow = h.section('review-cycle');
      const st = h.status();
      if (st.view.status !== 'completed' && !h.frontier().some((f) => f.path.startsWith('root:stage:'))) {
        console.log('  review-loop stalled:', JSON.stringify({
          status: st.view.status,
          reviewCycle: rcNow,
          frontier: h.frontier(),
          transitions: h.record().transitions.slice(-6).map((t) => ({ kind: t.kind, ...(t.code ? { code: t.code } : {}), ...(t.reason ? { reason: t.reason } : {}) })),
        }, null, 2));
      }
      break;
    }
    const rc = h.section('review-cycle');
    const phase = rc?.phase ?? 'review';
    const round = rc?.round ?? 1;
    phases.push({ round, phase, actionId: target.actionId });
    let result;
    let actor;
    if (phase === 'review') {
      // Round 1 raises a Major finding so the loop genuinely cycles.
      result = round === 1
        ? (record, actionId) => ({
            contract: 'review-cycle/review-result/1',
            outcome: 'findings',
            findings: [{
              id: 'F1', severity: 'major',
              claim: 'Dogfood: parallel expert output not covered by a regression test',
              evidence: [evRef(record, h.runId, h.changeId, actionId, 'reviewerA')],
              status: 'open',
            }],
          })
        : { contract: 'review-cycle/review-result/1', outcome: 'clean', findings: [] };
      actor = 'reviewerA';
    } else if (phase === 'triage') {
      result = {
        contract: 'review-cycle/triage-result/1',
        decisions: [{ findingId: 'F1', disposition: 'fix_inline', rationale: 'Fix inline with test coverage' }],
      };
      actor = 'triageA';
    } else if (phase === 'fix') {
      result = (record, actionId) => ({
        contract: 'review-cycle/fix-result/1',
        findingIds: ['F1'],
        beforeTree: `sha256:${'a'.repeat(64)}`,
        afterTree: `sha256:${'b'.repeat(64)}`,
        delta: evRef(record, h.runId, h.changeId, actionId, 'fixerA'),
        tests: [evRef(record, h.runId, h.changeId, actionId, 'fixerA')],
      });
      actor = 'fixerA';
    } else {
      result = (record, actionId) => ({
        contract: 'review-cycle/verification-result/1',
        verifications: [{
          findingId: 'F1', verdict: 'resolved',
          evidence: [evRef(record, h.runId, h.changeId, actionId, 'verifierA')],
        }],
      });
      actor = 'verifierA';
    }
    const res = h.complete(target, result, actor, `rc-r${round}-${phase}`);
    if (!res.ok) throw new Error(`review-loop ${phase} failed: ${res.error}`);
  }
  return phases;
}

// ---------------------------------------------------------------------------
// Scenario A: parallel success -> full chain to `completed`
// ---------------------------------------------------------------------------

async function scenarioParallelSuccess() {
  console.log('\n=== Scenario A: parallel success (all 6 members) -> completed ===');
  const ctx = await setupTestDir('parallel-success');
  const { harness: h, start } = startRun(ctx, 'dogfood-ff-parallel');
  console.log('  RunId:', h.runId);
  console.log('  engine:', start.engine, '| planDigest:', loadPlan(h.runId, h.storeRoot).planDigest);

  driveLeadIn(h);

  // --- FanOut condition evaluator ---
  const condTarget = h.frontier().find((f) => f.path === FANOUT_PATH);
  if (!condTarget) throw new Error(`FanOut condition not on frontier: ${JSON.stringify(h.frontier())}`);
  const condRes = h.complete(condTarget, fanOutResult(MEMBERS), 'dispatcher', 'fanout-condition');
  if (!condRes.ok) throw new Error(`FanOut condition failed: ${condRes.error}`);
  console.log('  FanOut condition actionId:', condRes.actionId);

  // --- Task 13.5: `pipeline status` DURING the FanOut phase ---
  const midStatus = h.status();
  const midParallel = midStatus.view.sections.find((s) => s.kind === 'parallel');
  const midFrontier = h.frontier();
  console.log('  [13.5] status during FanOut:', midStatus.view.status);
  console.log('  [13.5] parallel section:', JSON.stringify({
    fanOutPath: midParallel?.fanOutPath,
    joinPath: midParallel?.joinPath,
    joinState: midParallel?.joinState,
    concurrencyCap: midParallel?.concurrencyCap,
    budget: midParallel?.budget,
    activeCount: midParallel?.activeCount,
    members: midParallel?.members?.map((m) => ({ path: m.path, status: m.status, required: m.required })),
  }, null, 2));
  console.log('  [13.5] member frontier:', JSON.stringify(midFrontier.map((f) => f.path)));

  // --- Complete all members (the reconciler admits them in cap-sized waves) ---
  const memberLedger = h.completeMatching(
    (p) => MEMBERS.includes(p),
    (p) => genericResult(p),
    (p) => `expert-${p.split(':').pop()}`,
    (p) => `member-${p.split(':').pop()}`
  );
  console.log('  members completed:', memberLedger.length, memberLedger.every((m) => m.ok) ? 'ALL OK' : 'SOME FAILED');
  for (const m of memberLedger) {
    console.log(`    ${m.path.padEnd(28)} ${m.ok ? 'OK' : 'FAIL ' + m.error} ${m.actionId?.slice(0, 22)}`);
  }

  const postJoin = h.status();
  const postParallel = postJoin.view.sections.find((s) => s.kind === 'parallel');
  console.log('  Join resolution:', JSON.stringify({
    joinState: postParallel?.joinState,
    succeededCount: postParallel?.succeededCount,
    failedCount: postParallel?.failedCount,
    budget: postParallel?.budget,
  }));

  // --- review-loop ---
  const rcPhases = driveReviewLoop(h);
  console.log('  review-loop phases:', JSON.stringify(rcPhases.map((p) => `r${p.round}:${p.phase}`)));

  // --- ship -> retain -> archive ---
  const tail = h.completeMatching(
    (p) => ['root:stage:ship', 'root:stage:retain', 'root:stage:archive'].includes(p),
    (p) => genericResult(p),
    () => 'shipper',
    (p) => p.split(':').pop()
  );
  for (const t of tail) console.log(`    ${t.path.padEnd(28)} ${t.ok ? 'OK' : 'FAIL ' + t.error}`);

  const final = h.status();
  const finalRecord = h.record();
  // The terminal outcome lives on the Record; the view nests it in root-dag.
  console.log('  FINAL status:', final.view.status, '| terminal:', JSON.stringify(finalRecord.terminal));
  console.log('  action count:', Object.keys(finalRecord.actions).length);

  const out = {
    runId: h.runId,
    planDigest: loadPlan(h.runId, h.storeRoot).planDigest,
    sourceRevisionDigest: loadPlan(h.runId, h.storeRoot).sourceRevisionDigest,
    finalStatus: final.view.status,
    terminal: finalRecord.terminal ?? null,
    recordVersion: finalRecord.recordVersion,
    actionCount: Object.keys(finalRecord.actions).length,
    fanOutConditionActionId: condRes.actionId,
    ledger: h.ledger,
    duringFanOut: {
      status: midStatus.view.status,
      parallelSection: midParallel,
      frontier: midFrontier.map((f) => f.path),
    },
    joinResolution: {
      joinState: postParallel?.joinState,
      succeededCount: postParallel?.succeededCount,
      failedCount: postParallel?.failedCount,
      budget: postParallel?.budget,
    },
    reviewLoopPhases: rcPhases.map((p) => ({ round: p.round, phase: p.phase, actionId: p.actionId })),
    outcome: final.view.status === 'completed' ? 'completed' : `ended-${final.view.status}`,
  };
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario B1: optional member fails -> suppressed, Join proceeds
// ---------------------------------------------------------------------------

async function scenarioOptionalFailure() {
  console.log('\n=== Scenario B1: OPTIONAL member fails -> suppressed, Join proceeds ===');
  const ctx = await setupTestDir('optional-failure');
  const { harness: h } = startRun(ctx, 'dogfood-ff-optional');
  console.log('  RunId:', h.runId);
  driveLeadIn(h);

  // Activate the required member plus one optional member.
  const active = ['root:stage:review', 'root:stage:cso'];
  const condTarget = h.frontier().find((f) => f.path === FANOUT_PATH);
  const condRes = h.complete(condTarget, fanOutResult(active), 'dispatcher', 'fanout-condition');
  if (!condRes.ok) throw new Error(`FanOut condition failed: ${condRes.error}`);

  // Required member succeeds, optional member FAILS.
  const csoTarget = h.frontier().find((f) => f.path === 'root:stage:cso');
  const csoRes = h.complete(csoTarget, { error: 'cso check failed' }, 'expert-cso', 'cso-fail', 'failed');
  console.log('  optional cso completion(status=failed):', csoRes.ok ? 'accepted' : `rejected: ${csoRes.error}`);

  const reviewTarget = h.frontier().find((f) => f.path === 'root:stage:review');
  const reviewRes = h.complete(reviewTarget, genericResult('review'), 'expert-review', 'review-ok');
  console.log('  required review completion:', reviewRes.ok ? 'OK' : `FAIL ${reviewRes.error}`);

  const status = h.status();
  const parallel = status.view.sections.find((s) => s.kind === 'parallel');
  const frontier = h.frontier();
  console.log('  status:', status.view.status, '| joinState:', parallel?.joinState);
  console.log('  members:', JSON.stringify(parallel?.members?.map((m) => `${m.path}=${m.status}`)));
  console.log('  frontier after Join:', JSON.stringify(frontier.map((f) => f.path)));

  const out = {
    runId: h.runId,
    optionalFailAccepted: csoRes.ok,
    requiredOk: reviewRes.ok,
    status: status.view.status,
    joinState: parallel?.joinState,
    failedCount: parallel?.failedCount,
    succeededCount: parallel?.succeededCount,
    members: parallel?.members?.map((m) => ({ path: m.path, status: m.status, required: m.required })),
    frontierAfterJoin: frontier.map((f) => f.path),
    joinProceeded: frontier.some((f) => f.path === REVIEW_LOOP_PATH),
    ledger: h.ledger,
  };
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario B2: required member fails -> Join escalates
// ---------------------------------------------------------------------------

async function scenarioRequiredFailure() {
  console.log('\n=== Scenario B2: REQUIRED member fails -> Join escalates ===');
  const ctx = await setupTestDir('required-failure');
  const { harness: h } = startRun(ctx, 'dogfood-ff-required');
  console.log('  RunId:', h.runId);
  driveLeadIn(h);

  const condTarget = h.frontier().find((f) => f.path === FANOUT_PATH);
  const condRes = h.complete(condTarget, fanOutResult(['root:stage:review', 'root:stage:qa']), 'dispatcher', 'fanout-condition');
  if (!condRes.ok) throw new Error(`FanOut condition failed: ${condRes.error}`);

  // Optional qa succeeds; REQUIRED review fails.
  const qaTarget = h.frontier().find((f) => f.path === 'root:stage:qa');
  h.complete(qaTarget, genericResult('qa'), 'expert-qa', 'qa-ok');

  const reviewTarget = h.frontier().find((f) => f.path === 'root:stage:review');
  const reviewRes = h.complete(reviewTarget, { error: 'review found a blocker' }, 'expert-review', 'review-fail', 'failed');
  console.log('  required review completion(status=failed):', reviewRes.ok ? 'accepted' : `rejected: ${reviewRes.error}`);

  const status = h.status();
  const parallel = status.view.sections.find((s) => s.kind === 'parallel');
  const frontier = h.frontier();
  console.log('  status:', status.view.status, '| terminal:', JSON.stringify(h.record().terminal));
  console.log('  joinState:', parallel?.joinState, '| keyBlockers:', JSON.stringify(parallel?.keyBlockers));
  console.log('  frontier:', JSON.stringify(frontier.map((f) => f.path)));

  // The REQUIRED-member failure must NOT let the review-loop start.
  const out = {
    runId: h.runId,
    status: status.view.status,
    terminal: h.record().terminal ?? null,
    joinState: parallel?.joinState,
    failedCount: parallel?.failedCount,
    keyBlockers: parallel?.keyBlockers,
    frontier: frontier.map((f) => f.path),
    reviewLoopStarted: frontier.some((f) => f.path === REVIEW_LOOP_PATH),
    ledger: h.ledger,
  };
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario C: restart idempotency mid-FanOut
// ---------------------------------------------------------------------------

async function scenarioRestartIdempotency() {
  console.log('\n=== Scenario C: restart idempotency mid-FanOut ===');
  const ctx = await setupTestDir('restart');
  const { harness: h } = startRun(ctx, 'dogfood-ff-restart');
  console.log('  RunId:', h.runId);
  driveLeadIn(h);

  const condTarget = h.frontier().find((f) => f.path === FANOUT_PATH);
  h.complete(condTarget, fanOutResult(MEMBERS), 'dispatcher', 'fanout-condition');

  // Complete exactly ONE member, leaving the FanOut mid-flight.
  const first = h.frontier().find((f) => MEMBERS.includes(f.path));
  if (!first) throw new Error(`no FanOut member on the frontier: ${JSON.stringify(h.frontier())}`);
  const firstRes = h.complete(first, genericResult(first.path), `expert-${first.path.split(':').pop()}`, 'member-first');
  console.log('  completed member:', first.path, firstRes.ok ? 'OK' : `FAIL ${firstRes.error}`);

  const beforeRecord = h.record();
  const beforeFrontier = h.frontier().map((f) => f.path).sort();
  const beforeActions = Object.keys(beforeRecord.actions).length;

  // "Restart": a fresh CLI process re-reconciles from the persisted Record.
  const resumeA = runCLI(['pipeline', 'resume-run', h.changeId, PIPELINE, '--json'], h.testDir, h.env);
  const resumeB = runCLI(['pipeline', 'resume-run', h.changeId, PIPELINE, '--json'], h.testDir, h.env);
  console.log('  resume-run exit codes:', resumeA.exitCode, resumeB.exitCode);

  const afterRecord = h.record();
  const afterFrontier = h.frontier().map((f) => f.path).sort();
  const afterActions = Object.keys(afterRecord.actions).length;

  const completedPath = first.path;
  const reAdmitted = afterFrontier.includes(completedPath);
  const parallel = h.status().view.sections.find((s) => s.kind === 'parallel');

  console.log(`  actions before=${beforeActions} after=${afterActions}`);
  console.log('  frontier before:', JSON.stringify(beforeFrontier));
  console.log('  frontier after :', JSON.stringify(afterFrontier));
  console.log('  completed member re-admitted:', reAdmitted);

  const out = {
    runId: h.runId,
    completedMember: completedPath,
    beforeActions, afterActions,
    frontierStable: JSON.stringify(beforeFrontier) === JSON.stringify(afterFrontier),
    actionCountStable: beforeActions === afterActions,
    completedMemberReAdmitted: reAdmitted,
    joinState: parallel?.joinState,
    memberStatuses: parallel?.members?.map((m) => `${m.path}=${m.status}`),
    ledger: h.ledger,
  };
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = {};
let failures = 0;

for (const [name, fn] of [
  ['parallelSuccess', scenarioParallelSuccess],
  ['optionalFailure', scenarioOptionalFailure],
  ['requiredFailure', scenarioRequiredFailure],
  ['restartIdempotency', scenarioRestartIdempotency],
]) {
  try {
    results[name] = await fn();
  } catch (e) {
    failures += 1;
    results[name] = { error: String(e?.stack ?? e).slice(0, 2000) };
    console.error(`  SCENARIO ${name} THREW:`, String(e?.message ?? e).slice(0, 600));
  }
}

console.log('\n=== RESULTS (full) ===');
console.log(JSON.stringify(results, null, 2));

// ---------------------------------------------------------------------------
// Gate on the OBSERVED BEHAVIOUR, not merely on "nothing threw". As the
// durable 13.3-13.5 regression net, a scenario that runs to completion with
// the wrong outcome (Join proceeding on a failed required member, a restart
// re-admitting a completed member) must fail the script — otherwise the flags
// below are decoration and the net has holes.
// ---------------------------------------------------------------------------
const assertions = [
  ['A: parallel-success Run reaches completed',
    results.parallelSuccess?.finalStatus === 'completed'],
  ['A: terminal outcome is full-feature-completed',
    results.parallelSuccess?.terminal?.outcome === 'full-feature-completed'],
  ['A: Join proceeds with all 6 members succeeded',
    results.parallelSuccess?.joinResolution?.joinState === 'proceeding' &&
    results.parallelSuccess?.joinResolution?.succeededCount === 6 &&
    results.parallelSuccess?.joinResolution?.failedCount === 0],
  ['A: status during FanOut shows the parallel section with a member frontier',
    results.parallelSuccess?.duringFanOut?.parallelSection?.kind === 'parallel' &&
    (results.parallelSuccess?.duringFanOut?.frontier?.length ?? 0) > 0],
  ['A: FanOut admits no more than the concurrency cap at once',
    (results.parallelSuccess?.duringFanOut?.frontier?.length ?? 0) <=
      (results.parallelSuccess?.duringFanOut?.parallelSection?.concurrencyCap ?? 0)],
  ['A: review-loop ran a full findings round',
    JSON.stringify(
      (results.parallelSuccess?.reviewLoopPhases ?? []).map((p) => p.phase)
    ) === JSON.stringify(['review', 'triage', 'fix', 're-review'])],
  ['B1: optional member failure is suppressed and the Join proceeds',
    results.optionalFailure?.joinState === 'proceeding' &&
    results.optionalFailure?.joinProceeded === true],
  ['B2: required member failure escalates the Run',
    results.requiredFailure?.status === 'escalated' &&
    results.requiredFailure?.joinState === 'failed'],
  ['B2: the review-loop never starts after a required-member failure',
    results.requiredFailure?.reviewLoopStarted === false],
  ['C: restart keeps the frontier and action count stable',
    results.restartIdempotency?.frontierStable === true &&
    results.restartIdempotency?.actionCountStable === true],
  ['C: a completed member is not re-admitted on restart',
    results.restartIdempotency?.completedMemberReAdmitted === false],
];

const violations = assertions.filter(([, ok]) => ok !== true).map(([label]) => label);
console.log('\n=== BEHAVIOURAL ASSERTIONS ===');
for (const [label, ok] of assertions) {
  console.log(`  ${ok === true ? 'PASS' : 'FAIL'}  ${label}`);
}

console.log('\n=== FINAL ===');
console.log(JSON.stringify({
  parallelSuccess: results.parallelSuccess?.outcome ?? 'error',
  parallelSuccessRunId: results.parallelSuccess?.runId,
  optionalFailure_joinProceeded: results.optionalFailure?.joinProceeded,
  requiredFailure_reviewLoopStarted: results.requiredFailure?.reviewLoopStarted,
  requiredFailure_status: results.requiredFailure?.status,
  restart_frontierStable: results.restartIdempotency?.frontierStable,
  restart_completedMemberReAdmitted: results.restartIdempotency?.completedMemberReAdmitted,
  scenarioErrors: failures,
  assertionsChecked: assertions.length,
  assertionViolations: violations,
}, null, 2));

if (violations.length > 0) {
  console.error(`\nDOGFOOD FAILED: ${violations.length} behavioural assertion(s) violated.`);
}
process.exit(failures === 0 && violations.length === 0 ? 0 : 1);
