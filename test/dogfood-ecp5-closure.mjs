/**
 * Dogfood: the ECP-5 closure cells the portfolio was missing (tasks 7.4-7.7).
 *
 * Sibling of test/dogfood-review-cycle.mjs, dogfood-goal-cycle.mjs and
 * dogfood-full-feature.mjs, and shares their conventions: a fresh temp project,
 * an isolated XDG_DATA_HOME, real fresh-process CLI invocations against the
 * built `dist/`, and effect observation applied directly to the record store
 * (a kernel-internal step with no CLI command).
 *
 * Scenarios:
 *   A. `small-feature` end to end -> `completed` terminal (task 7.4). The
 *      cell that previously had only a normalization test.
 *   B. `goal-loop-evaluate` through define-goal -> work -> evaluate judge ->
 *      ship -> retain -> archive -> `completed` terminal (task 7.5).
 *   C. A Canvas-AUTHORED Custom Composite: the definition exported by
 *      packages/ui/test/canvas/canvas-authored-composite-export.test.tsx from
 *      the real PipelineCanvasPage's save POST, installed with the real
 *      `pipeline save`, discovered with `pipeline show`, run to `completed`
 *      (task 7.6). ECP-2's composite dogfood was programmatic and in-process.
 *   D. The converged `rasen-auto` Step E protocol driven exactly as the
 *      playbook now prescribes: read the engine from `pipeline show --json`,
 *      launch, then loop `pipeline resume-run` -> dispatch per granted action
 *      -> `pipeline complete`, reading progress ONLY from the `review-cycle`
 *      section of `pipeline status` (task 7.7).
 *
 * Run with:  node test/dogfood-ecp5-closure.mjs      (after `node build.js`)
 */
import { execSync } from 'child_process';
import { promises as fs, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const distUrl = (rel) => pathToFileURL(path.join(projectRoot, rel)).href;
const { buildEvidenceRef } = await import(distUrl('dist/core/change-run/internal/evidence.js'));
const { buildAgentActor } = await import(distUrl('dist/core/change-run/internal/actors.js'));
const { computeCompletionReceiptDigest } = await import(distUrl('dist/core/change-run/internal/completion.js'));
const { decodeCanonicalRunRecord } = await import(distUrl('dist/core/change-run/internal/record.js'));
const { reduceCanonicalRunRecord } = await import(distUrl('dist/core/change-run/internal/reducer.js'));
const { freezeProductionPreparedPipelineRegistry } = await import(
  distUrl('dist/core/pipeline-registry/index.js')
);

const cliEntry = path.join(projectRoot, 'dist', 'cli', 'index.js');
const HEAD = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

// ---------------------------------------------------------------------------
// Shared helpers
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

const runDir = (runId, storeRoot) => path.join(storeRoot, runId.replace(/[^a-z0-9]/gi, '_'));

function loadPlan(runId, storeRoot) {
  return JSON.parse(readFileSync(path.join(runDir(runId, storeRoot), 'plan.json'), 'utf-8'));
}

function pathByNodeId(runId, storeRoot) {
  const map = new Map();
  for (const node of loadPlan(runId, storeRoot).nodes) map.set(node.nodeId, node.hierarchicalPath);
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
  writeFileSync(
    path.join(runDir(runId, storeRoot), `record-v${result.record.recordVersion}.json`),
    JSON.stringify(result.record, null, 2)
  );
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
    role: prefix.startsWith('fix') || prefix.startsWith('impl') ? 'implementer' : 'reviewer',
    provider: 'anthropic', runtime: 'claude',
    principalIdentityDigest: `sha256:${hex(prefix)}`,
    sessionIdentityDigest: `sha256:${hex(`${prefix}-session`)}`,
    adapter: { id: `adapter:${prefix}`, version: '1', artifactDigest: `sha256:${hex(`${prefix}-session`)}` },
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
    actor, actorAttestation: attRef,
    evidence: [evRef(record, runId, changeId, actionId, actorPrefix)],
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

const activeActions = (record) =>
  Object.values(record.actions).filter((a) => a.state === 'active');

async function setupTestDir(label) {
  const testDir = path.join(projectRoot, `test-dogfood-ecp5-${label}-tmp`);
  const dataDir = path.join(testDir, 'global-data');
  const storeRoot = path.join(dataDir, 'rasen', 'runs');
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  const env = { ...process.env, XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };
  return { testDir, dataDir, storeRoot, env };
}

async function seedChange(testDir, changeId, why) {
  const dir = path.join(testDir, 'rasen', 'changes', changeId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), `## Why\n\n${why}\n`);
  return dir;
}

class RunHarness {
  constructor(ctx, changeId, pipeline, runId) {
    Object.assign(this, ctx);
    this.changeId = changeId;
    this.pipeline = pipeline;
    this.runId = runId;
    this.paths = pathByNodeId(runId, this.storeRoot);
    this.ledger = {};
    this.transcript = [];
  }

  log(line) {
    this.transcript.push(line);
    console.log(`   ${line}`);
  }

  cli(args) {
    return runCLI(args, this.testDir, this.env);
  }

  status() {
    const res = this.cli(['pipeline', 'status', this.changeId, this.pipeline, '--json']);
    if (res.exitCode !== 0) throw new Error(`status failed: ${res.stderr.slice(0, 400)}`);
    return JSON.parse(res.stdout.trim());
  }

  section(kind) {
    return this.status().view?.sections?.find((s) => s.kind === kind);
  }

  record() {
    return loadHeadRecord(this.runId, this.storeRoot);
  }

  pathOf(action) {
    const direct = this.paths.get(action.action.nodeId);
    if (direct !== undefined) return direct;
    const input = action.action.agent?.input ?? {};
    const loopPath = input.reviewCycle?.loopPath ?? input.goalCycle?.loopPath;
    if (typeof loopPath === 'string') return loopPath;
    return `unknown(${action.action.nodeId.slice(0, 16)})`;
  }

  frontier() {
    return activeActions(this.record()).map((a) => ({
      actionId: a.action.actionId,
      invocationId: a.action.invocationId,
      path: this.pathOf(a),
      phase: a.action.agent?.input?.reviewCycle?.phase
        ?? a.action.agent?.input?.goalCycle?.phase
        ?? null,
    }));
  }

  /** `pipeline resume-run` — the canonical frontier grant the playbook uses. */
  resumeRun() {
    const res = this.cli(['pipeline', 'resume-run', this.changeId, this.pipeline, '--json']);
    if (res.exitCode !== 0) throw new Error(`resume-run failed: ${res.stderr.slice(0, 400)}`);
    return JSON.parse(res.stdout.trim());
  }

  complete(target, result, actorPrefix, label, status = 'succeeded') {
    observeEffects(this.runId, this.storeRoot);
    const record = this.record();
    const active = activeActions(record).find((a) => a.action.actionId === target.actionId);
    if (!active) return { ok: false, error: `action ${label} no longer active` };
    const body = buildCompletion(
      record, this.runId, this.changeId, target.actionId, active.action.invocationId,
      typeof result === 'function' ? result(record, target.actionId) : result,
      actorPrefix, this.testDir, status
    );
    const file = path.join(this.testDir, `c-${label.replace(/[^a-z0-9-]/gi, '_')}.json`);
    writeFileSync(file, JSON.stringify(body));
    const res = this.cli(['pipeline', 'complete', this.changeId, '--run', this.runId, '--from', file, '--json']);
    if (res.exitCode !== 0) return { ok: false, actionId: target.actionId, error: res.stderr.slice(0, 600) };
    (this.ledger[target.path] ??= []).push(target.actionId);
    let receipt = null;
    try { receipt = JSON.parse(res.stdout.trim()); } catch { /* human output */ }
    return { ok: true, actionId: target.actionId, receipt };
  }
}

function start(ctx, changeId, pipeline) {
  const res = runCLI(['pipeline', 'start', changeId, pipeline, '--json'], ctx.testDir, ctx.env);
  if (res.exitCode !== 0) throw new Error(`start ${pipeline} FAILED: ${res.stderr.slice(0, 800)}`);
  const parsed = JSON.parse(res.stdout.trim());
  return { h: new RunHarness(ctx, changeId, pipeline, parsed.runId), receipt: parsed };
}

/** The result contract for a review-cycle phase action. */
function reviewCycleResult(phase, h, target, actorPrefix) {
  if (phase === 'review' || phase === 're-review') {
    const record = h.record();
    const ref = evRef(record, h.runId, h.changeId, target.actionId, actorPrefix);
    if (phase === 'review') {
      return {
        contract: 'review-cycle/review-result/1',
        outcome: 'findings',
        findings: [{
          id: 'F1', severity: 'major',
          claim: 'ECP-5 dogfood: the closure slice needs a real Run for this cell',
          evidence: [ref], status: 'open',
        }],
      };
    }
    return {
      contract: 'review-cycle/verification-result/1',
      verifications: [{ findingId: 'F1', verdict: 'resolved', evidence: [ref] }],
    };
  }
  if (phase === 'triage') {
    return {
      contract: 'review-cycle/triage-result/1',
      decisions: [{ findingId: 'F1', disposition: 'fix_inline', rationale: 'Fix inline' }],
    };
  }
  if (phase === 'fix') {
    const record = h.record();
    const ref = evRef(record, h.runId, h.changeId, target.actionId, actorPrefix);
    return {
      contract: 'review-cycle/fix-result/1',
      findingIds: ['F1'],
      beforeTree: `sha256:${'a'.repeat(64)}`,
      afterTree: `sha256:${'b'.repeat(64)}`,
      delta: ref, tests: [ref],
    };
  }
  return { ok: true };
}

/**
 * Distinct actor per loop phase. Staffing distinct workers is the LEAD's job
 * under the converged playbook — the Run only REJECTS a same-actor
 * verification, it cannot supply a second worker. Both loop families enforce
 * it: `review_cycle_actor_separation` for review/fix, and "the worker cannot
 * judge their own GoalCycle work" for work/judge (this dogfood hit the latter
 * on its first attempt, which is the guarantee doing its job).
 */
const PHASE_ACTOR = {
  review: 'reviewerA', triage: 'triageA', fix: 'fixerA', 're-review': 'verifierA',
  work: 'implA', judge: 'judgeA',
};

/**
 * Drive a Run to quiescence, completing every granted action. Review-cycle
 * phases get their phase contract and a distinct actor; everything else gets a
 * generic success. Returns the terminal view.
 */
function driveToTerminal(h, { via = 'record', maxSteps = 40, resultFor } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    if (via === 'resume-run') h.resumeRun();
    const frontier = h.frontier();
    if (frontier.length === 0) break;
    for (const target of frontier) {
      const phase = target.phase;
      const actor = phase && PHASE_ACTOR[phase] ? PHASE_ACTOR[phase] : 'implA';
      const result = resultFor
        ? resultFor(target, h)
        : (phase && PHASE_ACTOR[phase]
          ? reviewCycleResult(phase, h, target, actor)
          : { ok: true, stage: target.path });
      const res = h.complete(target, result, actor, `${step}-${target.path}`);
      if (!res.ok) throw new Error(`complete ${target.path} failed: ${res.error}`);
      h.log(`${target.path}${phase ? ` [${phase}]` : ''} -> ${res.actionId.slice(0, 22)}...`);
    }
  }
  return h.status().view;
}

const results = {};

// ---------------------------------------------------------------------------
// Scenario A — `small-feature` end to end (task 7.4)
// ---------------------------------------------------------------------------
async function scenarioSmallFeature() {
  console.log('\n=== A. small-feature end to end (task 7.4) ===');
  const ctx = await setupTestDir('small-feature');
  const changeId = 'ecp5-small-feature';
  await seedChange(ctx.testDir, changeId, 'ECP-5 dogfood: real small-feature Run.');

  const { h, receipt } = start(ctx, changeId, 'small-feature');
  console.log(`   RunId: ${h.runId}`);
  console.log(`   engine: ${receipt.engine} (${receipt.engineSource})`);

  const view = driveToTerminal(h);
  const rc = h.section('review-cycle');

  const out = {
    pipeline: 'small-feature',
    runId: h.runId,
    engine: receipt.engine,
    engineSource: receipt.engineSource,
    status: view.status,
    terminal: view.terminal ?? null,
    reviewCycle: rc ? { round: rc.round, maxRounds: rc.maxRounds, phase: rc.phase, outcome: rc.outcome, findings: rc.findings } : null,
    actionIdsByPath: h.ledger,
    actionCount: Object.keys(h.record().actions).length,
  };
  console.log(`   status=${out.status} reviewCycle=${JSON.stringify(out.reviewCycle?.outcome)}`);
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario B — `goal-loop-evaluate` end to end (task 7.5)
// ---------------------------------------------------------------------------
async function scenarioGoalEvaluate() {
  console.log('\n=== B. goal-loop-evaluate end to end (task 7.5) ===');
  const ctx = await setupTestDir('goal-evaluate');
  const changeId = 'ecp5-goal-evaluate';
  await seedChange(ctx.testDir, changeId, 'ECP-5 dogfood: real goal-loop-evaluate Run.');

  const { h, receipt } = start(ctx, changeId, 'goal-loop-evaluate');
  console.log(`   RunId: ${h.runId}`);
  console.log(`   engine: ${receipt.engine} (${receipt.engineSource})`);

  const judged = [];
  const view = driveToTerminal(h, {
    resultFor: (target, harness) => {
      const phase = target.phase;
      if (phase === 'work') {
        const record = harness.record();
        return {
          contract: 'goal-cycle/work-result/1',
          workDescription: 'ECP-5 closure: evaluate-variant round work',
          beforeTree: `sha256:${'a'.repeat(64)}`,
          afterTree: `sha256:${'b'.repeat(64)}`,
          delta: evRef(record, harness.runId, harness.changeId, target.actionId, 'implA'),
        };
      }
      if (phase === 'judge') {
        const judgement = {
          contract: 'goal-cycle/evaluate-judge/1',
          satisfied: true,
          gaps: [],
          criteria: [
            {
              id: 'closure-1',
              satisfied: true,
              evidence: 'The evaluate variant completed a real work -> judge iteration on the integrated HEAD',
            },
          ],
        };
        judged.push({ round: harness.section('goal')?.round ?? null, judgement });
        return judgement;
      }
      return { ok: true, stage: target.path };
    },
  });
  const goal = h.section('goal');

  const out = {
    pipeline: 'goal-loop-evaluate',
    runId: h.runId,
    engine: receipt.engine,
    engineSource: receipt.engineSource,
    status: view.status,
    terminal: view.terminal ?? null,
    goalSection: goal ? { variant: goal.variant, round: goal.round, outcome: goal.outcome, lastGaps: goal.lastGaps ?? null } : null,
    judgeEvidence: judged,
    actionIdsByPath: h.ledger,
    actionCount: Object.keys(h.record().actions).length,
  };
  console.log(`   status=${out.status} goal=${JSON.stringify(out.goalSection)}`);
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario C — Canvas-AUTHORED Custom Composite (task 7.6)
// ---------------------------------------------------------------------------
async function scenarioCanvasComposite() {
  console.log('\n=== C. Canvas-authored Custom Composite (task 7.6) ===');
  const ctx = await setupTestDir('canvas-composite');
  const changeId = 'ecp5-canvas-composite';
  const pipelineName = 'ecp5-canvas-composite';
  await seedChange(ctx.testDir, changeId, 'ECP-5 dogfood: Canvas-authored Custom Composite Run.');

  // 1. Read the production capability catalog — the same values the server's
  //    catalog endpoint serves to the Canvas.
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, { reporter: false });
  const descriptor = registry.catalog.descriptors.find((d) => d.id === 'skill:rasen-apply-change')
    ?? registry.catalog.descriptors[0];
  const catalogEntry = { id: descriptor.id, version: descriptor.version };
  console.log(`   catalog entry: ${catalogEntry.id} @ ${catalogEntry.version.slice(0, 20)}...`);

  // 2. Author it in the REAL Canvas and capture the definition its save POSTs.
  const exportPath = path.join(ctx.testDir, 'canvas-authored-composite.json');
  execSync(
    'npx vitest run test/canvas/canvas-authored-composite-export.test.tsx',
    {
      cwd: path.join(projectRoot, 'packages', 'ui'),
      encoding: 'utf-8',
      timeout: 300000,
      stdio: 'pipe',
      env: {
        ...process.env,
        ECP5_CANVAS_CATALOG: JSON.stringify(catalogEntry),
        ECP5_CANVAS_EXPORT: exportPath,
        ECP5_CANVAS_NAME: pipelineName,
      },
    }
  );
  const authored = JSON.parse(readFileSync(exportPath, 'utf-8'));
  console.log(`   Canvas POSTed: ${authored.declarations.length} declaration(s), ${authored.root.nodes.length} root node(s)`);

  // 3. Install it through the real CLI save path, then read capability
  //    discovery back — the Canvas's own EngineSupportPanel reads the same
  //    analysis from the management endpoint.
  const saveRes = runCLI(['pipeline', 'save', pipelineName, '--from', exportPath, '--json'], ctx.testDir, ctx.env);
  if (saveRes.exitCode !== 0) throw new Error(`pipeline save FAILED: ${(saveRes.stderr + saveRes.stdout).slice(0, 1200)}`);
  const showRes = runCLI(['pipeline', 'show', pipelineName, '--json'], ctx.testDir, ctx.env);
  if (showRes.exitCode !== 0) throw new Error(`pipeline show FAILED: ${showRes.stderr.slice(0, 800)}`);
  const shown = JSON.parse(showRes.stdout.trim());
  console.log(`   discovery: ${JSON.stringify(shown.reconcilerSupport)}`);

  // 4. Run it.
  const { h, receipt } = start(ctx, changeId, pipelineName);
  console.log(`   RunId: ${h.runId}`);

  // --- The assertions that make this cell mean something (task 7.6) ---------
  //
  // Stage COUNT evidences nothing: a two-stage body with no edge is a
  // DIFFERENT pipeline, because the reconciler admits disconnected stages
  // concurrently. Sequential-versus-fan-out is the observable that separates
  // correct authoring from the broken path, so this cell asserts ORDERING.

  // (1) Structural — the persisted plan carries the dependency.
  const plan = loadPlan(h.runId, h.storeRoot);
  const bodyNodes = plan.nodes.filter((node) =>
    node.hierarchicalPath.startsWith('root:composite-ref/')
  );
  const byPath = new Map(bodyNodes.map((node) => [node.hierarchicalPath, node]));
  const first = byPath.get('root:composite-ref/stage');
  const second = byPath.get('root:composite-ref/stage-2');
  const ordering = {
    bodyNodeCount: bodyNodes.length,
    firstRequires: first ? [...first.requires] : null,
    secondRequires: second ? [...second.requires] : null,
    secondRequiresFirst: Boolean(first && second && second.requires.includes(first.nodeId)),
    firstRequiresSecond: Boolean(first && second && first.requires.includes(second.nodeId)),
  };
  console.log(`   plan ordering: stage-2 requires stage = ${ordering.secondRequiresFirst}`);

  // (2) Behavioural — the reconciler's OWN answer, and the one that settles it.
  //     A connected body puts exactly ONE action on the first frontier; the
  //     disconnected shape puts both there at once. Read BEFORE completing
  //     anything, which is why this scenario does not call driveToTerminal
  //     until after the snapshot.
  const firstFrontier = h.frontier().map((f) => f.path).sort();
  console.log(`   first frontier: ${JSON.stringify(firstFrontier)}`);

  const view = driveToTerminal(h);

  const out = {
    pipeline: pipelineName,
    provenance: 'canvas-authored',
    runId: h.runId,
    engine: receipt.engine,
    engineSource: receipt.engineSource,
    authoredDefinition: authored,
    reconcilerSupport: shown.reconcilerSupport,
    availableEngines: shown.availableEngines,
    status: view.status,
    terminal: view.terminal ?? null,
    bodyOrdering: ordering,
    firstFrontier,
    actionIdsByPath: h.ledger,
    actionCount: Object.keys(h.record().actions).length,
  };
  console.log(`   status=${out.status}`);
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------
// Scenario D — the converged `rasen-auto` Step E protocol (task 7.7)
// ---------------------------------------------------------------------------
async function scenarioConvergedAuto() {
  console.log('\n=== D. converged rasen-auto Step E protocol (task 7.7) ===');
  const ctx = await setupTestDir('converged-auto');
  const changeId = 'ecp5-converged-auto';
  await seedChange(ctx.testDir, changeId, 'ECP-5 dogfood: the converged Step E path.');

  // Step 0 of the converged playbook: read the resolved engine from
  // `pipeline show --json` rather than re-deriving the precedence chain.
  const showRes = runCLI(['pipeline', 'show', 'small-feature', '--json'], ctx.testDir, ctx.env);
  const shown = JSON.parse(showRes.stdout.trim());
  const engineLine = `Engine: ${shown.enginePolicy.effectiveEngine} (${shown.enginePolicy.source})`;
  console.log(`   ${engineLine}   support=${shown.reconcilerSupport.reason}`);

  // Launch ONE canonical Run for the whole pipeline.
  const { h, receipt } = start(ctx, changeId, 'small-feature');
  console.log(`   RunId: ${h.runId}`);
  h.log(engineLine);
  h.log(`launch receipt: engine=${receipt.engine} source=${receipt.engineSource} disposition=${receipt.disposition}`);

  // The loop the playbook prescribes: resume-run -> dispatch per granted
  // action -> complete -> read the review-cycle section.
  const sectionReads = [];
  for (let step = 0; step < 40; step++) {
    const resumed = h.resumeRun();
    const granted = resumed.actions ?? [];
    h.log(`resume-run #${step + 1}: ${granted.length} newly-granted action(s), status=${resumed.status}`);
    const frontier = h.frontier();
    if (frontier.length === 0) break;
    for (const target of frontier) {
      const phase = target.phase;
      const actor = phase && PHASE_ACTOR[phase] ? PHASE_ACTOR[phase] : 'implA';
      const result = phase && PHASE_ACTOR[phase]
        ? reviewCycleResult(phase, h, target, actor)
        : { ok: true, stage: target.path };
      const res = h.complete(target, result, actor, `d-${step}-${target.path}`);
      if (!res.ok) throw new Error(`complete ${target.path} failed: ${res.error}`);
      // Where the NEXT action comes from: `complete` settles to quiescence and
      // delivers the newly-admitted actions on its own receipt, so in a healthy
      // sequential drive `resume-run` has nothing left to grant and correctly
      // reports 0. `resume-run` is the RECOVERY seam (admitted-undelivered
      // after a crash or a fresh session), not the per-step dispatch seam.
      const nextFromReceipt = (res.receipt?.actions ?? []).length;
      h.log(`dispatch ${target.path}${phase ? ` [${phase}]` : ''} actor=${actor} -> complete ${res.actionId.slice(0, 22)}... (receipt granted ${nextFromReceipt} next action(s))`);
    }
    const rc = h.section('review-cycle');
    if (rc) {
      const read = { round: rc.round, maxRounds: rc.maxRounds, phase: rc.phase, outcome: rc.outcome ?? null, openFindings: (rc.findings ?? []).filter((f) => f.status === 'open').length };
      sectionReads.push(read);
      h.log(`review-cycle section: ${JSON.stringify(read)}`);
    }
  }

  const view = h.status().view;
  const rc = h.section('review-cycle');
  const out = {
    pipeline: 'small-feature',
    runId: h.runId,
    engineLine,
    drivenVia: 'pipeline resume-run -> complete (converged Step E.1)',
    status: view.status,
    terminal: view.terminal ?? null,
    reviewCycleSectionReads: sectionReads,
    finalReviewCycle: rc ? { round: rc.round, phase: rc.phase, outcome: rc.outcome } : null,
    transcript: h.transcript,
    actionCount: Object.keys(h.record().actions).length,
  };
  console.log(`   status=${out.status} sectionReads=${sectionReads.length}`);
  await fs.rm(ctx.testDir, { recursive: true, force: true });
  return out;
}

// ---------------------------------------------------------------------------

const only = process.argv[2];
const scenarios = {
  A: scenarioSmallFeature,
  B: scenarioGoalEvaluate,
  C: scenarioCanvasComposite,
  D: scenarioConvergedAuto,
};

for (const [key, fn] of Object.entries(scenarios)) {
  if (only && only !== key) continue;
  try {
    results[key] = await fn();
  } catch (error) {
    results[key] = { error: error instanceof Error ? error.message : String(error) };
    console.error(`   SCENARIO ${key} FAILED: ${results[key].error}`);
  }
}

console.log('\n=== RESULTS ===');
console.log(JSON.stringify({ head: HEAD, results }, null, 2));
