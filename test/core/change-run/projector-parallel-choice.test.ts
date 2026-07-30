/**
 * ECP-4 tasks 8.5/8.6: unit + cross-plane coverage for the `parallel/1` and
 * `choice/1` view sections.
 *
 * These tasks were ticked as delivered but no test anywhere asserted either
 * section — the only evidence in the tree was the CLI-side dogfood, which
 * covers one plane and has no v2 choice node at all. A projector regression
 * (e.g. the projector's own join-state derivation drifting from the
 * reconciler's `evaluateJoin`) would have shipped undetected.
 *
 * Three planes are compared on ONE Record:
 *   (a) the pure projection `projectRunView(record, sourceState, plan)`
 *   (b) CLI `pipeline status --json` via the real PipelineCommand
 *   (c) management detail via `handleRunDetail` off a filesystem store
 *
 * Per the existing cross-plane-parity convention, the Operations/UI plane is
 * asserted separately under `packages/ui/test/`, not here.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { projectRunView } from '../../../src/core/change-run/internal/projector.js';
import { handleRunDetail } from '../../../src/core/management-api/runs.js';
import { createInMemoryRunStore } from '../../../src/core/change-run/internal/run-store.js';
import { createChangePipelineRuntime } from '../../../src/core/change-run/internal/facade-runtime.js';
import { PipelineCommand } from '../../../src/commands/pipeline.js';
import { reduceCanonicalRunRecord } from '../../../src/core/change-run/internal/reducer.js';
import { createRuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import {
  agentAction,
  evidenceFor,
  fixtureDigests,
  startRecord,
} from './reconciler-fixture.js';
import type { CanonicalRunRecord } from '../../../src/core/change-run/internal/record.js';
import type { RuntimePlan } from '../../../src/core/change-run/internal/runtime-plan.js';
import type { JsonValue, RunId } from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;
const RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);

function planFor(nodes: Parameters<typeof createRuntimePlan>[0]['nodes']): RuntimePlan {
  return createRuntimePlan({
    runId: RUN_ID,
    pipeline: 'ecp4-projection',
    planDigest: branded(`sha256:${'2'.repeat(64)}`),
    profileDigest: branded(`sha256:${'3'.repeat(64)}`),
    sourceRevisionDigest: branded(`sha256:${'4'.repeat(64)}`),
    capabilityDigest: branded(`sha256:${'5'.repeat(64)}`),
    policyDigest: branded(`sha256:${'6'.repeat(64)}`),
    implicitFinishOutcome: 'completed',
    nodes,
  });
}

/** FanOut with one required + two optional members, plus its Join. */
function parallelPlan(): RuntimePlan {
  const members = [
    { id: 'review', required: true, condition: 'always' },
    { id: 'cso', required: false, condition: 'security-relevant' },
    { id: 'benchmark', required: false, condition: 'performance-sensitive' },
  ];
  return planFor([
    {
      kind: 'fan-out',
      hierarchicalPath: 'root:experts',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      fanOut: {
        members: members.map((m) => ({
          hierarchicalPath: `root:experts/${m.id}`,
          required: m.required,
          condition: m.condition,
        })),
        concurrencyCap: 2,
        budget: 3,
        joinNodeId: 'root:experts-join',
      },
    },
    ...members.map((m) => ({
      kind: 'atomic' as const,
      hierarchicalPath: `root:experts/${m.id}`,
      requires: ['root:experts'],
      admissionKind: 'agent' as const,
      workspace: { access: 'read' as const },
      fanOutTag: { nodeId: 'root:experts', required: m.required },
    })),
    {
      kind: 'join',
      hierarchicalPath: 'root:experts-join',
      requires: members.map((m) => `root:experts/${m.id}`),
      join: {
        requiredMembers: ['root:experts/review'],
        optionalMembers: ['root:experts/cso', 'root:experts/benchmark'],
        outcomes: { proceed: 'experts-done', failed: 'experts-failed' },
      },
    },
  ]);
}

function choicePlan(): RuntimePlan {
  return planFor([
    {
      kind: 'choice',
      hierarchicalPath: 'root:pick',
      requires: [],
      admissionKind: 'agent',
      workspace: { access: 'none' },
      choice: {
        outcomes: ['simple', 'complex'],
        branches: { simple: 'root:simple-path', complex: 'root:complex-path' },
      },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:simple-path',
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
    {
      kind: 'atomic',
      hierarchicalPath: 'root:complex-path',
      requires: ['root:pick'],
      admissionKind: 'agent',
      workspace: { access: 'write' },
    },
  ]);
}

function apply(
  record: CanonicalRunRecord,
  stimulus: Parameters<typeof reduceCanonicalRunRecord>[1]
): CanonicalRunRecord {
  const result = reduceCanonicalRunRecord(record, stimulus);
  if (!result.ok) {
    throw new Error(`fixture reducer failed (${result.failure.code}): ${result.failure.message}`);
  }
  return result.record;
}

/** Admit an action for `path` and leave it ACTIVE (no committed result). */
function admitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  return apply(record, {
    kind: 'admit-action',
    action,
    attemptOrdinal: 0,
    deliveryMode: 'grant',
  });
}

function commitNode(
  plan: RuntimePlan,
  record: CanonicalRunRecord,
  path: string,
  result: JsonValue = { ok: true },
  status: 'succeeded' | 'failed' = 'succeeded'
): CanonicalRunRecord {
  const action = agentAction(plan, path);
  let next = admitNode(plan, record, path);
  next = apply(next, {
    kind: 'observe-effect',
    actionId: action.actionId,
    effectId: action.effects[0]!.effectId,
    status: 'succeeded',
    receiptDigest: fixtureDigests.receiptDigest,
    observation: { ok: true } as JsonValue,
    evidence: evidenceFor(plan, action.actionId),
  });
  return apply(next, {
    kind: 'commit-action-result',
    actionId: action.actionId,
    status,
    receiptDigest: fixtureDigests.receiptDigest,
    result,
    evidence: evidenceFor(plan, action.actionId),
  });
}

function sectionOf(plan: RuntimePlan, record: CanonicalRunRecord, kind: string): any {
  const view = projectRunView(record, 'active', plan) as unknown as {
    sections: readonly { kind: string }[];
  };
  return view.sections.find((s) => s.kind === kind);
}

describe('ECP-4 projector: parallel/1 section (8.1/8.5)', () => {
  it('is absent when the plan has no fan-out node', () => {
    const plan = choicePlan();
    expect(sectionOf(plan, startRecord(plan), 'parallel')).toBeUndefined();
  });

  it('reports every member as waiting before the condition commits', () => {
    const plan = parallelPlan();
    const section = sectionOf(plan, startRecord(plan), 'parallel');
    expect(section).toMatchObject({
      kind: 'parallel',
      version: 1,
      fanOutPath: 'root:experts',
      joinPath: 'root:experts-join',
      joinState: 'not-reached',
      concurrencyCap: 2,
      budget: { used: 0, max: 3 },
      succeededCount: 0,
      failedCount: 0,
      keyBlockers: [],
    });
    expect(section.members.map((m: { path: string }) => m.path)).toEqual([
      'root:experts/review',
      'root:experts/cso',
      'root:experts/benchmark',
    ]);
    expect(section.members.every((m: { status: string }) => m.status === 'waiting')).toBe(true);
    expect(section.members.map((m: { required: boolean }) => m.required)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('marks inactive members suppressed and in-flight members running', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
      rationale: {},
    });
    record = admitNode(plan, record, 'root:experts/review');

    const section = sectionOf(plan, record, 'parallel');
    const byPath = Object.fromEntries(
      section.members.map((m: { path: string; status: string }) => [m.path, m.status])
    );
    expect(byPath).toEqual({
      'root:experts/review': 'running',
      'root:experts/cso': 'ready',
      'root:experts/benchmark': 'suppressed',
    });
    expect(section.joinState).toBe('waiting');
    // Only members with an admitted-or-later action count against the budget.
    expect(section.budget).toEqual({ used: 0, max: 3 });
  });

  it('reports joinState=proceeding with budget usage once active members settle', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/review');
    record = commitNode(plan, record, 'root:experts/cso');

    const section = sectionOf(plan, record, 'parallel');
    expect(section.joinState).toBe('proceeding');
    expect(section.succeededCount).toBe(2);
    expect(section.failedCount).toBe(0);
    expect(section.budget).toEqual({ used: 2, max: 3 });
    expect(section.keyBlockers).toEqual([]);
  });

  it('reports joinState=failed and names the required member as a key blocker', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/review', { error: 'blocker' }, 'failed');
    record = commitNode(plan, record, 'root:experts/cso');

    const section = sectionOf(plan, record, 'parallel');
    expect(section.joinState).toBe('failed');
    expect(section.failedCount).toBe(1);
    expect(section.keyBlockers).toEqual([
      "required member 'root:experts/review' failed",
    ]);
  });

  it('suppresses a FAILED optional member without failing the join', () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/review');
    record = commitNode(plan, record, 'root:experts/cso', { error: 'optional' }, 'failed');

    const section = sectionOf(plan, record, 'parallel');
    expect(section.joinState).toBe('proceeding');
    expect(section.keyBlockers).toEqual([]);
  });
});

describe('ECP-4 projector: choice/1 section (8.2/8.5)', () => {
  it('is absent when the plan has no choice node', () => {
    const plan = parallelPlan();
    expect(sectionOf(plan, startRecord(plan), 'choice')).toBeUndefined();
  });

  it('reports no outcome and no active branch before the choice commits', () => {
    const plan = choicePlan();
    const section = sectionOf(plan, startRecord(plan), 'choice');
    expect(section).toMatchObject({
      kind: 'choice',
      version: 1,
      choicePath: 'root:pick',
    });
    expect(section.outcome).toBeUndefined();
    expect(section.branches).toEqual([
      { outcome: 'simple', path: 'root:simple-path', active: false },
      { outcome: 'complex', path: 'root:complex-path', active: false },
    ]);
  });

  it('marks exactly the selected branch active after the choice commits', () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:pick', { outcome: 'complex' });

    const section = sectionOf(plan, record, 'choice');
    expect(section.outcome).toBe('complex');
    expect(section.branches).toEqual([
      { outcome: 'simple', path: 'root:simple-path', active: false },
      { outcome: 'complex', path: 'root:complex-path', active: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8.6: the same Record projected through the management-API plane must yield
// byte-identical parallel/choice sections.
// ---------------------------------------------------------------------------

describe('ECP-4 cross-plane parity: parallel/choice sections (8.6)', () => {
  let xdgBackup: string | undefined;
  let rasenHomeBackup: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rasen-ecp4-parity-'));
    xdgBackup = process.env.XDG_DATA_HOME;
    rasenHomeBackup = process.env.RASEN_HOME;
    // Point the global data dir at the temp dir so handleRunDetail reads our
    // fixture Run. RASEN_HOME must be blanked so XDG wins.
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

  /** Capture console.log output produced by the CLI command. */
  async function captureLog(fn: () => Promise<unknown>): Promise<string> {
    let captured = '';
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      captured += args.map((a) => String(a)).join(' ') + '\n';
    });
    try {
      await fn();
      return captured;
    } finally {
      spy.mockRestore();
    }
  }

  /**
   * CLI plane: the real PipelineCommand.status with a test-injected runtime.
   * This still goes through facade.inspect -> projectRunView, exactly as in
   * production; only the heavy root-selection/registry-freeze chain is bypassed.
   */
  async function cliSections(plan: RuntimePlan, record: CanonicalRunRecord) {
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
      ctx: { facade, store, plan, initialRecord: store.load(plan.runId) },
      pipeline: { name: plan.pipeline } as never,
      runId: plan.runId as string,
      projectRoot: '/root',
      projectId: 'project-fixture',
      launchKey: 'ecp4-parity',
    }));
    const output = await captureLog(() =>
      command.status('fixture-change', plan.pipeline, { json: true })
    );
    return JSON.parse(output.trim()).view.sections as readonly { kind: string }[];
  }

  /**
   * Persist a Record + plan the way the filesystem RunStore lays them out, then
   * read them back through the real management detail handler. `plan.json` is
   * what lets the management plane project the parallel/choice sections at all.
   */
  async function mgmtSections(plan: RuntimePlan, record: CanonicalRunRecord) {
    const runDir = path.join(
      tempDir,
      'rasen',
      'runs',
      (record.runId as string).replace(/[^a-z0-9]/gi, '_')
    );
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      path.join(runDir, `record-v${record.recordVersion}.json`),
      JSON.stringify(record, null, 2)
    );
    writeFileSync(path.join(runDir, 'plan.json'), JSON.stringify(plan, null, 2));

    const detail = await handleRunDetail(
      'fixture-change',
      record.runId as string,
      undefined,
      null
    );
    if (!detail.ok) throw new Error(`management detail failed: ${detail.code}`);
    return detail.view.sections;
  }

  it('CLI and management API see the same parallel/1 section as the pure projection', async () => {
    const plan = parallelPlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:experts', {
      activeMembers: ['root:experts/review', 'root:experts/cso'],
      inactiveMembers: ['root:experts/benchmark'],
      rationale: {},
    });
    record = commitNode(plan, record, 'root:experts/review');

    const direct = JSON.parse(JSON.stringify(sectionOf(plan, record, 'parallel')));
    expect(direct).toBeDefined();
    const viaCli = (await cliSections(plan, record)).find((s) => s.kind === 'parallel');
    const viaMgmt = (await mgmtSections(plan, record)).find((s) => s.kind === 'parallel');
    expect(viaCli).toBeDefined();
    expect(viaMgmt).toBeDefined();
    expect(JSON.parse(JSON.stringify(viaCli))).toEqual(direct);
    expect(JSON.parse(JSON.stringify(viaMgmt))).toEqual(direct);
  });

  it('CLI and management API see the same choice/1 section as the pure projection', async () => {
    const plan = choicePlan();
    let record = startRecord(plan);
    record = commitNode(plan, record, 'root:pick', { outcome: 'simple' });

    const direct = JSON.parse(JSON.stringify(sectionOf(plan, record, 'choice')));
    expect(direct).toBeDefined();
    const viaCli = (await cliSections(plan, record)).find((s) => s.kind === 'choice');
    const viaMgmt = (await mgmtSections(plan, record)).find((s) => s.kind === 'choice');
    expect(viaCli).toBeDefined();
    expect(viaMgmt).toBeDefined();
    expect(JSON.parse(JSON.stringify(viaCli))).toEqual(direct);
    expect(JSON.parse(JSON.stringify(viaMgmt))).toEqual(direct);
  });
});
