/**
 * Dogfood: drive a real bug-fix Run through the FULL ReviewCycle via CLI.
 *
 * Flow: start → propose → apply → review(Major) → triage → fix → re-review(clean)
 * Plus: same-actor rejection verification.
 */
import { execSync } from 'child_process';
import { promises as fs, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Import from compiled dist (ensures correct evidence/actor/completion digests)
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
const testDir = path.join(projectRoot, 'test-dogfood-review-cycle-tmp');
const dataDir = path.join(testDir, 'global-data');
const storeRoot = path.join(dataDir, 'rasen', 'runs');

await fs.rm(testDir, { recursive: true, force: true });
await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });

const env = { ...process.env, XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

function runCLI(args) {
  try {
    const out = execSync(`node "${cliEntry}" ${args.join(' ')}`, { cwd: testDir, env, encoding: 'utf-8', timeout: 60000 });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { exitCode: e.status ?? 1, stdout: typeof e.stdout === 'string' ? e.stdout : '', stderr: typeof e.stderr === 'string' ? e.stderr : String(e) };
  }
}

function loadHeadRecord(runId) {
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const runDir = path.join(storeRoot, dirName);
  const files = readdirSync(runDir);
  let best = -1;
  for (const f of files) { const m = /^record-v(\d+)\.json$/.exec(f); if (m) { const v = +m[1]; if (v > best) best = v; } }
  if (best === -1) throw new Error(`No record for ${runId}`);
  return decodeCanonicalRunRecord(JSON.parse(readFileSync(path.join(runDir, `record-v${best}.json`), 'utf-8')));
}

function applyStimulus(runId, stimulus) {
  const record = loadHeadRecord(runId);
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) throw new Error(`stimulus ${stimulus.kind} failed: ${result.failure.message}`);
  const dirName = runId.replace(/[^a-z0-9]/gi, '_');
  const newPath = path.join(storeRoot, dirName, `record-v${result.record.recordVersion}.json`);
  writeFileSync(newPath, JSON.stringify(result.record, null, 2));
  return result.record;
}

function observeEffects(runId) {
  const record = loadHeadRecord(runId);
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
        });
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

function buildCompletion(record, runId, changeId, actionId, invocationId, result, actorPrefix) {
  const actor = makeActor(actorPrefix);
  const attContent = Buffer.from('{"signed":true}');
  const attDigest = `sha256:${createHash('sha256').update(attContent).digest('hex')}`;

  const evRef = buildEvidenceRef({
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

function evRefForFinding(record, runId, changeId, actionId, actorPrefix) {
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

const changeId = 'dogfood-rc';
const ids = {};

console.log('=== Starting bug-fix Run ===');
let res = runCLI(['pipeline', 'start', changeId, 'bug-fix', '--json']);
if (res.exitCode !== 0) { console.error('FAIL:', res.stderr); process.exit(1); }
const runId = JSON.parse(res.stdout.trim()).runId;
console.log('RunId:', runId);
ids.runId = runId;

function getActive() {
  const record = loadHeadRecord(runId);
  const active = Object.values(record.actions).find(a => a.state === 'active');
  return { record, active };
}

function complete(actorPrefix, result, label) {
  // Observe admitted effects before completing (kernel-internal step)
  observeEffects(runId);
  const { record, active } = getActive();
  if (!active) {
    console.error(`No active action for ${label}`);
    const rcProgress = record.terminal;
    console.log('Terminal:', JSON.stringify(rcProgress));
    process.exit(1);
  }
  const actionId = active.action.actionId;
  const invocationId = active.action.invocationId;
  const body = buildCompletion(record, runId, changeId, actionId, invocationId, result, actorPrefix);
  const file = path.join(testDir, `c-${label}.json`);
  writeFileSync(file, JSON.stringify(body));
  res = runCLI(['pipeline', 'complete', changeId, '--run', runId, '--from', file, '--json']);
  if (res.exitCode !== 0) {
    console.error(`  ${label} FAILED:`, res.stderr.slice(0, 300));
    return false;
  }
  console.log(`  ${label}: OK (actionId=${actionId.slice(0, 20)}...)`);
  ids[`${label}ActionId`] = actionId;
  return true;
}

// Phase: propose
console.log('\n=== propose ===');
complete('propose', { ok: true }, 'propose');

// Phase: apply
console.log('\n=== apply ===');
complete('apply', { ok: true }, 'apply');

// Phase: review (Major finding, actor: reviewerA)
console.log('\n=== review (Major finding) ===');
{
  const { record, active } = getActive();
  const reviewEvRef = evRefForFinding(record, runId, changeId, active.action.actionId, 'reviewerA');
  complete('reviewerA', {
    contract: 'review-cycle/review-result/1',
    outcome: 'findings',
    findings: [{
      id: 'F1', severity: 'major',
      claim: 'Dogfood: edge case in error handling path not covered by tests',
      evidence: [reviewEvRef], status: 'open',
    }],
  }, 'review');
}

// Phase: triage
console.log('\n=== triage ===');
complete('triageA', {
  contract: 'review-cycle/triage-result/1',
  decisions: [{ findingId: 'F1', disposition: 'fix_inline', rationale: 'Fix inline with test coverage' }],
}, 'triage');

// Phase: fix (actor: fixerA — DIFFERENT from reviewer)
console.log('\n=== fix (fixerA) ===');
{
  const { record, active } = getActive();
  const fixEvRef = evRefForFinding(record, runId, changeId, active.action.actionId, 'fixerA');
  complete('fixerA', {
    contract: 'review-cycle/fix-result/1',
    findingIds: ['F1'],
    beforeTree: `sha256:${'a'.repeat(64)}`,
    afterTree: `sha256:${'b'.repeat(64)}`,
    delta: fixEvRef, tests: [fixEvRef],
  }, 'fix');
}

// Phase: re-review — first try SAME actor as fixer (expecting rejection)
console.log('\n=== re-review (SAME-ACTOR ATTEMPT — should fail) ===');
{
  const { record, active } = getActive();
  if (active) {
    const verEvRef = evRefForFinding(record, runId, changeId, active.action.actionId, 'fixerA');
    const body = buildCompletion(record, runId, changeId, active.action.actionId, active.action.invocationId, {
      contract: 'review-cycle/verification-result/1',
      verifications: [{ findingId: 'F1', verdict: 'resolved', evidence: [verEvRef] }],
    }, 'fixerA');
    const file = path.join(testDir, 'c-rereview-same-actor.json');
    writeFileSync(file, JSON.stringify(body));
    const sameActorRes = runCLI(['pipeline', 'complete', changeId, '--run', runId, '--from', file, '--json']);
    if (sameActorRes.exitCode !== 0 && sameActorRes.stderr.includes('actor_separation')) {
      console.log('  SAME-ACTOR REJECTION CONFIRMED: fixer cannot verify own fix');
    } else {
      console.log('  WARNING: same-actor attempt exitCode:', sameActorRes.exitCode, 'stderr:', sameActorRes.stderr.slice(0, 200));
    }
  }
}

// Phase: re-review (actor: verifierA — INDEPENDENT from fixer)
console.log('\n=== re-review (verifierA, independent) ===');
{
  const { record, active } = getActive();
  const verEvRef = evRefForFinding(record, runId, changeId, active.action.actionId, 'verifierA');
  complete('verifierA', {
    contract: 'review-cycle/verification-result/1',
    verifications: [{ findingId: 'F1', verdict: 'resolved', evidence: [verEvRef] }],
  }, 're-review');
}

// Final status
console.log('\n=== Final status ===');
res = runCLI(['pipeline', 'status', changeId, 'bug-fix', '--json']);
const finalJson = JSON.parse(res.stdout.trim());
console.log('Status:', finalJson.view.status);
console.log('Terminal:', JSON.stringify(finalJson.view.terminal));

const rcSection = finalJson.view.sections.find(s => s.kind === 'review-cycle');
if (rcSection) {
  console.log('\nReviewCycle:');
  console.log('  round:', rcSection.round);
  console.log('  phase:', rcSection.phase);
  console.log('  outcome:', rcSection.outcome);
  console.log('  findings:', JSON.stringify(rcSection.findings?.map(f => ({ id: f.id, severity: f.severity, status: f.status })), null, 2));
}

const finalRecord = loadHeadRecord(runId);
console.log('\nActions:', Object.keys(finalRecord.actions).length);
for (const a of Object.values(finalRecord.actions)) {
  console.log(`  ${a.action.nodeId.slice(0, 30)}... state=${a.state}`);
}

// Actor identityDigests
const reviewer = makeActor('reviewerA');
const fixer = makeActor('fixerA');
const verifier = makeActor('verifierA');
console.log('\nActor identityDigests:');
console.log('  reviewer:', reviewer.identityDigest);
console.log('  fixer:', fixer.identityDigest);
console.log('  verifier:', verifier.identityDigest);
console.log('  fixer !== verifier:', fixer.identityDigest !== verifier.identityDigest);

console.log('\n=== RESULTS ===');
console.log(JSON.stringify({
  runId,
  ...ids,
  reviewerDigest: reviewer.identityDigest,
  fixerDigest: fixer.identityDigest,
  verifierDigest: verifier.identityDigest,
  status: finalJson.view.status,
  terminal: finalJson.view.terminal,
  actionCount: Object.keys(finalRecord.actions).length,
  reviewCycleSection: rcSection ? { round: rcSection.round, phase: rcSection.phase, outcome: rcSection.outcome } : null,
}, null, 2));

// Cleanup
await fs.rm(testDir, { recursive: true, force: true });
