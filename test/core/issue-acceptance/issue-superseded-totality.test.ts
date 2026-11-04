/**
 * `issue-revision-history-preservation` task 4.1 — the superseded exit
 * verified TOTAL across every consuming surface, in ONE fixture: revision N
 * (X required with terminal run-state, Y required not-started), revision N+1
 * marking X superseded with a reason naming its successor — then, in one
 * test, the ready answer names X's exit with its reason, the gate excludes X
 * with the reason and reports eligible once Y completes, the delta names the
 * lifecycle change, X's observation stays on its node line, and the prior
 * revision still composes X's terminal fact (`confirm --revision`'s own
 * ordinal read).
 *
 * Each consumer has its own focused suite elsewhere (gate: the
 * `issue-acceptance-gate-lifecycle` rows; ready-set: `issue-ready-set`;
 * delta: `issue-status-revision-delta`); this test is the composed-truth pin
 * — the surfaces agree about ONE supersede, or the story was never whole.
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
import {
  deriveIssueReadySet,
  projectIssueStatus,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';
import { readIssueAcceptanceFacts } from '../../../src/core/issue-acceptance/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-total';
const REASON = 'folded into g-002, which carries the same work';

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

describe('the superseded exit is total across every consuming surface', () => {
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
      prefix: 'rasen-issue-totality-',
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

  function writeRunStateFor(alias: string, state: RunState): void {
    writeRunState(ephemeraDir(execRoot, alias), state);
  }

  async function publish(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'plan revision']);
  }

  async function readStatus(): Promise<IssueStatus> {
    const query = new StoreQueryModuleImpl();
    const detail = await query.showIssue({ ...scope(), issueId: ISSUE });
    const supersedes = detail.plan?.revision?.supersedes ?? null;
    const predecessorPlan =
      supersedes === null
        ? null
        : await query.resolveExecutionPlan({ ...scope(), issueId: ISSUE, revisionId: supersedes });
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      predecessorPlan,
      acceptance: await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE }),
    });
  }

  it('walks one full supersede and every consumer answers with the same reason', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Totality' });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'The superseded exit is total' }],
    });
    const node = (
      nodeId: string,
      instanceId: string,
      alias: string,
      extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason'>> = {}
    ): ExecutionPlanNodeInput => ({
      nodeId,
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: instanceId,
      changeAlias: alias,
      dependsOn: [],
      ...extra,
    });
    const [x, y] = [
      seedAndCommit('child-x', 'a1'.repeat(16)),
      seedAndCommit('child-y', 'b2'.repeat(16)),
    ];

    // Revision N: X required with terminal run-state, Y required not-started.
    await publish([node('g-001', x, 'child-x'), node('g-002', y, 'child-y')]);
    writeRunStateFor('child-x', TERMINAL());

    // Revision N+1: X superseded, its reason naming the successor.
    await publish([
      node('g-001', x, 'child-x', { lifecycle: 'superseded', reason: REASON }),
      node('g-002', y, 'child-y'),
    ]);

    const status = await readStatus();

    // (1) The ready answer names X's exit with the reason (and Y is the one
    // member — the successor is runnable, the superseded node is not).
    const ready = deriveIssueReadySet(status);
    expect(ready).not.toBeNull();
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-002']);
    const exit = ready?.exits.find(entry => entry.nodeId === 'g-001');
    expect(exit?.reason).toEqual({ kind: 'superseded', reason: REASON });

    // (2) The gate excludes X with the reason; Y un-terminal holds it, and
    // the same fixture turns eligible the moment Y completes.
    const factsBefore = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    const gateBefore = status.acceptance?.gate;
    expect(gateBefore?.eligible).toBe(false);
    expect(gateBefore?.exclusions).toEqual([{ nodeId: 'g-001', lifecycle: 'superseded', reason: REASON }]);
    expect(factsBefore.acceptedRecord.present).toBe(false);
    writeRunStateFor('child-y', TERMINAL());
    const statusAfter = await readStatus();
    const gateAfter = statusAfter.acceptance?.gate;
    expect(gateAfter?.eligible).toBe(true);
    expect(gateAfter?.snapshot).toEqual({
      completed: 1,
      total: 1,
      health: 'waiting-human',
      problemsStanding: 0,
    });
    expect(gateAfter?.exclusions).toEqual([
      { nodeId: 'g-001', lifecycle: 'superseded', reason: REASON },
    ]);

    // (3) The delta names the lifecycle change with the stable node id.
    expect(statusAfter.delta?.lifecycleChanges).toEqual([
      { nodeId: 'g-001', from: 'required', to: 'superseded' },
    ]);

    // (4) X's observation stays on its node line in the CURRENT revision —
    // outside the graph (progress 1/1 over Y alone), still observed terminal.
    const xRow = statusAfter.nodes.find(entry => entry.nodeId === 'g-001');
    expect(xRow?.observation).toBe('run-terminal');
    expect(xRow?.lifecycle).toBe('superseded');
    expect(xRow?.reason).toBe(REASON);
    expect(statusAfter.progress).toEqual({ completed: 1, total: 1 });

    // (5) The prior revision still composes X's terminal fact — the ordinal
    // read `confirm --revision` resolves, projected the same way.
    const query = new StoreQueryModuleImpl();
    const detail = await query.showIssue({ ...scope(), issueId: ISSUE });
    const priorPlan = await query.resolveExecutionPlan({ ...scope(), issueId: ISSUE, revisionId: '0001' });
    const prior = await projectIssueStatus({
      detail: { ...detail, plan: priorPlan },
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
    const priorX = prior.nodes.find(entry => entry.nodeId === 'g-001');
    expect(priorX?.observation).toBe('run-terminal');
    expect(priorX?.lifecycle).toBe('required');
    // The prior revision composes over TODAY's run-state — both children have
    // terminal evidence by this point in the story — so its pair reads 2/2
    // over its own two required nodes, with X's terminal fact intact exactly
    // as revision N recorded the graph.
    expect(prior.progress).toEqual({ completed: 2, total: 2 });
  });
});
