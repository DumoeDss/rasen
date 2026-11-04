/**
 * `issue-node-lifecycle` tasks 2.1–2.4 — the four-state semantics through the
 * one projection seam, over a REAL Git Store fixture and real run-state files
 * (the same fixture discipline as `issue-status-projection.test.ts`, which
 * remains the authority for the all-required rows this suite varies).
 *
 * Each test maps to one row of design D3's table or one scenario of the
 * MODIFIED phase/health/progress requirements: optional counted nowhere but
 * real in health and phase-active; cancelled/superseded outside the execution
 * graph entirely; zero required = the stated 0/0.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import {
  writeRunState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-20T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-lc';

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

const TERMINAL = () =>
  stages({
    propose: 'done',
    apply: 'done',
    verify: 'done',
    'review-loop': 'done',
    ship: 'done',
    archive: 'done',
  });

describe('the issue status projection under node lifecycles', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-lifecycle-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function seedAndCommit(changeId: string, instanceSeed: string): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
    return seeded.instanceId;
  }

  function writeRunStateFor(alias: string, state: RunState): string {
    const dir = ephemeraDir(execRoot, alias);
    writeRunState(dir, state);
    return path.join(dir, 'auto-run.json');
  }

  async function readStatus() {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
  }

  async function publishPlan(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Lifecycle projection' });
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  const node = (
    nodeId: string,
    changeInstanceId: string,
    alias: string,
    extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason' | 'dependsOn'>> = {}
  ): ExecutionPlanNodeInput => ({
    nodeId,
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    changeInstanceId,
    changeAlias: alias,
    dependsOn: [],
    ...extra,
  });

  it('counts an optional completion nowhere, while reporting it on the node line', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
      seedAndCommit('child-opt', 'd4'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-002', ids[1], 'child-b'),
      node('g-003', ids[2], 'child-c'),
      node('g-opt', ids[3], 'child-opt', { lifecycle: 'optional' }),
    ]);
    writeRunStateFor('child-opt', TERMINAL());
    const status = await readStatus();
    // Optional is named but not counted: both parts of the pair scope to the
    // three required nodes.
    expect(status.progress).toEqual({ completed: 0, total: 3 });
    const optional = status.nodes.find(entry => entry.nodeId === 'g-opt');
    expect(optional?.lifecycle).toBe('optional');
    expect(optional?.reason).toBeNull();
    expect(optional?.observation).toBe('run-terminal');
    // Its completed work is REAL wanted work: the graph has advanced, so the
    // phase row is active (D3: running/advanced ⇒ active), while progress
    // still counts only the required nodes.
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
  });

  it('reports the stated 0/0 for a readable revision with no required nodes', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-opt', ids[0], 'child-a', { lifecycle: 'optional' }),
      node('g-cut', ids[1], 'child-b', {
        lifecycle: 'cancelled',
        reason: 'descoped before execution started',
      }),
    ]);
    const status = await readStatus();
    // The pair itself says no work is demanded — distinct from null.
    expect(status.progress).toEqual({ completed: 0, total: 0 });
    expect(status.nodes.find(entry => entry.nodeId === 'g-opt')?.lifecycle).toBe('optional');
    expect(status.nodes.find(entry => entry.nodeId === 'g-cut')?.reason).toBe(
      'descoped before execution started'
    );
    // Vacuously nothing demanded is unfinished, no intent remains: review.
    expect(status.phase).toBe('review');
    expect(status.health).toBe('waiting-human');
  });

  it('keeps review when every required node is terminal and an optional node is in flight', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'optional' }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    writeRunStateFor('child-opt', stages({ propose: 'done', apply: 'in_progress' }));
    const status = await readStatus();
    expect(status.phase).toBe('review');
    expect(status.health).toBe('waiting-human');
    // The optional node's in-flight observation is still reported on its line.
    expect(status.nodes.find(entry => entry.nodeId === 'g-opt')?.observation).toBe('in-flight');
    expect(status.progress).toEqual({ completed: 1, total: 1 });
  });

  it('lets a cancelled node with stale in-flight run-state drive no phase', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-cut', ids[1], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'dropped after the portfolio re-scoped',
      }),
    ]);
    // The cancelled node still carries a live-looking run-state.
    writeRunStateFor('child-cut', stages({ propose: 'done', apply: 'in_progress' }));
    const status = await readStatus();
    // Phase derives from the other node alone: ready, not active.
    expect(status.phase).toBe('ready');
    expect(status.health).toBe('healthy');
    // The observation is still reported on the cancelled node's line.
    expect(status.nodes.find(entry => entry.nodeId === 'g-cut')?.observation).toBe('in-flight');
    expect(status.progress).toEqual({ completed: 0, total: 1 });
  });

  it('maps a failed optional node to failed health — wanted work failed', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'optional' }),
    ]);
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    // The optional child failed mid-run and parked for a human.
    writeRunStateFor('child-opt', stages({ propose: 'done', 'review-loop': 'escalated' }));
    const status = await readStatus();
    expect(status.nodes.find(entry => entry.nodeId === 'g-opt')?.observation).toBe(
      'waiting-human'
    );
    expect(status.health).toBe('waiting-human');
  });

  it('treats a cancelled node with a recorded failure as history, not health', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-cut', ids[1], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'failed twice and descoped',
      }),
    ]);
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    // A failure escalation on the cancelled node: history from day one.
    writeRunStateFor('child-cut', stages({ propose: 'done', 'review-loop': 'escalated' }));
    const status = await readStatus();
    expect(status.nodes.find(entry => entry.nodeId === 'g-cut')?.observation).toBe(
      'waiting-human'
    );
    // Health derives from the other node alone.
    expect(status.health).toBe('healthy');
    expect(status.phase).toBe('active');
  });

  it('marks a superseded node outside the graph the same way a cancelled one is', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-sup', 'b2'.repeat(16)),
    ];
    await publishPlan([
      node('g-001', ids[0], 'child-a'),
      node('g-sup', ids[1], 'child-sup', {
        lifecycle: 'superseded',
        reason: 'folded into child-a by revision 0002 of the portfolio plan',
      }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    const status = await readStatus();
    expect(status.progress).toEqual({ completed: 1, total: 1 });
    expect(status.phase).toBe('review');
    expect(status.nodes.find(entry => entry.nodeId === 'g-sup')?.lifecycle).toBe('superseded');
  });

  it('stays planning for a plan of intent nodes and only-cancelled change nodes (R2 pin)', async () => {
    // Review round-1 R2: `ready` needs at least one WANTED change node. A
    // cancelled node is outside the execution graph, so intent + cancelled-only
    // is the all-intent corner by derivation — planning, never ready, while
    // the cancelled node's observation stays on its line and progress states
    // the required-scoped 0/0.
    const ids = [seedAndCommit('child-cut', 'b2'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'Work declared but no Change exists yet',
        dependsOn: [],
      },
      node('g-cut', ids[0], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'dropped before any work started',
      }),
    ]);
    const status = await readStatus();
    expect(status.phase).toBe('planning');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 0 });
    const cancelled = status.nodes.find(entry => entry.nodeId === 'g-cut');
    expect(cancelled?.lifecycle).toBe('cancelled');
    expect(cancelled?.observation).toBe('not-started');
  });

  it('reads an absent lifecycle as required on every node line', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([node('g-001', ids[0], 'child-a')]);
    const status = await readStatus();
    expect(status.nodes[0].lifecycle).toBe('required');
    expect(status.nodes[0].reason).toBeNull();
  });
});
