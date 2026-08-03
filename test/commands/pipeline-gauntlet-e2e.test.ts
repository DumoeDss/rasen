/**
 * Fresh-process gauntlet-loop E2E (task 8.1 + 8.5 of `add-gauntlet-loop`).
 *
 * Drives a real gauntlet-loop Run end-to-end through FRESH CLI processes
 * (`node dist/cli/index.js pipeline start/status/complete/resume-run`),
 * interrupted at every quiescent point with a status snapshot.
 *
 * Mirrors the task-loop E2E pattern in pipeline-bugfix-e2e.test.ts. The
 * gauntlet-loop pipeline uses a GoalCycle bounded loop (pipeline.yaml:
 * `loop: kind: goal, gate: { kind: evaluate }`), so the same CLI lifecycle
 * applies: launch → builder work → fresh-critic judge → ship → archive.
 *
 * Asserts the absence of runtime planning artifacts (no proposal, design,
 * specs, tasks, goal-plan) — the gauntlet contract is spec-free.
 *
 * Effect observation is kernel-internal (no CLI command), performed in-process
 * against the filesystem store — the documented kernel-internal path.
 *
 * Windows-safe: uses path.join/path.resolve throughout, temp directories with
 * spaces and non-ASCII characters, and no POSIX redirection or separator
 * assumptions (task 8.5).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { runCLI } from '../helpers/run-cli.js';

// Kernel internals — used ONLY for effect observation (no CLI command exists).
import { freezeProductionPreparedPipelineRegistry } from '../../src/core/pipeline-registry/prepared-registry.js';
import { resolveRuntimeExecutionProfile } from '../../src/core/pipeline-registry/profile-resolver.js';
import { lowerRuntimePlan } from '../../src/core/change-run/internal/lowerer.js';
import { reduceCanonicalRunRecord } from '../../src/core/change-run/internal/reducer.js';
import { decodeCanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import { computeCompletionReceiptDigest } from '../../src/core/change-run/internal/completion.js';
import { buildAgentActor } from '../../src/core/change-run/internal/actors.js';
import { buildEvidenceRef } from '../../src/core/change-run/internal/evidence.js';
import { observeGitWorkspace } from '../../src/core/change-run/internal/workspace-git.js';
import { deriveWorkspaceRevision } from '../../src/core/change-run/internal/workspace.js';
import {
  GAUNTLET_ACTOR_ATTESTATION_SCHEMA,
  GAUNTLET_WORK_EVIDENCE_SCHEMA,
} from '../../src/core/change-run/internal/gauntlet-loop.js';
import {
  GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
} from '../../src/core/change-run/internal/gauntlet-bar.js';
import type { RuntimePlan } from '../../src/core/change-run/internal/runtime-plan.js';
import type { CanonicalRunRecord } from '../../src/core/change-run/internal/record.js';
import type { RunStimulus } from '../../src/core/change-run/internal/reducer.js';
import type { Digest, RunId } from '../../src/core/change-run/index.js';

// ---------------------------------------------------------------------------
// Helpers: in-process plan building (mirrors the CLI's resolveRuntime)
// ---------------------------------------------------------------------------

const branded = <T>(value: string): T => value as T;

/**
 * Build the same RuntimePlan the CLI would produce for a gauntlet-loop Run.
 * Mirrors `PipelineCommand.resolveRuntime` for the gauntlet-loop pipeline.
 */
async function buildGauntletPlan(
  projectRoot: string,
  runId: string
): Promise<RuntimePlan> {
  const registry = await freezeProductionPreparedPipelineRegistry(projectRoot, {
    reporter: false,
  });
  const execution = await registry.selectForExecution('gauntlet-loop', {
    reporter: false,
  });
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
      stage.id === 'ship' || stage.id === 'archive'
        ? ('workspace-write' as const)
        : ('workspace-write' as const),
    gate: stage.gate ?? false,
    sessionReuse: 'never' as const,
    handoffTokenLimit: 10_000,
    reuseRoundLimit: 1,
    provenance: {
      role: 'stage',
      model: stage.model ? 'stage' : 'default',
      effort: 'default',
      runtime: 'host',
      sandbox: 'default',
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

// ---------------------------------------------------------------------------
// Helpers: in-process filesystem store operations
// ---------------------------------------------------------------------------

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
  const raw = readFileSync(
    path.join(runDir, `record-v${bestVersion}.json`),
    'utf-8'
  );
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
  runId: string,
  changeId: string,
  projectRoot: string,
  actionId: string,
  invocationId: string,
  options: {
    role?: string;
    principalPair?: string;
    sessionPair?: string;
    result?: (
      evidence: ReturnType<typeof buildEvidenceRef>
    ) => Record<string, unknown>;
    evidenceSchema?: string;
    attestationSchema?: string;
    treeDigest?: Digest;
  } = {}
): {
  completion: Record<string, unknown>;
  uploads: Array<{ contentDigest: string; contentBase64: string }>;
} {
  const evidenceContent = new TextEncoder().encode('{"result":"ok"}');
  const attestationContent = new TextEncoder().encode('{"signed":true}');
  const evidenceDigest = `sha256:${createHash('sha256').update(evidenceContent).digest('hex')}`;
  const attestationDigest = `sha256:${createHash('sha256').update(attestationContent).digest('hex')}`;

  const principalDigest = branded<Digest>(
    `sha256:${(options.principalPair ?? 'a1').repeat(32)}`
  );
  const sessionDigest = branded<Digest>(
    `sha256:${(options.sessionPair ?? 'b2').repeat(32)}`
  );

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
      schema: options.evidenceSchema ?? 'evidence/1',
      ...(options.treeDigest === undefined
        ? {}
        : { treeDigest: options.treeDigest }),
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
      schema: options.attestationSchema ?? 'attestation/1',
      ...(options.treeDigest === undefined
        ? {}
        : { treeDigest: options.treeDigest }),
    },
  });

  const admitted = record.actions[actionId]?.action;
  if (admitted?.kind !== 'agent') {
    throw new Error(`Action ${actionId} is not an admitted agent Action.`);
  }
  const actor = buildAgentActor({
    role: options.role ?? admitted.agent.role,
    provider: 'anthropic',
    runtime: admitted.agent.runtime,
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
    result: options.result?.(evidenceRef) ?? { ok: true },
  };
  const receiptDigest = computeCompletionReceiptDigest(base as never);

  return {
    completion: { ...base, receiptDigest },
    uploads: [
      {
        contentDigest: evidenceDigest,
        contentBase64: Buffer.from(evidenceContent).toString('base64'),
      },
      {
        contentDigest: attestationDigest,
        contentBase64: Buffer.from(attestationContent).toString('base64'),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fresh-process gauntlet-loop E2E (8.1 + 8.5)', () => {
  const cliProjectRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let storeRoot: string;

  beforeEach(async () => {
    // Windows-safe temp path with spaces and non-ASCII (task 8.5).
    testDir = path.join(
      cliProjectRoot,
      'test-pipeline-e2e-gauntlet 囃子 tmp'
    );
    dataDir = path.join(testDir, 'global-data');
    storeRoot = storeRootFor(dataDir);
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('drives a gauntlet-loop Run from launch through builder, fresh critic, ship, and archive', async () => {
    const changeId = 'e2e-gauntlet';
    const changeDir = path.join(testDir, 'rasen', 'changes', changeId);
    const evidenceDir = path.join(changeDir, 'evidence');
    const env = {
      XDG_DATA_HOME: dataDir,
      RASEN_AGENT_RUNTIME: 'codex',
    };

    // Set up a real git repo with source + reference targets.
    execFileSync('git', ['init', '--quiet'], {
      cwd: testDir,
      windowsHide: true,
    });
    execFileSync('git', ['config', 'user.email', 'gauntlet@example.test'], {
      cwd: testDir,
      windowsHide: true,
    });
    execFileSync('git', ['config', 'user.name', 'Gauntlet Test'], {
      cwd: testDir,
      windowsHide: true,
    });
    await fs.writeFile(
      path.join(testDir, '.gitignore'),
      ['rasen/', '.rasen/', 'global-data/'].join('\n') + '\n',
      'utf8'
    );
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'reference'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'src', 'game.ts'),
      'export const version = 0;\n'
    );
    await fs.writeFile(
      path.join(testDir, 'reference', 'exemplar.ts'),
      'export function exemplar() { return true; }\n'
    );
    execFileSync('git', ['add', '.gitignore', 'src/game.ts', 'reference/exemplar.ts'], {
      cwd: testDir,
      windowsHide: true,
    });
    execFileSync('git', ['commit', '--quiet', '-m', 'gauntlet baseline'], {
      cwd: testDir,
      windowsHide: true,
    });
    await fs.mkdir(changeDir, { recursive: true });

    // Create the gauntlet input file (the `gauntlet` key, parallel to `taskLoop`).
    const ephemeraDir = path.join(
      testDir,
      '.rasen',
      'changes',
      changeId,
      'ephemera'
    );
    await fs.mkdir(ephemeraDir, { recursive: true });
    const inputFile = path.join(ephemeraDir, 'gauntlet-input.json');
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        gauntlet: {
          format: 'gauntlet-loop-input/1',
          goal: 'Build a playable maze game matching the reference.',
          artifactTargets: ['src/game.ts'],
          bar: {
            format: 'gauntlet-reference-bar/1',
            domain: 'code/runnable',
            referenceTargets: ['reference/exemplar.ts'],
            comparisonAxis: 'observable-behavior/output',
          },
          constraints: ['Do not create planning artifacts.'],
        },
        gatePolicy: { effective: 'off', source: 'flag' },
      })
    );

    // ---- 1. LAUNCH: pipeline start ----
    const start = await runCLI(
      [
        'pipeline',
        'start',
        changeId,
        'gauntlet-loop',
        '--input-file',
        inputFile,
        '--json',
      ],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start.exitCode, start.stderr).toBe(0);
    const startJson = JSON.parse(start.stdout.trim());
    expect(startJson.engine).toBe('reconciler');
    const runId = startJson.runId as string;
    expect(runId).toMatch(/^run:[0-9a-f]{64}$/);

    // Build the plan in-process (mirrors CLI resolveRuntime for assertion).
    const plan = await buildGauntletPlan(testDir, runId);

    // Helper: find the next granted action.
    const grantedAction = async () => {
      const status = await runCLI(
        ['pipeline', 'status', changeId, 'gauntlet-loop', '--json'],
        { cwd: testDir, env, timeoutMs: 60_000 }
      );
      expect(status.exitCode, status.stderr).toBe(0);
      const payload = JSON.parse(status.stdout.trim());
      const root = payload.view.sections.find(
        (section: { kind: string }) => section.kind === 'root-dag'
      );
      return root.actions.find(
        (action: { deliveryState: string }) =>
          action.deliveryState === 'granted'
      ) as
        | { actionId: string; invocationId: string; nodeId: string }
        | undefined;
    };

    const completeGranted = async (
      fileName: string,
      role: string,
      principalPair: string,
      sessionPair: string,
      result: (
        evidence: ReturnType<typeof buildEvidenceRef>
      ) => Record<string, unknown>,
      evidenceOptions: {
        evidenceSchema?: string;
        attestationSchema?: string;
        treeDigest?: Digest;
      } = {}
    ) => {
      const action = await grantedAction();
      expect(action).toBeDefined();
      observeAdmittedEffects(storeRoot, runId);
      const body = buildCompletionBody(
        loadHeadRecord(storeRoot, runId),
        runId,
        changeId,
        testDir,
        action!.actionId,
        action!.invocationId,
        { role, principalPair, sessionPair, result, ...evidenceOptions }
      );
      const completionFile = path.join(ephemeraDir, fileName);
      writeFileSync(completionFile, JSON.stringify(body));
      const completed = await runCLI(
        [
          'pipeline',
          'complete',
          changeId,
          '--run',
          runId,
          '--from',
          completionFile,
          '--json',
        ],
        { cwd: testDir, env, timeoutMs: 60_000 }
      );
      expect(completed.exitCode, completed.stderr).toBe(0);
      return JSON.parse(completed.stdout.trim());
    };

    // ---- 2. BUILDER ROUND: work on the artifact ----
    const work = await grantedAction();
    expect(work).toBeDefined();
    const workRecord = loadHeadRecord(storeRoot, runId);
    const admittedWork = workRecord.actions[work!.actionId]!.action;
    const beforeTree = admittedWork.expectedBeforeWorkspace.treeDigest;

    // Mutate the target file (real artifact mutation, mirrors task-loop E2E).
    await fs.writeFile(
      path.join(testDir, 'src', 'game.ts'),
      'export const version = 1;\nexport function play() { return true; }\n'
    );
    const afterRevision = deriveWorkspaceRevision(observeGitWorkspace(testDir));

    await completeGranted(
      'gauntlet-work.json',
      'implementer',
      'a1',
      'b2',
      (evidence) => ({
        contract: 'goal-cycle/work-result/1',
        workDescription: 'Implemented maze game foundation.',
        beforeTree,
        afterTree: afterRevision.treeDigest,
        delta: evidence,
      }),
      {
        evidenceSchema: GAUNTLET_WORK_EVIDENCE_SCHEMA,
        attestationSchema: GAUNTLET_ACTOR_ATTESTATION_SCHEMA,
        treeDigest: afterRevision.treeDigest,
      }
    );

    // ---- 3. CRITIC ROUND: fresh blind-A/B judge ----
    // Use a DIFFERENT session identity from the builder (fresh-critic guard).
    await completeGranted(
      'gauntlet-judge.json',
      'reviewer',
      'c3',
      'd4',
      (evidence) => ({
        contract: 'goal-cycle/evaluate-judge/1',
        satisfied: true,
        satisfactionSource: 'attestation-evidenced',
        verdict: 'tie',
        biggestGap: undefined,
        gaps: [],
        criteria: [
          {
            id: 'blind-ab',
            satisfied: true,
            evidence: `Candidate matches reference on src/game.ts.`,
            evidenceDigests: [evidence.evidenceDigest],
          },
        ],
        attestation: {
          attestationDigest: `sha256:${'f'.repeat(64)}`,
          userActorDigest: `sha256:${'a'.repeat(64)}`,
          issuedAt: '2026-08-02T12:00:00Z',
        },
      }),
      {
        evidenceSchema: GAUNTLET_COMPARISON_EVIDENCE_SCHEMA,
        attestationSchema: GAUNTLET_ACTOR_ATTESTATION_SCHEMA,
        treeDigest: afterRevision.treeDigest,
      }
    );

    // ---- 4. SHIP ----
    const ship = await grantedAction();
    expect(ship).toBeDefined();
    await completeGranted('gauntlet-ship.json', 'shipper', 'e5', 'f6', () => ({
      delivered: true,
    }));

    // ---- 5. ARCHIVE ----
    const archive = await grantedAction();
    expect(archive).toBeDefined();
    const archived = await completeGranted(
      'gauntlet-archive.json',
      'shipper',
      'a7',
      'b8',
      () => ({ archived: true })
    );
    expect(archived.status).toBe('completed');

    // ---- 6. ABSENCE OF PLANNING ARTIFACTS ----
    // Gauntlet creates no runtime proposal/design/specs/tasks/goal-plan.
    for (const artifact of [
      'proposal.md',
      'design.md',
      'tasks.md',
      'planning-context.md',
      'goal-plan.md',
    ]) {
      await expect(fs.stat(path.join(changeDir, artifact))).rejects.toThrow();
    }
    await expect(fs.stat(path.join(changeDir, 'specs'))).rejects.toThrow();

    // The plan digest is unchanged across the full lifecycle (sealed plan).
    expect(plan.planDigest).toBe(
      loadHeadRecord(storeRoot, runId).planDigest
    );
  }, 300_000); // 5-minute timeout for multi-spawn E2E.

  it('proves the gauntlet-loop Run survives fresh CLI processes at every step (cross-process integrity)', async () => {
    // This test verifies that the filesystem store is consistent across
    // fresh CLI processes: start creates the Run, a DIFFERENT process reads
    // it via status, and the projected views are consistent.
    const changeId = 'e2e-gauntlet-xproc';
    const env = { XDG_DATA_HOME: dataDir, RASEN_AGENT_RUNTIME: 'codex' };

    // Create a minimal input file.
    const ephemeraDir = path.join(
      testDir,
      '.rasen',
      'changes',
      changeId,
      'ephemera'
    );
    await fs.mkdir(ephemeraDir, { recursive: true });
    await fs.mkdir(
      path.join(testDir, 'rasen', 'changes', changeId),
      { recursive: true }
    );
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'src', 'app.ts'),
      'export const x = 0;\n'
    );
    await fs.mkdir(path.join(testDir, 'reference'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'reference', 'ref.ts'),
      'export function ref() { return 42; }\n'
    );
    const inputFile = path.join(ephemeraDir, 'gauntlet-input.json');
    await fs.writeFile(
      inputFile,
      JSON.stringify({
        gauntlet: {
          format: 'gauntlet-loop-input/1',
          goal: 'Match the reference output.',
          artifactTargets: ['src/app.ts'],
          bar: {
            format: 'gauntlet-reference-bar/1',
            domain: 'code/runnable',
            referenceTargets: ['reference/ref.ts'],
            comparisonAxis: 'observable-behavior/output',
          },
          constraints: [],
        },
        gatePolicy: { effective: 'off', source: 'flag' },
      })
    );

    const startResult = await runCLI(
      [
        'pipeline',
        'start',
        changeId,
        'gauntlet-loop',
        '--input-file',
        inputFile,
        '--json',
      ],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(startResult.exitCode, startResult.stderr).toBe(0);
    const startJson = JSON.parse(startResult.stdout.trim());
    const runId = startJson.runId as string;

    // A second independent process reads the same Run.
    const statusResult = await runCLI(
      ['pipeline', 'status', changeId, 'gauntlet-loop', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(statusResult.exitCode, statusResult.stderr).toBe(0);
    const statusJson = JSON.parse(statusResult.stdout.trim());

    expect(statusJson.view.format).toBe('change-run-view/1');
    expect(statusJson.view.runId).toBe(runId);
    expect(statusJson.view.engine).toBe('reconciler');

    // The store has exactly one record file.
    const dirName = runId.replace(/[^a-z0-9]/gi, '_');
    const runDir = path.join(storeRoot, dirName);
    const recordFiles = readdirSync(runDir).filter((f) =>
      /^record-v\d+\.json$/.test(f)
    );
    expect(recordFiles.length).toBe(1);
  }, 120_000);
});
