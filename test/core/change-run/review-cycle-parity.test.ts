/**
 * Review-cycle section parity test (task 8.5 of `ecp-review-cycle`).
 *
 * Asserts that the `review-cycle/1` section is projected identically across
 * the two planes that have access to the RuntimePlan:
 *  (a) pure projection `projectRunView(record, state, plan)` — the baseline
 *  (b) CLI `status` JSON output via PipelineCommand (test-injected runtime)
 *
 * The management API plane (`handleRunDetail`) loads the sealed RuntimePlan
 * from `plan.json` persisted alongside the Record, so it projects the SAME
 * review-cycle section as the CLI. This test asserts full three-way parity:
 * projection baseline, CLI status, and management API all emit identical
 * review-cycle sections.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { RuntimePlan, RuntimePlanInput } from '../../../src/core/change-run/internal/runtime-plan.js';
import { PipelineCommand } from '../../../src/commands/pipeline.js';
import { handleRunDetail } from '../../../src/core/management-api/runs.js';
import {
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { ChangeRunView, ReviewCycleViewSection } from '../../../src/core/change-run/contracts.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RunId, Digest } from '../../../src/core/change-run/index.js';
import { fixtureRuntimeLoop } from './bounded-loop-fixture.js';

const branded = <T>(value: string): T => value as T;
const digest = (char: string) => branded<Digest>(`sha256:${char.repeat(64)}`);

/**
 * Build a RuntimePlan with a single bounded-loop (review-cycle body).
 * This is the simplest plan that causes the projector to emit a
 * review-cycle/1 section alongside the root-dag/1 section.
 */
function reviewCyclePlanInput(maxIterations = 3): RuntimePlanInput {
  return {
    runId: fixtureDigests.runId,
    pipeline: 'review-cycle-parity',
    planDigest: fixtureDigests.planDigest,
    profileDigest: fixtureDigests.profileDigest,
    sourceRevisionDigest: fixtureDigests.sourceRevisionDigest,
    capabilityDigest: fixtureDigests.capabilityDigest,
    policyDigest: fixtureDigests.policyDigest,
    implicitFinishOutcome: 'review-clean',
    nodes: [
      {
        kind: 'bounded-loop',
        hierarchicalPath: 'root/review-cycle',
        requires: [],
        ...fixtureRuntimeLoop(maxIterations, maxIterations * 16, 'review_cycle_exhausted'),
        body: {
          kind: 'review-cycle',
          phases: [
            {
              phase: 'review',
              profilePath: 'declaration:review-cycle/node:review',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
            {
              phase: 'triage',
              profilePath: 'declaration:review-cycle/node:triage',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
            {
              phase: 'fix',
              profilePath: 'declaration:review-cycle/node:fix',
              admissionKind: 'agent',
              workspace: { access: 'write' },
            },
            {
              phase: 're-review',
              profilePath: 'declaration:review-cycle/node:re-review',
              admissionKind: 'agent',
              workspace: { access: 'read' },
            },
          ],
        },
        outcomes: {
          clean: 'clean',
          exhausted: 'review_cycle_exhausted',
        },
      },
    ],
  };
}

function reviewCyclePlan(maxIterations = 3): RuntimePlan {
  return createRuntimePlan(reviewCyclePlanInput(maxIterations));
}

/** Extract the review-cycle section comparable fields from a ChangeRunView. */
function reviewCycleFields(view: ChangeRunView) {
  const rc = view.sections.find(
    (s): s is ReviewCycleViewSection => s.kind === 'review-cycle'
  );
  if (!rc) return null;
  return {
    kind: rc.kind,
    version: rc.version,
    loopPath: rc.loopPath,
    round: rc.round,
    phase: rc.phase,
    outcome: rc.outcome,
    maxRounds: rc.maxRounds,
    findingsCount: rc.findings.length,
    waitReason: rc.waitReason,
  };
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  let captured = '';
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    captured += args.map((s) => String(s)).join(' ') + '\n';
  });
  try {
    await fn();
    return captured;
  } finally {
    spy.mockRestore();
  }
}

describe('review-cycle section parity (8.5)', () => {
  let xdgBackup: string | undefined;
  let rasenHomeBackup: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rasen-rc-parity-'));
    xdgBackup = process.env.XDG_DATA_HOME;
    rasenHomeBackup = process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = tempDir;
    process.env.RASEN_HOME = '';
  });

  afterEach(() => {
    if (xdgBackup === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = xdgBackup;
    if (rasenHomeBackup === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = rasenHomeBackup;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('projects the same review-cycle section across projection and CLI status', async () => {
    const plan = reviewCyclePlan(3);
    const record: CanonicalRunRecord = startRecord(plan);

    // --- (a) Pure projection with plan: the baseline ---
    const projectedView = projectRunView(record, 'active', plan);
    const expectedRC = reviewCycleFields(projectedView);
    expect(expectedRC).not.toBeNull();
    expect(expectedRC!.kind).toBe('review-cycle');
    expect(expectedRC!.version).toBe(1);
    expect(expectedRC!.maxRounds).toBe(3);
    expect(expectedRC!.round).toBe(1);
    expect(expectedRC!.phase).toBe('review');

    // Shared mechanics compose with the root and review-domain sections.
    expect(projectedView.sections.length).toBe(3);
    expect(projectedView.sections).toContainEqual(
      expect.objectContaining({
        kind: 'bounded-loop-lifecycle',
        version: 1,
        loopPath: 'root/review-cycle',
        bodyKind: 'review-cycle',
      })
    );

    // --- (b) CLI status via PipelineCommand (test-injected runtime with plan) ---
    const store = createInMemoryRunStore();
    store.create(plan.runId, record);
    const facade = createChangePipelineRuntime({
      store,
      plan,
      initialRecord: record,
      buildAction: () => {
        throw new Error('buildAction not called by inspect');
      },
    });
    const command = new PipelineCommand(async () => ({
      ctx: {
        facade,
        store,
        plan,
        initialRecord: store.load(plan.runId),
      },
      pipeline: { name: plan.pipeline } as never,
      runId: plan.runId as string,
      projectRoot: '/root',
      projectId: 'project-fixture',
      launchKey: 'parity-test',
    }));
    const cliOutput = await captureLog(() =>
      command.status('fixture-change', plan.pipeline, { json: true })
    );
    const cliJson = JSON.parse(cliOutput.trim());
    const cliView = cliJson.view as ChangeRunView;
    expect(reviewCycleFields(cliView)).toEqual(expectedRC);

    // The root-dag section must also be identical (guards against accidental
    // divergence in the projection path).
    const projectedRoot = projectedView.sections.find(
      (s) => s.kind === 'root-dag'
    );
    const cliRoot = cliView.sections.find((s) => s.kind === 'root-dag');
    expect(cliRoot).toEqual(projectedRoot);
  });

  it('management API projects the same review-cycle section when plan is persisted (Major-2)', async () => {
    const plan = reviewCyclePlan(3);
    const record: CanonicalRunRecord = startRecord(plan);

    // The management API handler reads from the filesystem store without a
    // plan. The review-cycle section is additive — absent without the plan.
    const storeRoot = path.join(tempDir, 'rasen', 'runs');
    const dirName = (record.runId as string).replace(/[^a-z0-9]/gi, '_');
    const runDir = path.join(storeRoot, dirName);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, `record-v${record.recordVersion}.json`),
      JSON.stringify(record, null, 2)
    );
    // Persist the plan alongside the Record (Major-2 fix).
    writeFileSync(
      path.join(runDir, 'plan.json'),
      JSON.stringify(plan, null, 2)
    );
    const detail = await handleRunDetail(
      'fixture-change',
      record.runId as string,
      undefined,
      null
    );
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error('mgmt detail failed');
    // The management API view has a valid root-dag section.
    const mgmtRoot = detail.view.sections.find(
      (s) => s.kind === 'root-dag'
    );
    expect(mgmtRoot).toBeDefined();
    // Major-2 fix: the review-cycle section IS now present because the plan
    // is persisted alongside the Record and loaded by the management API.
    const mgmtRC = detail.view.sections.find(
      (s) => s.kind === 'review-cycle'
    );
    expect(mgmtRC).toBeDefined();
    // The section must match the baseline projection.
    const baselineView = projectRunView(record, 'active', plan);
    expect(reviewCycleFields(detail.view)).toEqual(reviewCycleFields(baselineView));
  });
});
