/**
 * `issue-status-projection` widening — the workspace-index locator (design
 * D6) and the attribution facts (design D7), over a REAL Git Store fixture
 * with real run-state files and synthetic (injected) workspace index entries.
 *
 * The C1 suite (`issue-status-projection.test.ts`) stays untouched and is the
 * regression row for omitted inputs; these units cover what the widening ADDS:
 * index-located observation from a store-root-style read (no execution root
 * input), per-node `locatedBy` labelling, current-root-first precedence,
 * first-hit behavior across several entries, attribution fact extraction
 * (durable pointers only — a live agent handle is never presented), the honest
 * no-sessions portfolio case, and evidence locators through the store-side
 * active-change address.
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
import type { WorkspaceIndexEntry, WorkspaceIndexSide } from '../../../src/core/store/workspace/registry.js';
import {
  writePortfolioState,
  type PortfolioState,
} from '../../../src/core/pipeline-registry/portfolio-state.js';
import {
  writeRunState,
  type RunState,
  type StageStatus,
} from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-17T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-wide';

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

describe('the widened run-state locator and attribution', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let indexExecRoot: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

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

  function side(root: string): WorkspaceIndexSide {
    return {
      root,
      repositoryIdentity: 'repo',
      worktreeInstanceId: `wt-${path.basename(root)}`,
      ref: 'refs/heads/main',
      headOid: 'a'.repeat(40),
    };
  }

  /** A synthetic index entry whose execution root is the temp index root. */
  function entryFor(changeId: string, changeInstanceId: string, execRoot: string): WorkspaceIndexEntry {
    return {
      version: 1,
      planningScopeId: f.planningScopeId(PROJECT, LINE),
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      changeInstanceId,
      planning: side(f.storeRoot),
      execution: side(execRoot),
      planId: `plan-${changeId}`,
      phase: 'bound',
      recordedAt: NOW,
      updatedAt: NOW,
    };
  }

  async function publishOneNodePlan(instanceId: string, alias: string): Promise<void> {
    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    await issues.create({ ...scope(), issueId: ISSUE, title: 'Widening unit' });
    const nodes: readonly ExecutionPlanNodeInput[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceId,
        changeAlias: alias,
        dependsOn: [],
      },
    ];
    await issues.publishPlan({ ...scope(), issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  async function readStatus(extra: {
    executionRoot?: string;
    changesDir?: string;
    storeRoot?: string;
    workspaceEntries?: readonly WorkspaceIndexEntry[];
  } = {}) {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    return projectIssueStatus({
      detail,
      ...(extra.executionRoot === undefined ? {} : { executionRoot: extra.executionRoot }),
      ...(extra.changesDir === undefined ? {} : { changesDir: extra.changesDir }),
      ...(extra.storeRoot === undefined ? {} : { storeRoot: extra.storeRoot }),
      ...(extra.workspaceEntries === undefined ? {} : { workspaceEntries: extra.workspaceEntries }),
      workDirFor: NO_WORK_DIR,
    });
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-widening-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    indexExecRoot = f.beside('exec-index');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('locates run-state through the workspace index from a store-root-style read', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');
    // The run-state lives ONLY under the index entry's execution root.
    writeRunState(
      ephemeraDir(indexExecRoot, 'child-a'),
      stages({ propose: 'done', apply: 'in_progress' })
    );
    const entries = [entryFor('child-a', instanceId, indexExecRoot)];

    // No execution root input at all — the store-root read the dogfood makes.
    const status = await readStatus({ workspaceEntries: entries });
    const node = status.nodes[0];
    expect(node.observation).toBe('in-flight');
    expect(node.locatedBy).toBe('workspace-index');
    // Windows-semantics path built with path.join: the index root's ephemera.
    expect(node.runStatePath).toBe(
      path.join(ephemeraDir(indexExecRoot, 'child-a'), 'auto-run.json')
    );
    expect(node.attribution.pipeline).toBe('small-feature');
  });

  it('labels a current-root hit execution-root and prefers it over the index', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');
    const currentRoot = f.beside('exec-current');
    // BOTH roots carry run-state; the working directory's own execution root
    // is searched first, exactly as the MODIFIED requirement orders.
    writeRunState(ephemeraDir(currentRoot, 'child-a'), stages({ propose: 'in_progress' }));
    writeRunState(ephemeraDir(indexExecRoot, 'child-a'), stages({ propose: 'done', apply: 'done' }));

    const status = await readStatus({
      executionRoot: currentRoot,
      workspaceEntries: [entryFor('child-a', instanceId, indexExecRoot)],
    });
    expect(status.nodes[0].locatedBy).toBe('execution-root');
    expect(status.nodes[0].observation).toBe('in-flight');
    expect(status.nodes[0].runStatePath).toBe(
      path.join(ephemeraDir(currentRoot, 'child-a'), 'auto-run.json')
    );

    // Without the current root, the SAME index entry is the winner — and its
    // own (terminal) state is what it reports.
    const indexed = await readStatus({ workspaceEntries: [entryFor('child-a', instanceId, indexExecRoot)] });
    expect(indexed.nodes[0].locatedBy).toBe('workspace-index');
    expect(indexed.nodes[0].observation).toBe('run-terminal');
  });

  it('probes several matching entries in order — first hit wins, no refusal', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');
    const otherRoot = f.beside('exec-other');
    writeRunState(ephemeraDir(indexExecRoot, 'child-a'), stages({ propose: 'in_progress' }));

    const status = await readStatus({
      workspaceEntries: [
        entryFor('child-a', instanceId, indexExecRoot),
        entryFor('child-a', instanceId, otherRoot),
      ],
    });
    expect(status.nodes[0].locatedBy).toBe('workspace-index');
    expect(status.nodes[0].runStatePath).toBe(
      path.join(ephemeraDir(indexExecRoot, 'child-a'), 'auto-run.json')
    );
  });

  it('extracts durable session pointers and never a live agent handle', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');
    const state: RunState = {
      pipeline: 'small-feature',
      stages: {
        propose: {
          status: 'done',
          worker: {
            runtime: 'claude',
            role: 'planner',
            agentId: 'agent-live-handle',
            sessionId: 'sess-123',
            transcript: 'agent-sess-123.jsonl',
          },
        },
        apply: {
          status: 'in_progress',
          worker: {
            runtime: 'codex',
            role: 'implementer',
            threadId: 'thread-456',
          },
        },
        verify: { status: 'pending', worker: 'implementer' },
      },
    };
    writeRunState(ephemeraDir(indexExecRoot, 'child-a'), state);

    const status = await readStatus({
      workspaceEntries: [entryFor('child-a', instanceId, indexExecRoot)],
    });
    const sessions = status.nodes[0].attribution.sessions;
    // The two workers that recorded durable pointers are attributed; the
    // bare-string `verify` worker recorded none and synthesizes none.
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      stageId: 'propose',
      role: 'planner',
      runtime: 'claude',
      sessionId: 'sess-123',
      transcript: 'agent-sess-123.jsonl',
    });
    expect(sessions[1]).toEqual({
      stageId: 'apply',
      role: 'implementer',
      runtime: 'codex',
      threadId: 'thread-456',
    });
    // agentId is a live handle: never read, never presented.
    expect(JSON.stringify(sessions)).not.toContain('agent-live-handle');
    expect(JSON.stringify(status.nodes[0])).not.toContain('agentId');
  });

  it('reports a portfolio-observed node with honestly empty sessions and no parent pipeline', async () => {
    const instanceId = seedAndCommit('child-b', 'b2'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-b');
    const portfolio: PortfolioState = {
      parent: 'child-b',
      children: [
        { id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'in_progress' },
      ],
      delivery: { status: 'pending' },
    };
    writePortfolioState(ephemeraDir(indexExecRoot, 'child-b'), portfolio);

    const status = await readStatus({
      workspaceEntries: [entryFor('child-b', instanceId, indexExecRoot)],
    });
    const node = status.nodes[0];
    expect(node.observation).toBe('in-flight');
    expect(node.locatedBy).toBe('workspace-index');
    expect(node.runStatePath).toBe(
      path.join(ephemeraDir(indexExecRoot, 'child-b'), 'portfolio-run.json')
    );
    // The portfolio shape carries no stage workers and no single parent
    // pipeline: none is synthesized, and the parent's own per-change record
    // is not substituted.
    expect(node.attribution.sessions).toEqual([]);
    expect(node.attribution.pipeline).toBeNull();
  });

  it('resolves the evidence locator through the store-side active-change address', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');

    // From an unrelated directory with no execution root and no current
    // changes directory: the store address still names the evidence dir.
    const status = await readStatus({ storeRoot: f.storeRoot });
    expect(status.nodes[0].attribution.evidenceLocator).toBe(
      path.join(f.storeRoot, 'rasen', 'projects', PROJECT, 'changes', 'child-a', 'evidence')
    );
    // Nothing was located, and the answer says so without failing.
    expect(status.nodes[0].locatedBy).toBeNull();
    expect(status.nodes[0].observation).toBe('not-started');
    expect(status.runStateVisibility).toEqual({ kind: 'none' });
  });

  it('keeps omitted-input behavior C1-shaped: no locatedBy, empty attribution, same observations', async () => {
    const instanceId = seedAndCommit('child-a', 'a1'.repeat(16));
    await publishOneNodePlan(instanceId, 'child-a');
    const currentRoot = f.beside('exec-c1');
    writeRunState(ephemeraDir(currentRoot, 'child-a'), stages({ propose: 'in_progress' }));

    // C1 inputs only — no workspaceEntries, no storeRoot.
    const status = await readStatus({ executionRoot: currentRoot });
    const node = status.nodes[0];
    expect(node.observation).toBe('in-flight');
    expect(node.locatedBy).toBe('execution-root');
    expect(node.attribution.pipeline).toBe('small-feature');
    expect(node.attribution.sessions).toEqual([]);
    expect(node.attribution.evidenceLocator).toBeNull();
    // Phase/health/progress are exactly the C1 derivation.
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 1 });
  });
});
