/**
 * `issue-node-lifecycle` task 3.2 — the gate's required-scoped blockers and
 * the exclusions reported beside it, over a REAL Git Store fixture (the same
 * discipline as `issue-acceptance-gate.test.ts`, which stays the authority
 * for the all-required rows).
 *
 * Every test maps to one scenario of the MODIFIED gate requirement: optional
 * never blocks on completion; cancelled/superseded leave the required total
 * as named exclusions with their recorded reasons; zero required nodes is an
 * eligible, stated 0/0 rather than a quiet vacuous pass.
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

const NOW = '2026-08-20T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-gate-lc';

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

describe('the acceptance gate under node lifecycles', () => {
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
      prefix: 'rasen-gate-lifecycle-',
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

  function writePortfolioFor(alias: string, state: PortfolioState): string {
    const dir = ephemeraDir(execRoot, alias);
    writePortfolioState(dir, state);
    return path.join(dir, 'portfolio-run.json');
  }

  const node = (
    nodeId: string,
    changeInstanceId: string,
    alias: string,
    extra: Partial<Pick<ExecutionPlanNodeInput, 'lifecycle' | 'reason'>> = {}
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

  async function setup(
    nodes: readonly ExecutionPlanNodeInput[]
  ): Promise<void> {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Gate lifecycle' });
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    await issues().publishAcceptance({
      ...scope(),
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'The lifecycle semantics are shipped' }],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + conditions']);
  }

  async function gateOf() {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    const facts = await readIssueAcceptanceFacts({ ...scope(), issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      acceptance: facts,
    });
    return { status, gate: status.acceptance?.gate };
  }

  it('reports eligible with an unfinished optional node, naming it nowhere as a blocker', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'optional' }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // The optional node has not started at all.
    const { status, gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      expect(gate.blockers).toBeUndefined();
      expect(gate.snapshot).toEqual({
        completed: 1,
        total: 1,
        health: 'waiting-human',
        problemsStanding: 0,
      });
      expect(gate.optionalNodes).toEqual(['g-opt']);
      expect(gate.exclusions).toEqual([]);
    }
    // Its not-started observation lives on the node line, not as a blocker.
    expect(status.nodes.find(entry => entry.nodeId === 'g-opt')?.observation).toBe('not-started');
  });

  it('shows a cancelled exclusion with its recorded reason beside an eligible gate', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-cut', ids[1], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'descoped: the operator dropped this child mid-portfolio',
      }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    const { gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      // Eligible over the required nodes alone, total explained by the named
      // exclusion rather than silently absorbed.
      expect(gate.snapshot.total).toBe(1);
      expect(gate.exclusions).toEqual([
        {
          nodeId: 'g-cut',
          lifecycle: 'cancelled',
          reason: 'descoped: the operator dropped this child mid-portfolio',
        },
      ]);
    }
  });

  it('shows a superseded exclusion whose reason names its successor', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-sup', 'c3'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-002', ids[1], 'child-b'),
      node('g-sup', ids[2], 'child-sup', {
        lifecycle: 'superseded',
        reason: 'folded into g-002, which carries the same work',
      }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    writeRunStateFor('child-b', TERMINAL());
    const { gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      expect(gate.exclusions).toEqual([
        {
          nodeId: 'g-sup',
          lifecycle: 'superseded',
          reason: 'folded into g-002, which carries the same work',
        },
      ]);
      // The successor is findable from the reason the revision records.
      expect(gate.exclusions[0]?.reason).toContain('g-002');
    }
  });

  it('reports an eligible gate over zero required nodes as a stated fact', async () => {
    const ids = [
      seedAndCommit('child-opt', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-opt', ids[0], 'child-opt', { lifecycle: 'optional' }),
      node('g-cut', ids[1], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'descoped before any work ran',
      }),
    ]);
    const { gate } = await gateOf();
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      // The coherent 0/0 snapshot: no work is demanded.
      expect(gate.snapshot).toEqual({
        completed: 0,
        total: 0,
        health: 'waiting-human',
        problemsStanding: 0,
      });
      // The exclusions and optional nodes are named beside the gate, not
      // hidden by the empty total.
      expect(gate.exclusions.map(exclusion => exclusion.nodeId)).toEqual(['g-cut']);
      expect(gate.optionalNodes).toEqual(['g-opt']);
    }
  });

  it('holds the gate on a FAILED optional node — wanted work failed, health routes it', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-opt', ids[1], 'child-opt', { lifecycle: 'optional' }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // The optional child's portfolio records a child escalated after failure
    // (fixture bytes from the frozen writer, as in the all-required suite).
    writePortfolioFor('child-opt', {
      parent: 'child-opt',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    });
    const { status, gate } = await gateOf();
    expect(status.health).toBe('failed');
    expect(gate?.eligible).toBe(false);
    if (gate && !gate.eligible) {
      expect(gate.refusalCode).toBe('issue_accept_blocked');
      // Named as the failure behind the health — never as an un-terminal
      // blocker, because no required work is being demanded of it.
      expect(gate.blockers).toContainEqual({ kind: 'failing-node', nodeId: 'g-opt' });
      expect(gate.blockers).not.toContainEqual({
        kind: 'un-terminal-node',
        nodeId: 'g-opt',
        observation: 'failed',
      });
    }
  });

  it('keeps a cancelled node out of every blocker list even with a recorded failure', async () => {
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-cut', 'b2'.repeat(16)),
    ];
    await setup([
      node('g-001', ids[0], 'child-a'),
      node('g-cut', ids[1], 'child-cut', {
        lifecycle: 'cancelled',
        reason: 'failed twice and descoped',
      }),
    ]);
    writeRunStateFor('child-a', TERMINAL());
    // The cancelled node carries a live failure escalation: history, not health,
    // not a blocker — only the exclusion names it.
    writePortfolioFor('child-cut', {
      parent: 'child-cut',
      children: [{ id: 'sub-1', pipeline: 'bug-fix', dependsOn: [], status: 'escalated' }],
      delivery: { status: 'pending' },
    });
    const { status, gate } = await gateOf();
    expect(status.health).not.toBe('failed');
    expect(gate?.eligible).toBe(true);
    if (gate?.eligible) {
      expect(gate.exclusions.map(exclusion => exclusion.nodeId)).toEqual(['g-cut']);
      expect(gate.snapshot.total).toBe(1);
    }
  });
});
