/**
 * `issue-project-grouped-views` — the per-project lane derivation, over a REAL
 * Git Store fixture and real run-state files written into a temp execution
 * root.
 *
 * Every scenario maps to a clause of the lane requirement: one lane per
 * distinct target project, lane progress on the SAME work-complete rule and
 * required scoping as the Issue pair (per-lane pairs sum to it), optional and
 * cancelled work listed but uncounted, zero-over-zero for a lane that demands
 * no work, no lanes for an unreadable revision, and lanes driving no axis —
 * proven by a two-project revision and a node-equivalent single-project one
 * deriving identical axes.
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
import { projectIssueStatus, type IssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const PROJECT_C = 'app-c';
const ISSUE = 'iss-lanes';

function stages(statuses: Record<string, StageStatus>): RunState {
  return {
    pipeline: 'small-feature',
    stages: Object.fromEntries(
      Object.entries(statuses).map(([id, status]) => [id, { status }])
    ),
  };
}

const TERMINAL = stages({
  propose: 'done',
  apply: 'done',
  verify: 'done',
  'review-loop': 'done',
  ship: 'done',
  archive: 'done',
});
const IN_FLIGHT = stages({ propose: 'done', apply: 'in_progress' });

describe('the per-project lane derivation', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let changesDir: string;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
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

  async function readStatus(
    issueId: string,
    projectAliases?: Readonly<Record<string, string>>
  ): Promise<IssueStatus> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId });
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      ...(projectAliases === undefined ? {} : { projectAliases }),
    });
  }

  /** Creates the Issue and publishes a committed plan from node inputs. */
  async function publishPlan(
    issueId: string,
    title: string,
    nodes: readonly ExecutionPlanNodeInput[]
  ): Promise<void> {
    await issues().create({ ...scope(), issueId, title });
    await issues().publishPlan({ ...scope(), issueId, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `issue + plan ${issueId}`]);
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-lanes-',
      projects: [PROJECT_A, PROJECT_B, PROJECT_C],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT_A]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('derives one lane per distinct target project, per-lane pairs summing to the Issue pair', async () => {
    const aCore = seedAndCommit('child-a-core', 'a1'.repeat(16), PROJECT_A);
    const aDropped = seedAndCommit('child-a-drop', 'a2'.repeat(16), PROJECT_A);
    const aExtra = seedAndCommit('child-a-extra', 'a3'.repeat(16), PROJECT_A);
    const bDown = seedAndCommit('child-b-down', 'b1'.repeat(16), PROJECT_B);
    const bUp = seedAndCommit('child-b-up', 'b2'.repeat(16), PROJECT_B);
    await publishPlan(ISSUE, 'Lane shapes', [
      {
        nodeId: 'a-core',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: aCore,
        changeAlias: 'child-a-core',
        dependsOn: [],
      },
      {
        nodeId: 'a-dropped',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: aDropped,
        changeAlias: 'child-a-drop',
        lifecycle: 'cancelled',
        reason: 'folded into a-core',
        dependsOn: [],
      },
      {
        nodeId: 'a-extra',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: aExtra,
        changeAlias: 'child-a-extra',
        lifecycle: 'optional',
        dependsOn: [],
      },
      {
        nodeId: 'b-future',
        kind: 'intent',
        projectId: PROJECT_B,
        targetLineId: LINE,
        summary: 'Declared site work with no Change yet',
        dependsOn: [],
      },
      {
        nodeId: 'b-down',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: bDown,
        changeAlias: 'child-b-down',
        dependsOn: ['a-core'],
      },
      {
        nodeId: 'b-up',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: bUp,
        changeAlias: 'child-b-up',
        dependsOn: ['b-future'],
      },
      {
        nodeId: 'c-future',
        kind: 'intent',
        projectId: PROJECT_C,
        targetLineId: LINE,
        summary: 'A project the plan names with no work demanded',
        dependsOn: [],
      },
    ]);
    // The lane-relevant observations: the optional node's work is terminal,
    // b-up's required work is terminal WITHOUT an archive (the work-complete
    // basis cell), b-down is in flight.
    writeRunStateFor('child-a-extra', TERMINAL);
    writeRunStateFor('child-b-up', TERMINAL);
    writeRunStateFor('child-b-down', IN_FLIGHT);

    const status = await readStatus(ISSUE);

    // Lane order is project-identity code-point order: app-a < app-b < app-c.
    expect(status.projects.map(lane => lane.projectId)).toEqual([
      PROJECT_A,
      PROJECT_B,
      PROJECT_C,
    ]);
    // Each lane lists exactly its own nodes, in the revision's canonical
    // (nodeId-sorted) order; the flat nodes array is that same order.
    expect(status.projects[0].nodeIds).toEqual(['a-core', 'a-dropped', 'a-extra']);
    expect(status.projects[1].nodeIds).toEqual(['b-down', 'b-future', 'b-up']);
    expect(status.projects[2].nodeIds).toEqual(['c-future']);
    expect(status.nodes.map(node => node.nodeId)).toEqual([
      'a-core',
      'a-dropped',
      'a-extra',
      'b-down',
      'b-future',
      'b-up',
      'c-future',
    ]);

    // app-a: one required node (a-core), not started — the cancelled and
    // optional nodes are named in the lane and counted nowhere, even though
    // the optional one's work is terminal.
    expect(status.projects[0].progress).toEqual({ completed: 0, total: 1 });
    // app-b: two required nodes — the terminal-but-unarchived one counts, the
    // in-flight one does not; the intent node carries no lifecycle and counts
    // nowhere.
    expect(status.projects[1].progress).toEqual({ completed: 1, total: 2 });
    // app-c: a lane that demands no work reports the stated 0/0.
    expect(status.projects[2].progress).toEqual({ completed: 0, total: 0 });

    // The per-lane pairs sum to the Issue pair over required nodes — one
    // rule, two scopes, no third basis.
    expect(status.progress).toEqual({ completed: 1, total: 3 });
    expect(
      status.projects.reduce(
        (sum, lane) => ({ completed: sum.completed + lane.progress.completed, total: sum.total + lane.progress.total }),
        { completed: 0, total: 0 }
      )
    ).toEqual(status.progress);

    // The lane view drove no axis: the same observations the Phase-1 table
    // derives — in-flight required work is active, an edge wait is healthy.
    expect(status.phase).toBe('active');
    expect(status.health).toBe('healthy');
  });

  it('derives exactly one lane for a single-project plan, and lanes drive no axis', async () => {
    // Two node-equivalent revisions: one spans app-a/app-b, one names app-a
    // alone. Same lifecycles, same observations — if lanes drove any axis,
    // these two reads would disagree.
    const spanUp = seedAndCommit('child-span-up', 'c1'.repeat(16), PROJECT_A);
    const spanDown = seedAndCommit('child-span-down', 'c2'.repeat(16), PROJECT_B);
    await publishPlan('iss-span', 'Spanning', [
      {
        nodeId: 'x-up',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: spanUp,
        changeAlias: 'child-span-up',
        dependsOn: [],
      },
      {
        nodeId: 'x-down',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: spanDown,
        changeAlias: 'child-span-down',
        dependsOn: ['x-up'],
      },
    ]);
    const oneUp = seedAndCommit('child-one-up', 'd1'.repeat(16), PROJECT_A);
    const oneDown = seedAndCommit('child-one-down', 'd2'.repeat(16), PROJECT_A);
    await publishPlan('iss-one', 'Single project', [
      {
        nodeId: 'y-up',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: oneUp,
        changeAlias: 'child-one-up',
        dependsOn: [],
      },
      {
        nodeId: 'y-down',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: oneDown,
        changeAlias: 'child-one-down',
        dependsOn: ['y-up'],
      },
    ]);
    writeRunStateFor('child-span-up', TERMINAL);
    writeRunStateFor('child-span-down', IN_FLIGHT);
    writeRunStateFor('child-one-up', TERMINAL);
    writeRunStateFor('child-one-down', IN_FLIGHT);

    const span = await readStatus('iss-span');
    const one = await readStatus('iss-one');

    // Identical axes across the two shapes — the project fact is not
    // interpreted into any axis value.
    expect(span.phase).toBe(one.phase);
    expect(span.health).toBe(one.health);
    expect(span.progress).toEqual(one.progress);
    expect(span.phase).toBe('active');
    expect(span.progress).toEqual({ completed: 1, total: 2 });

    expect(span.projects).toHaveLength(2);
    // The single-project revision carries exactly one lane whose pair equals
    // the Issue-level pair over the same nodes.
    expect(one.projects).toHaveLength(1);
    expect(one.projects[0].projectId).toBe(PROJECT_A);
    expect(one.projects[0].progress).toEqual(one.progress);
    expect(one.projects[0].nodeIds).toEqual(['y-down', 'y-up']);
  });

  it('reports no lanes for an unreadable latest revision', async () => {
    const up = seedAndCommit('child-broken-up', 'e1'.repeat(16), PROJECT_A);
    await publishPlan(ISSUE, 'Digest broken', [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: up,
        changeAlias: 'child-broken-up',
        dependsOn: [],
      },
    ]);
    // Break the recorded digest and COMMIT the broken bytes (the query reads
    // committed content first): empty lanes would read "no projects" — a
    // different claim than "no readable revision".
    const revisionPath = f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml');
    const corrupted = fs
      .readFileSync(revisionPath, 'utf8')
      .replace('contentSha256:', 'contentSha256X:');
    fs.writeFileSync(revisionPath, corrupted, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'corrupt plan digest']);

    const status = await readStatus(ISSUE);
    expect(status.progress).toBeNull();
    expect(status.projects).toEqual([]);
    expect(status.problems[0].kind).toBe('unreadable-plan');
  });

  it('carries the supplied display alias as an input fact, never a guess', async () => {
    const up = seedAndCommit('child-alias-up', 'f1'.repeat(16), PROJECT_A);
    const down = seedAndCommit('child-alias-down', 'f2'.repeat(16), PROJECT_B);
    await publishPlan(ISSUE, 'Alias input', [
      {
        nodeId: 'a-up',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: up,
        changeAlias: 'child-alias-up',
        dependsOn: [],
      },
      {
        nodeId: 'a-down',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: down,
        changeAlias: 'child-alias-down',
        dependsOn: ['a-up'],
      },
    ]);

    const aliased = await readStatus(ISSUE, {
      [PROJECT_A]: 'Core App',
      [PROJECT_B]: 'Site',
    });
    expect(aliased.projects.map(lane => lane.alias)).toEqual(['Core App', 'Site']);

    // Without the input, no alias is invented: null, and nothing else moved —
    // grouping, ordering, and every axis are the same facts.
    const bare = await readStatus(ISSUE);
    expect(bare.projects.map(lane => lane.alias)).toEqual([null, null]);
    expect(bare.projects.map(lane => [lane.projectId, lane.nodeIds, lane.progress])).toEqual(
      aliased.projects.map(lane => [lane.projectId, lane.nodeIds, lane.progress])
    );
    expect(bare.phase).toBe(aliased.phase);
    expect(bare.health).toBe(aliased.health);
    expect(bare.progress).toEqual(aliased.progress);
  });
});
