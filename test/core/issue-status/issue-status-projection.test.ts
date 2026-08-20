/**
 * `issue-status-projection` — the derivation table, over a REAL Git Store
 * fixture and real run-state files written into a temp execution root.
 *
 * Every scenario maps to a row of design D4's observation table or a clause of
 * the spec's phase/health/progress requirements. Committed evidence goes
 * through real Git objects; run-state is written with the frozen pipeline-
 * registry writers (`writeRunState` / `writePortfolioState`) so these tests
 * consume exactly the bytes the LEAD produces. `workDirFor` is injected to
 * null so no test touches a real machine registry.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  executionPlanDigest,
  productionStoreIssueDependencies,
  serializeExecutionPlanRevision,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { serializeArchiveV2 } from '../../../src/core/store/finalization-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';
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
import { readIssueAcceptanceFacts } from '../../../src/core/issue-acceptance/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-1';

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

describe('the issue status projection', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  /** Seeds a Change into the integration checkout and commits it on `main`. */
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

  /**
   * Seeds a Change, then archives it exactly where the layout contract
   * addresses it, with a v2 record carrying a committed `landed` outcome, and
   * commits both steps. Returns the Change instance id a plan can name.
   */
  function seedAndArchive(changeId: string, instanceSeed: string): string {
    const instanceId = seedAndCommit(changeId, instanceSeed);
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
    });
    const record = serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      changeInstanceId: deriveChangeInstanceId({ planningScopeId, instanceSeed }),
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId: deriveChangeInstanceId({ planningScopeId, instanceSeed }),
        planningWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        executionWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'execution',
        }),
      }),
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      planning: {
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        sourceRef: `refs/heads/change/${changeId}`,
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      codeMerge: null,
      specSync: { applied: true, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });
    const entryName = `2026-08-07-${changeId}--${instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      PROJECT,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(f.at('rasen', 'projects', PROJECT, 'changes', changeId), archiveDir);
    fs.writeFileSync(path.join(archiveDir, 'archive.json'), record, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `archive ${changeId}`]);
    return instanceId;
  }

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function query(): StoreQueryModuleImpl {
    return new StoreQueryModuleImpl();
  }

  function writeRunStateFor(alias: string, state: RunState): string {
    const dir = ephemeraDir(execRoot, alias);
    writeRunState(dir, state);
    return path.join(dir, 'auto-run.json');
  }

  function writePortfolioFor(alias: string, state: PortfolioState): string {
    const dir = ephemeraDir(execRoot, alias);
    writePortfolioState(dir, state);
    return path.join(dir, 'portfolio-run.json');
  }

  async function showIssue() {
    return query().showIssue({ ...scope(), issueId: ISSUE });
  }

  async function readStatus(extra: { executionRoot?: string; changesDir?: string } = {}) {
    const detail = await showIssue();
    return projectIssueStatus({
      detail,
      ...(extra.executionRoot === undefined ? {} : { executionRoot: extra.executionRoot }),
      ...(extra.changesDir === undefined ? {} : { changesDir: extra.changesDir }),
      workDirFor: NO_WORK_DIR,
    });
  }

  /** Creates the Issue and publishes a three-child serial plan (g-001..g-003). */
  async function publishPlan(nodeInputs: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Issue layer phase 1' });
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes: nodeInputs });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  function threeChangeNodes(
    instanceIds: readonly [string, string, string]
  ): readonly ExecutionPlanNodeInput[] {
    return [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[1],
        changeAlias: 'child-b',
        dependsOn: ['g-001'],
      },
      {
        nodeId: 'g-003',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[2],
        changeAlias: 'child-c',
        dependsOn: ['g-001', 'g-002'],
      },
    ];
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-status-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  // ---------------------------------------------------------------------------
  // Phase
  // ---------------------------------------------------------------------------

  it('derives planning for an Issue with no published plan', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'No plan yet' });
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('planning');
    expect(status.health).toBe('healthy');
    expect(status.progress).toBeNull();
    expect(status.nodes).toEqual([]);
    expect(status.problems).toEqual([]);
    expect(status.complete).toBe(true);
  });

  it('derives ready for a confirmed plan that has not started', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('ready');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 3 });
    expect(status.nodes.map(node => node.observation)).toEqual([
      'not-started',
      'not-started',
      'not-started',
    ]);
    // Serial ordering is sequencing, not sickness: the awaiting siblings still
    // name their dependencies — since g-002 as structured facts on the
    // work-complete basis, each carrying the dependency's target project and
    // observed state.
    expect(status.nodes[1].blockedBy).toEqual([
      { nodeId: 'g-001', projectId: PROJECT, observation: 'not-started' },
    ]);
    expect(status.nodes[2].blockedBy).toEqual([
      { nodeId: 'g-001', projectId: PROJECT, observation: 'not-started' },
      { nodeId: 'g-002', projectId: PROJECT, observation: 'not-started' },
    ]);
  });

  it('derives planning for an all-intent plan (no runnable node)', async () => {
    await publishPlan([
      {
        nodeId: 'i-001',
        kind: 'intent',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'Work declared but no Change exists yet',
        dependsOn: [],
      },
    ]);
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('planning');
    // issue-node-lifecycle: progress counts required CHANGE nodes only, so an
    // all-intent plan reports the stated 0/0 (no work is demanded), not a
    // count over intent nodes. Still an exact-pair pin — the value moved with
    // the contract, the assertion strength did not.
    expect(status.progress).toEqual({ completed: 0, total: 0 });
    expect(status.nodes[0].kind).toBe('intent');
    expect(status.nodes[0].alias).toBeNull();
    expect(status.nodes[0].observation).toBe('not-started');
    expect(status.nodes[0].lifecycle).toBeNull();
  });

  it('derives active/healthy 0/3 with one child in-flight from live run-state', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    const runStatePath = writeRunStateFor(
      'child-a',
      stages({ propose: 'done', apply: 'in_progress' })
    );
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 3 });
    expect(status.nodes[0].observation).toBe('in-flight');
    // Windows-semantics path built with path.join, asserted as located.
    expect(status.nodes[0].runStatePath).toBe(runStatePath);
    expect(status.nodes[0].alias).toBe('child-a');
    expect(status.nodes.slice(1).map(node => node.observation)).toEqual([
      'not-started',
      'not-started',
    ]);
  });

  it('counts one-of-three complete and keeps serial order healthy', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    writeRunStateFor(
      'child-a',
      stages({ propose: 'done', apply: 'done', verify: 'done', 'review-loop': 'done', ship: 'done', archive: 'done' })
    );
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    // Partially advanced work is active; a terminal sibling awaiting final
    // archiving still counts (progress measures work, not archiving).
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 1, total: 3 });
    expect(status.nodes[0].observation).toBe('run-terminal');
  });

  it('derives review + waiting-human when every node is complete, and done only through a recorded acceptance', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    const terminal = stages({
      propose: 'done',
      apply: 'done',
      verify: 'done',
      'review-loop': 'done',
      ship: 'done',
      archive: 'done',
    });
    writeRunStateFor('child-a', terminal);
    writeRunStateFor('child-b', { ...terminal });
    writeRunStateFor('child-c', { ...terminal });
    const open = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    // Implementation complete awaiting the Issue's own close is review, and
    // its remaining work is human-owned — never done from the archive alone.
    expect(open.phase).toBe('review');
    expect(open.health).toBe('waiting-human');
    expect(open.progress).toEqual({ completed: 3, total: 3 });

    await issues().setState({ ...scope(), issueId: ISSUE, state: 'resolved' });
    // The query prefers a COMMITTED copy over the working tree, so the state
    // change must be committed Store content before the read reflects it.
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'resolve issue']);
    // The done rule since issue-acceptance-close: the resolved state alone is
    // a bare operator flip and derives REVIEW, not done. The same read also
    // carries no acceptance facts, which is the honest input for a store with
    // no acceptance content yet.
    const flipped = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(flipped.phase).toBe('review');
    expect(flipped.health).toBe('waiting-human');

    // Recording the acceptance — through the real mutations, exactly as the
    // accept orchestration drives them — is what moves the phase to done.
    const published = await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'The projection is shipped' }],
    });
    const accepted = await issues().accept({
      ...scope(),
      issueId: ISSUE,
      conditionsRevisionId: published.revision.revisionId,
      conditionsSha256: published.revision.contentSha256,
      gate: { completed: 3, total: 3, health: 'healthy', problemsStanding: 0 },
    });
    expect(accepted.state).toBe('resolved');
    const done = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE }),
    });
    expect(done.phase).toBe('done');
    expect(done.health).toBe('healthy');
    expect(done.acceptance?.record?.conditionsRevisionId).toBe('0001');
    // An already-accepted Issue is no longer acceptable — the gate says so
    // over the SAME read that presents it done.
    expect(done.acceptance?.gate.eligible).toBe(false);
    if (done.acceptance !== null && !done.acceptance.gate.eligible) {
      expect(done.acceptance.gate.refusalCode).toBe('issue_accept_already_accepted');
    }
  });

  it('reads review/waiting-human for a premature close while a child is still in flight', async () => {
    // Minor-1's pin: a resolved Issue without an acceptance record reads
    // review WHATEVER its nodes' state — the operator declared the work over,
    // so only the unproven acceptance remains — and the gate still names the
    // un-terminal node, so no acceptance is possible until the work is real.
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Premature close scenario' }],
    });
    await issues().setState({ ...scope(), issueId: ISSUE, state: 'resolved' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'premature resolve']);

    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE }),
    });
    expect(status.phase).toBe('review');
    expect(status.health).toBe('waiting-human');
    const gate = status.acceptance?.gate;
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_blocked');
      expect(gate.blockers).toContainEqual({
        kind: 'un-terminal-node',
        nodeId: 'g-001',
        observation: 'in-flight',
      });
      expect(gate.blockers).toContainEqual({
        kind: 'un-terminal-node',
        nodeId: 'g-002',
        observation: 'not-started',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  it('keeps a failure among running work in health, not phase', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    // child-b is a decomposed parent: its portfolio records a child escalated
    // after failure while its sibling still runs.
    const portfolioPath = writePortfolioFor('child-b', {
      parent: 'child-b',
      children: [
        { id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' },
        { id: 'sub-2', pipeline: 'bug-fix', dependsOn: [], status: 'in_progress' },
      ],
      delivery: { status: 'pending' },
    });
    writeRunStateFor('child-c', stages({ propose: 'in_progress' }));
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('failed');
    expect(status.nodes[1].observation).toBe('failed');
    expect(status.nodes[1].runStatePath).toBe(portfolioPath);
    expect(status.nodes[0].observation).toBe('in-flight');
    expect(status.nodes[2].observation).toBe('in-flight');
  });

  it('maps a portfolio whose delivery escalated to failed health', async () => {
    const ids = [seedAndCommit('child-b', 'b2'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-b',
        dependsOn: [],
      },
    ]);
    // All child work finished; the one-time parent delivery failed and asked
    // for a human. The delivery row of the observation table, not the child
    // row, is what carries it.
    writePortfolioFor('child-b', {
      parent: 'child-b',
      children: [
        { id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'done' },
        { id: 'sub-2', pipeline: 'bug-fix', dependsOn: [], status: 'skipped' },
      ],
      delivery: { status: 'escalated' },
    });
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes[0].observation).toBe('failed');
    expect(status.health).toBe('failed');
    expect(status.phase).toBe('active');
    expect(status.progress).toEqual({ completed: 0, total: 1 });
  });

  it('reports a parked stage as waiting for a human, not a new phase', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    writeRunStateFor('child-a', stages({ propose: 'done', 'review-loop': 'escalated' }));
    const status = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('waiting-human');
    expect(status.nodes[0].observation).toBe('waiting-human');
  });

  it('maps a portfolio in delivery to in-flight and a delivered one to run-terminal', async () => {
    const ids = [seedAndCommit('child-b', 'b2'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-b',
        dependsOn: [],
      },
    ]);
    const childrenDone = (): PortfolioState => ({
      parent: 'child-b',
      children: [
        { id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'done' },
        { id: 'sub-2', pipeline: 'bug-fix', dependsOn: [], status: 'skipped' },
      ],
      delivery: { status: 'in_progress' },
    });
    writePortfolioFor('child-b', childrenDone());
    const delivering = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(delivering.nodes[0].observation).toBe('in-flight');
    expect(delivering.progress).toEqual({ completed: 0, total: 1 });

    writePortfolioFor('child-b', { ...childrenDone(), delivery: { status: 'done' } });
    const delivered = await projectIssueStatus({
      detail: await showIssue(),
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(delivered.nodes[0].observation).toBe('run-terminal');
    expect(delivered.progress).toEqual({ completed: 1, total: 1 });
    expect(delivered.phase).toBe('review');
  });

  // ---------------------------------------------------------------------------
  // Committed evidence and visibility
  // ---------------------------------------------------------------------------

  it('derives finalized from committed archive evidence, with no execution root at all', async () => {
    const instanceSeed = 'c3'.repeat(16);
    const instanceId = seedAndCommit('child-c', instanceSeed);
    // Archive the Change exactly where the layout contract addresses it, with
    // a v2 record carrying a committed outcome.
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
    });
    const record = serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-c',
      changeInstanceId: instanceId,
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId: deriveChangeInstanceId({ planningScopeId, instanceSeed }),
        planningWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        executionWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'execution',
        }),
      }),
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      planning: {
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        sourceRef: 'refs/heads/change/child-c',
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      codeMerge: null,
      specSync: { applied: true, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });
    const changeDir = f.at('rasen', 'projects', PROJECT, 'changes', 'child-c');
    const entryName = `2026-08-07-child-c--${instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      PROJECT,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(changeDir, archiveDir);
    fs.writeFileSync(path.join(archiveDir, 'archive.json'), record, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'archive child-c']);

    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
    ];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[1],
        changeAlias: 'child-b',
        dependsOn: [],
      },
      {
        nodeId: 'g-003',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceId,
        changeAlias: 'child-c',
        dependsOn: [],
      },
    ]);

    // An unrelated working directory: no execution root, no changes dir. The
    // committed evidence still derives; the answer labels the absence.
    const status = await projectIssueStatus({
      detail: await showIssue(),
      workDirFor: NO_WORK_DIR,
    });
    expect(status.runStateVisibility).toEqual({ kind: 'none' });
    expect(status.nodes[2].observation).toBe('finalized');
    expect(status.nodes[0].observation).toBe('not-started');
    expect(status.progress).toEqual({ completed: 1, total: 3 });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');

    // The same Issue from the execution root sees the same committed fact plus
    // any live run-state.
    const live = await readStatus({ executionRoot: execRoot, changesDir });
    expect(live.nodes[2].observation).toBe('finalized');
    expect(live.runStateVisibility).toEqual({ kind: 'execution-root', executionRoot: execRoot });
  });

  it('counts a finalized sibling and a run-terminal sibling the same: 2 of 3', async () => {
    // child-c archives with a committed outcome (finalized evidence); child-a
    // finishes its live run without archiving; child-b has not started. The
    // spec's "finalized and run-terminal nodes count the same" as ONE state,
    // not two disjoint ones.
    const instanceSeed = 'c3'.repeat(16);
    const archivedId = seedAndArchive('child-c', instanceSeed);
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes([ids[0], ids[1], archivedId] as [string, string, string]));
    writeRunStateFor(
      'child-a',
      stages({ propose: 'done', apply: 'done', verify: 'done', 'review-loop': 'done', ship: 'done', archive: 'done' })
    );
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes.map(node => node.observation)).toEqual([
      'run-terminal',
      'not-started',
      'finalized',
    ]);
    expect(status.progress).toEqual({ completed: 2, total: 3 });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
  });

  it('locates run-state through the sticky-legacy chain, ephemera first', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    // Legacy tail only: the planning change directory holds the file. The
    // stage map is the full initialized universe with one stage done, so the
    // honest observation is `advanced`, not terminal.
    const tailDir = path.join(changesDir, 'child-a');
    writeRunState(
      tailDir,
      stages({ propose: 'done', apply: 'pending', verify: 'pending', 'review-loop': 'pending', ship: 'pending', archive: 'pending' })
    );
    const fromTail = await readStatus({ executionRoot: execRoot, changesDir });
    expect(fromTail.nodes[0].observation).toBe('advanced');
    expect(fromTail.nodes[0].runStatePath).toBe(path.join(tailDir, 'auto-run.json'));

    // Once the execution root's ephemera directory holds one, it wins.
    const ephemera = writeRunStateFor('child-a', stages({ propose: 'in_progress' }));
    const fromEphemera = await readStatus({ executionRoot: execRoot, changesDir });
    expect(fromEphemera.nodes[0].observation).toBe('in-flight');
    expect(fromEphemera.nodes[0].runStatePath).toBe(ephemera);
  });

  it('treats a non-absolute changesDir as absent — no probing of the working directory', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    // A store-aggregate root reports changesDir '' and `path.join('', alias)`
    // is the bare relative alias — probing it would read whatever the AMBIENT
    // working directory happens to contain. The file a relative tail would
    // reach is planted in a real directory the test chdir's into, so the
    // assertion fails if the relative probe ever comes back.
    const ambient = f.beside('ambient');
    writeRunState(path.join(ambient, 'child-a'), stages({ propose: 'in_progress' }));
    const originalCwd = process.cwd();
    process.chdir(ambient);
    try {
      const status = await readStatus({ changesDir: '' });
      expect(status.nodes[0].observation).toBe('not-started');
      expect(status.nodes[0].runStatePath).toBeNull();
    } finally {
      // Restore before the fixture cleanup removes the directory.
      process.chdir(originalCwd);
    }
  });

  it('distinguishes a present-but-idle run-state from an absent one', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16)), seedAndCommit('child-b', 'b2'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[1],
        changeAlias: 'child-b',
        dependsOn: [],
      },
    ]);
    const initializedPath = writeRunStateFor(
      'child-a',
      stages({ propose: 'pending', apply: 'pending' })
    );
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes[0].observation).toBe('not-started');
    expect(status.nodes[0].runStatePath).toBe(initializedPath);
    expect(status.nodes[1].observation).toBe('not-started');
    expect(status.nodes[1].runStatePath).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Fail-closed reads
  // ---------------------------------------------------------------------------

  it('reports a corrupt auto-run.json as unknown with a problem, never guessed', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    const corruptPath = path.join(ephemeraDir(execRoot, 'child-a'), 'auto-run.json');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{not json', 'utf8');
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes[0].observation).toBe('unknown');
    expect(status.nodes[0].runStatePath).toBe(corruptPath);
    // The diagnostic is the reader's own parse failure — the raw JSON error.
    expect(status.nodes[0].diagnostic).toContain('JSON');
    expect(status.problems).toHaveLength(1);
    expect(status.problems[0].kind).toBe('invalid-run-state');
    expect(status.problems[0].node).toBe('g-001');
    expect(status.problems[0].ref).toBe(corruptPath);
    expect(status.complete).toBe(false);
    expect(status.progress).toEqual({ completed: 0, total: 1 });
    // A located-but-unreadable run-state is activity-adjacent trouble, not the
    // absence of a plan: the phase row for `unknown` is `active`, and the
    // health stays honest (nothing readable says anyone must intervene).
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
  });

  it('reports an unresolved reference as unknown rather than absent', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    // The Change's committed evidence disappears AFTER publication; a read
    // re-resolves and must not present the node as merely not-started.
    f.git(f.storeRoot, ['rm', '-r', '-q', path.join('rasen', 'projects', PROJECT, 'changes', 'child-a')]);
    f.git(f.storeRoot, ['commit', '-m', 'remove child-a evidence']);
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes[0].observation).toBe('unknown');
    expect(status.problems[0].kind).toBe('unresolved-reference');
    expect(status.problems[0].node).toBe('g-001');
    // Same phase row as every other `unknown`: the plan is readable and the
    // reference broke after publication, so the Issue is not "back to
    // planning".
    expect(status.phase).toBe('active');
    expect(status.nodes[0].alias).toBe('child-a');
  });

  it('reports a scope-conflicted archived reference as unknown, never finalized', async () => {
    const instanceSeed = 'c3'.repeat(16);
    const instanceId = seedAndArchive('child-c', instanceSeed);
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Scope conflict' });
    // A node whose declared line disagrees with the committed identity is
    // REFUSED by publishPlan (`issue_reference_scope_conflict`) — but such a
    // revision can still become Store content by hand (identity moved after
    // publication, or the plan authored against another line), and a read must
    // face it. Forged here with the same digest helper and serializer
    // publication uses, so the revision itself is perfectly readable and only
    // the reference conflicts.
    const body = {
      version: 1 as const,
      issueId: ISSUE,
      revisionId: '0001',
      supersedes: null,
      createdAt: NOW,
      nodes: [
        {
          nodeId: 'g-003',
          kind: 'change' as const,
          projectId: PROJECT,
          targetLineId: 'side',
          changeInstanceId: instanceId,
          changeAlias: 'child-c',
          dependsOn: [] as readonly string[],
        },
      ],
    };
    fs.writeFileSync(
      f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml'),
      serializeExecutionPlanRevision({ ...body, contentSha256: executionPlanDigest(body) }),
      'utf8'
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'hand-commit scope-conflicted plan']);
    // The committed evidence is archived `landed`, but the query reports the
    // reference `ambiguous` (scope conflict) while carrying `archived: true`
    // and the outcome — the projection must not let that evidence answer
    // `finalized` and drop the conflict.
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.nodes[0].observation).toBe('unknown');
    expect(status.nodes[0].diagnostic).toContain('ambiguous');
    expect(status.problems).toHaveLength(1);
    expect(status.problems[0].kind).toBe('ambiguous-reference');
    expect(status.problems[0].node).toBe('g-003');
    // The node's OWN recorded alias, not the archive entry name the single
    // claimant carries — presenting claimants[0] would be the choice the query
    // refuses to make.
    expect(status.nodes[0].alias).toBe('child-c');
    // A conflicted reference counts toward nothing and closes nothing.
    expect(status.progress).toEqual({ completed: 0, total: 1 });
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
    // Reported-but-honest: the ambiguity is a problem entry, not a failure to
    // read what was reached, so it does not lower `complete`.
    expect(status.complete).toBe(true);
  });

  it('reports no progress for an unreadable latest revision, with the reason', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Digest broken' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'g-001',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: ids[0],
          changeAlias: 'child-a',
          dependsOn: [],
        },
      ],
    });
    // Break the working-tree copy's recorded digest: 0/0 would read "nothing
    // required", so the honest answer is no progress pair at all.
    const revisionPath = f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml');
    const corrupted = fs
      .readFileSync(revisionPath, 'utf8')
      .replace('contentSha256:', 'contentSha256X:');
    fs.writeFileSync(revisionPath, corrupted, 'utf8');
    const status = await readStatus({ executionRoot: execRoot, changesDir });
    expect(status.phase).toBe('planning');
    expect(status.progress).toBeNull();
    expect(status.problems[0].kind).toBe('unreadable-plan');
    expect(status.problems[0].reason).toContain('contentSha256');
    expect(status.complete).toBe(false);
  });

  it('carries unsearched refs as problems that lower completeness', async () => {
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16))];
    await publishPlan([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ids[0],
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    f.writeTargetLine({ id: 'broken-line', storeRef: 'refs/heads/does-not-exist' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'add broken line']);
    const detail = await showIssue();
    expect(detail.complete).toBe(false);
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    expect(status.complete).toBe(false);
    expect(status.problems.some(problem => problem.kind === 'unsearched-refs')).toBe(true);
    // The searchable ref still answers for its own node.
    expect(status.nodes[0].observation).toBe('not-started');
  });

  // ---------------------------------------------------------------------------
  // Determinism and read-only
  // ---------------------------------------------------------------------------

  it('yields the same status over unchanged evidence', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publishPlan(threeChangeNodes(ids as [string, string, string]));
    writeRunStateFor('child-a', stages({ propose: 'done', apply: 'in_progress' }));
    const first = await readStatus({ executionRoot: execRoot, changesDir });
    const second = await readStatus({ executionRoot: execRoot, changesDir });
    expect(second).toEqual(first);
  });
});

describe('the displayed dependency facts — the work-complete basis (g-002)', () => {
  const PROJECT_B = 'app-b';
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;
  let changesDir: string;
  const NO_WORK_DIR = async (): Promise<null> => null;

  function seedAndCommit(changeId: string, instanceSeed: string, projectId: string): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
    return seeded.instanceId;
  }

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function writeRunStateFor(alias: string, state: RunState): void {
    writeRunState(ephemeraDir(execRoot, alias), state);
  }

  /** The cross-project plan: downstream in app-a waits on upstream in app-b. */
  async function publishCrossPlan(): Promise<void> {
    seedAndCommit('child-up', 'e5'.repeat(16), PROJECT_B);
    seedAndCommit('child-down', 'f6'.repeat(16), PROJECT);
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Cross-project gating' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'g-up',
          kind: 'change',
          projectId: PROJECT_B,
          targetLineId: LINE,
          changeInstanceId: deriveChangeInstanceId({
            planningScopeId: f.planningScopeId(PROJECT_B, LINE),
            instanceSeed: 'e5'.repeat(16),
          }),
          changeAlias: 'child-up',
          dependsOn: [],
        },
        {
          nodeId: 'g-down',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: deriveChangeInstanceId({
            planningScopeId: f.planningScopeId(PROJECT, LINE),
            instanceSeed: 'f6'.repeat(16),
          }),
          changeAlias: 'child-down',
          dependsOn: ['g-up'],
        },
      ],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + cross plan']);
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

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-blockers-',
      projects: [PROJECT, PROJECT_B],
      lines: [
        { id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } },
      ],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('names a cross-project blocker with its target project and observed state', async () => {
    await publishCrossPlan();
    writeRunStateFor('child-up', stages({ propose: 'done', apply: 'in_progress' }));

    const status = await readStatus();
    // Publication normalizes node order (nodeId-sorted), so rows are found by
    // id, never by position.
    const upstream = status.nodes.find(node => node.nodeId === 'g-up');
    const downstream = status.nodes.find(node => node.nodeId === 'g-down');
    expect(upstream?.observation).toBe('in-flight');
    // The downstream's wait names WHICH member project the blocker runs in
    // and the state its work is in.
    expect(downstream?.blockedBy).toEqual([
      { nodeId: 'g-up', projectId: PROJECT_B, observation: 'in-flight' },
    ]);
    // An edge wait is ordinary ordering: healthy, never a blockage signal.
    expect(status.health).toBe('healthy');
    expect(status.phase).toBe('active');
  });

  it('drops a dependency whose work is terminal but unarchived from the blocker list', async () => {
    await publishCrossPlan();
    // Terminal WORK with NO archive: the discriminating cell between the two
    // bases — the archive-based list kept this edge, the work-complete rule
    // `start` enforces does not.
    writeRunStateFor(
      'child-up',
      stages({
        propose: 'done',
        apply: 'done',
        verify: 'done',
        'review-loop': 'done',
        ship: 'done',
        archive: 'done',
      })
    );

    const status = await readStatus();
    const upstream = status.nodes.find(node => node.nodeId === 'g-up');
    const downstream = status.nodes.find(node => node.nodeId === 'g-down');
    expect(upstream?.observation).toBe('run-terminal');
    // The dependency whose work is done stops reading as a blocker before its
    // Change is archived, while its own line still reports run-terminal.
    expect(downstream?.blockedBy).toEqual([]);
    expect(status.progress).toEqual({ completed: 1, total: 2 });
  });

  it('names an intent dependency with its project and not-started observation', async () => {
    seedAndCommit('child-down', 'f6'.repeat(16), PROJECT);
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Intent dep' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'i-up',
          kind: 'intent',
          projectId: PROJECT_B,
          targetLineId: LINE,
          summary: 'Work declared but no Change exists yet',
          dependsOn: [],
        },
        {
          nodeId: 'g-down',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: deriveChangeInstanceId({
            planningScopeId: f.planningScopeId(PROJECT, LINE),
            instanceSeed: 'f6'.repeat(16),
          }),
          changeAlias: 'child-down',
          dependsOn: ['i-up'],
        },
      ],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + intent plan']);

    const status = await readStatus();
    // An intent dependency holds its downstream (no Change exists, nothing
    // completed) and is named with the intent node's own target project.
    const downstream = status.nodes.find(node => node.nodeId === 'g-down');
    expect(downstream?.blockedBy).toEqual([
      { nodeId: 'i-up', projectId: PROJECT_B, observation: 'not-started' },
    ]);
  });
});
