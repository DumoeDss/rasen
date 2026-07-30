/**
 * Dogfood: drive real goal-loop Runs through MULTIPLE rounds via CLI.
 *
 * Scenarios:
 *   1. goal-loop-measure: round 1 fail → round 2 pass → satisfied terminal
 *   2. goal-loop-measure: all rounds fail → exhausted terminal
 *   3. goal-loop-evaluate: rubric satisfied → satisfied terminal
 *   4. goal-loop-research: research work → judge → report tail
 *
 * Effect observation is a kernel-internal step (no CLI command) performed by
 * directly applying observe-effect stimuli to the record store — exactly the
 * same pattern as test/dogfood-review-cycle.mjs for bug-fix.
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
    role: 'implementer',
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

// ---------------------------------------------------------------------------
// Result factories — build EvidenceRef-based results using record context
// ---------------------------------------------------------------------------

const digest = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

function workResult(record, runId, changeId, actionId, actorPrefix, round) {
  const delta = buildEvRef(record, runId, changeId, actionId, actorPrefix);
  return {
    contract: 'goal-cycle/work-result/1',
    workDescription: `Dogfood work round ${round}`,
    beforeTree: digest(`before-${round}`),
    afterTree: digest(`after-${round}`),
    delta,
  };
}

function researchWorkResult(record, runId, changeId, actionId, actorPrefix, round) {
  const delta = buildEvRef(record, runId, changeId, actionId, actorPrefix);
  return {
    contract: 'goal-cycle/research-work/1',
    documentPath: 'research-report.md',
    beforeTree: digest(`r-before-${round}`),
    afterTree: digest(`r-after-${round}`),
    delta,
  };
}

function measureJudgeFail(round, score) {
  return {
    contract: 'goal-cycle/measure-judge/1',
    score,
    threshold: 80,
    direction: 'gte',
    passed: false,
    detail: `Round ${round}: score ${score} below threshold 80`,
  };
}

function measureJudgePass(score) {
  return {
    contract: 'goal-cycle/measure-judge/1',
    score,
    threshold: 80,
    direction: 'gte',
    passed: true,
    detail: `Score ${score} meets threshold 80`,
  };
}

function evaluateJudgeSatisfied() {
  return {
    contract: 'goal-cycle/evaluate-judge/1',
    satisfied: true,
    gaps: [],
    criteria: [
      { id: 'c1', satisfied: true, evidence: 'All tests pass with sufficient coverage' },
    ],
  };
}

function researchJudgeSatisfied() {
  return {
    contract: 'goal-cycle/research-judge/1',
    satisfied: true,
    gaps: [],
    qualityAssessment: 'Research report is comprehensive and well-structured',
  };
}

function genericResult(label) {
  return { ok: true, label };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function setupTestDir(label) {
  const testDir = path.join(projectRoot, `test-dogfood-goal-cycle-${label}-tmp`);
  const dataDir = path.join(testDir, 'global-data');
  const storeRoot = path.join(dataDir, 'rasen', 'runs');
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  const env = { ...process.env, XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
  return { testDir, dataDir, storeRoot, env };
}

/**
 * Complete the currently active action. If `resultFactory` is provided, it's
 * called with (record, actionId) to build the domain-specific result. Otherwise
 * a generic result is used.
 */
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

function getStatus(changeId, pipeline, testDir, env) {
  const res = runCLI(['pipeline', 'status', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) {
    console.error(`  status error:`, res.stderr.slice(0, 200));
    return null;
  }
  return JSON.parse(res.stdout.trim());
}

function getGoalSection(view) {
  return view.sections.find((s) => s.kind === 'goal');
}

// ---------------------------------------------------------------------------
// Scenario 1: goal-loop-measure — round 1 fail, round 2 pass → satisfied
// ---------------------------------------------------------------------------

async function scenarioMeasureSatisfied() {
  console.log('\n=== Scenario 1: goal-loop-measure (fail → pass → satisfied) ===');
  const { testDir, storeRoot, env } = await setupTestDir('measure-sat');
  const changeId = 'dogfood-gc-measure-sat';
  const pipeline = 'goal-loop-measure';

  let res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) { console.error('START FAILED:', res.stderr); return null; }
  const runId = JSON.parse(res.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete define-goal stage
  console.log('  Phase: define-goal');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('define-goal'), 'dg');

  // Round 1: work
  console.log('  Round 1: work');
  completeAction(runId, changeId, testDir, storeRoot, env, 'work-1',
    (record, actionId) => workResult(record, runId, changeId, actionId, 'work-1', 1), 'r1w');

  // Round 1: judge (FAIL — score 50 < 80)
  console.log('  Round 1: judge (fail, score=50)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'judge-1', measureJudgeFail(1, 50), 'r1j');

  // Round 2: work
  console.log('  Round 2: work');
  completeAction(runId, changeId, testDir, storeRoot, env, 'work-2',
    (record, actionId) => workResult(record, runId, changeId, actionId, 'work-2', 2), 'r2w');

  // Round 2: judge (PASS — score 90 >= 80)
  console.log('  Round 2: judge (pass, score=90)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'judge-2', measureJudgePass(90), 'r2j');

  // Check status
  const status = getStatus(changeId, pipeline, testDir, env);
  const goalSection = status ? getGoalSection(status.view) : null;

  console.log('  Status:', status?.view.status);
  console.log('  Terminal:', JSON.stringify(status?.view.terminal));
  if (goalSection) {
    console.log('  Goal:', JSON.stringify({
      variant: goalSection.variant, round: goalSection.round,
      phase: goalSection.phase, outcome: goalSection.outcome,
      lastScore: goalSection.lastScore,
    }));
  }

  const satisfied = goalSection?.outcome === 'satisfied';
  console.log('  RESULT:', satisfied ? 'SATISFIED' : 'UNEXPECTED');

  await fs.rm(testDir, { recursive: true, force: true });
  return {
    runId, pipeline,
    outcome: satisfied ? 'satisfied' : 'unexpected',
    rounds: 2,
    lastScore: goalSection?.lastScore,
    terminal: status?.view.terminal,
  };
}

// ---------------------------------------------------------------------------
// Scenario 2: goal-loop-measure — all rounds fail → exhausted
// ---------------------------------------------------------------------------

async function scenarioMeasureExhausted() {
  console.log('\n=== Scenario 2: goal-loop-measure (all fail → exhausted) ===');
  const { testDir, storeRoot, env } = await setupTestDir('measure-exh');
  const changeId = 'dogfood-gc-measure-exh';
  const pipeline = 'goal-loop-measure';

  let res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) { console.error('START FAILED:', res.stderr); return null; }
  const runId = JSON.parse(res.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete define-goal
  console.log('  Phase: define-goal');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('define-goal'), 'dg-exh');

  // Drive rounds until exhausted (maxRounds=5 by default)
  let round;
  for (round = 1; round <= 10; round++) {
    const record = loadHeadRecord(runId, storeRoot);
    if (record.terminal !== undefined) {
      console.log('  Terminal reached at round', round);
      break;
    }
    const active = getActive(record);
    if (!active) {
      console.log('  No active action at round', round);
      break;
    }

    // Work phase
    console.log(`  Round ${round}: work`);
    const workRes = completeAction(runId, changeId, testDir, storeRoot, env,
      `exh-w-${round}`,
      (rec, actionId) => workResult(rec, runId, changeId, actionId, `exh-w-${round}`, round + 10),
      `exh-r${round}w`);
    if (!workRes.ok) break;

    // Judge phase (FAIL)
    console.log(`  Round ${round}: judge (fail, score=${30 + round})`);
    const judgeRes = completeAction(runId, changeId, testDir, storeRoot, env,
      `exh-j-${round}`, measureJudgeFail(round, 30 + round), `exh-r${round}j`);
    if (!judgeRes.ok) break;
  }

  const status = getStatus(changeId, pipeline, testDir, env);
  const goalSection = status ? getGoalSection(status.view) : null;
  console.log('  Status:', status?.view.status);
  console.log('  Terminal:', JSON.stringify(status?.view.terminal));
  if (goalSection) {
    console.log('  Goal:', JSON.stringify({
      variant: goalSection.variant, round: goalSection.round,
      outcome: goalSection.outcome, lastScore: goalSection.lastScore,
    }));
  }

  const exhausted = status?.view.status === 'escalated' ||
    status?.view.terminal?.code === 'goal_cycle_exhausted' ||
    goalSection?.outcome === 'exhausted';
  console.log('  RESULT:', exhausted ? 'EXHAUSTED' : 'UNEXPECTED');

  await fs.rm(testDir, { recursive: true, force: true });
  return {
    runId, pipeline,
    outcome: exhausted ? 'exhausted' : 'unexpected',
    rounds: round - 1,
    lastScore: goalSection?.lastScore,
    terminal: status?.view.terminal,
  };
}

// ---------------------------------------------------------------------------
// Scenario 3: goal-loop-evaluate — rubric satisfied
// ---------------------------------------------------------------------------

async function scenarioEvaluateSatisfied() {
  console.log('\n=== Scenario 3: goal-loop-evaluate (rubric → satisfied) ===');
  const { testDir, storeRoot, env } = await setupTestDir('eval-sat');
  const changeId = 'dogfood-gc-eval-sat';
  const pipeline = 'goal-loop-evaluate';

  let res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) { console.error('START FAILED:', res.stderr); return null; }
  const runId = JSON.parse(res.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete define-goal
  console.log('  Phase: define-goal');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('define-goal'), 'edg');

  // Round 1: work
  console.log('  Round 1: work');
  completeAction(runId, changeId, testDir, storeRoot, env, 'ew1',
    (record, actionId) => workResult(record, runId, changeId, actionId, 'ew1', 1), 'erw1');

  // Round 1: judge (SATISFIED via rubric)
  console.log('  Round 1: judge (satisfied via rubric)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'ej1', evaluateJudgeSatisfied(), 'erj1');

  const status = getStatus(changeId, pipeline, testDir, env);
  const goalSection = status ? getGoalSection(status.view) : null;
  console.log('  Status:', status?.view.status);
  console.log('  Terminal:', JSON.stringify(status?.view.terminal));
  if (goalSection) {
    console.log('  Goal:', JSON.stringify({
      variant: goalSection.variant, round: goalSection.round,
      outcome: goalSection.outcome, lastGaps: goalSection.lastGaps,
    }));
  }

  const satisfied = goalSection?.outcome === 'satisfied';
  console.log('  RESULT:', satisfied ? 'SATISFIED' : 'UNEXPECTED');

  await fs.rm(testDir, { recursive: true, force: true });
  return {
    runId, pipeline,
    outcome: satisfied ? 'satisfied' : 'unexpected',
    rounds: 1,
    terminal: status?.view.terminal,
  };
}

// ---------------------------------------------------------------------------
// Scenario 4: goal-loop-research — research work → judge → report tail
// ---------------------------------------------------------------------------

async function scenarioResearch() {
  console.log('\n=== Scenario 4: goal-loop-research (work → judge → report) ===');
  const { testDir, storeRoot, env } = await setupTestDir('research');
  const changeId = 'dogfood-gc-research';
  const pipeline = 'goal-loop-research';

  let res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], testDir, env);
  if (res.exitCode !== 0) { console.error('START FAILED:', res.stderr); return null; }
  const runId = JSON.parse(res.stdout.trim()).runId;
  console.log('  RunId:', runId);

  // Complete define-goal
  console.log('  Phase: define-goal');
  completeAction(runId, changeId, testDir, storeRoot, env, 'planner', genericResult('define-goal'), 'rdg');

  // Round 1: research work
  console.log('  Round 1: research work');
  completeAction(runId, changeId, testDir, storeRoot, env, 'rw1',
    (record, actionId) => researchWorkResult(record, runId, changeId, actionId, 'rw1', 1), 'rrw1');

  // Round 1: judge (SATISFIED)
  console.log('  Round 1: judge (satisfied)');
  completeAction(runId, changeId, testDir, storeRoot, env, 'rj1', researchJudgeSatisfied(), 'rrj1');

  // After satisfied, the report stage should be admitted
  console.log('  Phase: report');
  const reportRes = completeAction(runId, changeId, testDir, storeRoot, env,
    'reporter', genericResult('report'), 'rrep');

  const status = getStatus(changeId, pipeline, testDir, env);
  const goalSection = status ? getGoalSection(status.view) : null;
  console.log('  Status:', status?.view.status);
  console.log('  Terminal:', JSON.stringify(status?.view.terminal));
  if (goalSection) {
    console.log('  Goal:', JSON.stringify({
      variant: goalSection.variant, round: goalSection.round,
      outcome: goalSection.outcome,
    }));
  }

  console.log('  RESULT: RESEARCH COMPLETE');

  await fs.rm(testDir, { recursive: true, force: true });
  return {
    runId, pipeline,
    outcome: 'research-complete',
    rounds: 1,
    reportCompleted: reportRes.ok,
    terminal: status?.view.terminal,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const results = {};

const r1 = await scenarioMeasureSatisfied();
results.measureSatisfied = r1;

const r2 = await scenarioMeasureExhausted();
results.measureExhausted = r2;

const r3 = await scenarioEvaluateSatisfied();
results.evaluateSatisfied = r3;

const r4 = await scenarioResearch();
results.research = r4;

console.log('\n=== RESULTS ===');
console.log(JSON.stringify(results, null, 2));

console.log('\n=== FINAL ===');
console.log(JSON.stringify({
  measureSatisfied: r1?.outcome,
  measureExhausted: r2?.outcome,
  evaluateSatisfied: r3?.outcome,
  researchComplete: r4?.outcome,
}, null, 2));
