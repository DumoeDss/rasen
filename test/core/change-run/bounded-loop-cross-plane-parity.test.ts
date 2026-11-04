import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PipelineCommand } from '../../../src/commands/pipeline.js';
import type {
  BoundedLoopLifecycleViewSection,
  ChangeRunView,
} from '../../../src/core/change-run/contracts.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { handleRunDetail } from '../../../src/core/management-api/runs.js';
import { fixtureDigests, startRecord } from './reconciler-fixture.js';

function lifecyclePlan() {
  return createRuntimePlan({
    runId: fixtureDigests.runId,
    pipeline: 'lifecycle-cross-plane',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'done',
    nodes: [{
      kind: 'bounded-loop',
      hierarchicalPath: 'root/loop',
      requires: [],
      limits: { maxIterations: 5, maxActions: 12, budget: 12 },
      lifecycle: {
        version: 1,
        thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
        strategy: { maxAttempts: 0, requireMaterialChange: true },
        exits: {
          iterationLimit: { action: 'exit', outcome: 'iteration-exit' },
          actionLimit: { action: 'fail', outcome: 'action-limit' },
          budgetLimit: { action: 'fail', outcome: 'budget-limit' },
          stalled: { action: 'escalate', outcome: 'stalled' },
          blocked: { action: 'human-required', outcome: 'operator-required' },
          strategyExhausted: { action: 'fail', outcome: 'strategy-exhausted' },
        },
      },
      body: {
        kind: 'composite',
        declarationId: 'lifecycle-body',
        stages: [{
          hierarchicalPath: 'root/loop/stage',
          profilePath: 'declaration:lifecycle-body/node:stage',
          admissionKind: 'agent',
          workspace: { access: 'write' },
          requires: [],
        }],
        outcomes: { repeat: 'continue' },
      },
      outcomes: { clean: 'done', exhausted: 'loop-exhausted' },
    }],
  });
}

function getLifecycle(view: ChangeRunView): BoundedLoopLifecycleViewSection {
  const section = view.sections.find(
    (candidate): candidate is BoundedLoopLifecycleViewSection =>
      candidate.kind === 'bounded-loop-lifecycle' && candidate.version === 1
  );
  if (section === undefined) throw new Error('missing lifecycle section');
  return section;
}

async function captureLog(run: () => Promise<void>): Promise<string> {
  let output = '';
  const spy = vi.spyOn(console, 'log').mockImplementation((...values) => {
    output += `${values.map(String).join(' ')}\n`;
  });
  try {
    await run();
    return output;
  } finally {
    spy.mockRestore();
  }
}

describe('bounded-loop lifecycle cross-plane parity', () => {
  let tempDir: string;
  let oldXdg: string | undefined;
  let oldHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rasen-lifecycle-parity-'));
    oldXdg = process.env.XDG_DATA_HOME;
    oldHome = process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.RASEN_HOME = '';
  });

  afterEach(() => {
    if (oldXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = oldXdg;
    if (oldHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = oldHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes the exact canonical lifecycle section through CLI and Management API', async () => {
    const plan = lifecyclePlan();
    const record = startRecord(plan);
    const projected = projectRunView(record, 'active', plan);
    const expected = getLifecycle(projected);

    const store = createInMemoryRunStore();
    store.create(plan.runId, record);
    const facade = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: record,
      buildAction: () => { throw new Error('inspect must not build actions'); },
    });
    const command = new PipelineCommand(async () => ({
      ctx: { facade, store, plan, initialRecord: record },
      pipeline: { name: plan.pipeline } as never,
      runId: plan.runId as string,
      projectRoot: path.resolve(tempDir, 'project'),
      projectId: 'project-fixture',
      launchKey: 'lifecycle-parity',
    }));
    const cli = JSON.parse((await captureLog(() =>
      command.status('fixture-change', plan.pipeline, { json: true })
    )).trim()) as { view: ChangeRunView };
    expect(getLifecycle(cli.view)).toEqual(expected);

    const runRoot = path.join(tempDir, 'rasen', 'runs');
    const runDir = path.join(runRoot, String(plan.runId).replace(/[^a-z0-9]/gi, '_'));
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, `record-v${record.recordVersion}.json`), JSON.stringify(record));
    writeFileSync(path.join(runDir, 'plan.json'), JSON.stringify(plan));
    const management = await handleRunDetail('fixture-change', plan.runId, undefined, null);
    expect(management.ok).toBe(true);
    if (!management.ok) return;
    expect(getLifecycle(management.view)).toEqual(expected);

    expect(expected).toMatchObject({
      loopPath: 'root/loop',
      bodyKind: 'composite',
      state: 'running',
      iteration: 1,
      limits: {
        iterations: { used: 0, max: 5 },
        actions: { used: 0, max: 12 },
        budget: { used: 0, max: 12 },
      },
      stallStreak: 0,
      blockedStreak: 0,
      strategy: { attempts: 0, maxAttempts: 0 },
    });
  });
});
