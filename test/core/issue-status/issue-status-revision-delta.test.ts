/**
 * `issue-autodecompose-review-flow` task 4.1 — the revision delta on the
 * Issue read surface, over a REAL Git Store fixture: two published revisions,
 * read with the predecessor the latest supersedes (the same input shape the
 * CLI's `show` composes), and the delta asserted node by node.
 *
 * The retarget row uses an INTENT node deliberately: an intent node's target
 * project is the plan author's PROPOSAL, so a revision may retarget it — a
 * Change node's target is verified against committed identity at publication
 * and cannot be retargeted away from where its Change lives.
 *
 * The axes-unchanged row is the delta requirement's own fence: the delta is
 * derived AFTER every axis was decided and drives none of them — asserted by
 * reading the same latest revision with and without the predecessor input and
 * comparing the axes exactly.
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
import { projectIssueStatus, type IssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-21T00:00:00.000Z';
const LINE = 'main';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const ISSUE = 'iss-delta';

describe('the revision delta on the Issue read surface', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let changesDir: string;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  const NO_WORK_DIR = async (): Promise<null> => null;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-delta-',
      projects: [PROJECT_A, PROJECT_B],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT_A]: 'refs/heads/main', [PROJECT_B]: 'refs/heads/main' },
        },
      ],
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

  async function publish(nodes: readonly ExecutionPlanNodeInput[]): Promise<string> {
    const result = await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes,
      // The registry membership test the module takes as an injected input —
      // every suggestion in these fixtures names a pipeline these units are
      // not interested in resolving for real.
      pipelineKnown: () => true,
    });
    return result.revision.revisionId;
  }

  async function readStatus(withPredecessor: boolean): Promise<IssueStatus> {
    const query = new StoreQueryModuleImpl();
    const detail = await query.showIssue({ ...scope(), issueId: ISSUE });
    const supersedes = detail.plan?.revision?.supersedes ?? null;
    const predecessorPlan =
      withPredecessor && supersedes !== null
        ? await query.resolveExecutionPlan({ ...scope(), issueId: ISSUE, revisionId: supersedes })
        : null;
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      predecessorPlan,
    });
  }

  it('names the removed, retargeted, re-edged, and added nodes of the latest revision', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Delta projection' });
    const keepInstance = seedAndCommit('child-keep', 'c1'.repeat(16), PROJECT_A);
    // Revision 0001: one Change node plus two intent proposals.
    await publish([
      {
        nodeId: 'g-keep',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: keepInstance,
        changeAlias: 'child-keep',
        dependsOn: [],
      },
      {
        nodeId: 'i-move',
        kind: 'intent',
        projectId: PROJECT_A,
        targetLineId: LINE,
        summary: 'work declared, no Change yet',
        suggestedPipeline: 'small-feature',
        rationale: 'proposed for app-a first',
        dependsOn: [],
      },
      {
        nodeId: 'i-lose',
        kind: 'intent',
        projectId: PROJECT_A,
        targetLineId: LINE,
        summary: 'unwanted proposal',
        suggestedPipeline: 'small-feature',
        rationale: 'dropped in review',
        dependsOn: [],
      },
    ]);
    // Revision 0002: i-lose removed (omission is intent cancellation);
    // i-move retargeted to app-b; g-keep re-edged to depend on i-move; i-new
    // added carrying an optional lifecycle and a suggestion.
    await publish([
      {
        nodeId: 'g-keep',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: keepInstance,
        changeAlias: 'child-keep',
        dependsOn: ['i-move'],
      },
      {
        nodeId: 'i-move',
        kind: 'intent',
        projectId: PROJECT_B,
        targetLineId: LINE,
        summary: 'work declared, no Change yet',
        suggestedPipeline: 'small-feature',
        rationale: 'review moved the proposal to app-b',
        dependsOn: [],
      },
      {
        nodeId: 'i-new',
        kind: 'intent',
        projectId: PROJECT_A,
        targetLineId: LINE,
        summary: 'work the review added',
        lifecycle: 'optional',
        suggestedPipeline: 'small-feature',
        rationale: 'polish after the move',
        dependsOn: [],
      },
    ]);

    const status = await readStatus(true);
    expect(status.delta).not.toBeNull();
    const delta = status.delta as NonNullable<IssueStatus['delta']>;
    expect(delta.revisionId).toBe('0002');
    expect(delta.supersedes).toBe('0001');
    expect(delta.added).toEqual(['i-new']);
    expect(delta.removed).toEqual(['i-lose']);
    expect(delta.retargeted).toEqual([
      {
        nodeId: 'i-move',
        fromProjectId: PROJECT_A,
        toProjectId: PROJECT_B,
        fromTargetLineId: LINE,
        toTargetLineId: LINE,
      },
    ]);
    expect(delta.edgeChanges).toEqual([
      { nodeId: 'g-keep', addedDependencies: ['i-move'], removedDependencies: [] },
    ]);
    // Field-wise changes are diffed only over nodes BOTH revisions carry — an
    // added node's own lifecycle (optional here) is a fact of its node line,
    // not a change row, and no same-id node changed lifecycle or suggestion.
    expect(delta.lifecycleChanges).toEqual([]);
    expect(delta.suggestionChanges).toEqual([]);
  });

  it('derives identical axes with and without the predecessor input — the delta drives nothing', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Delta projection' });
    const instanceA = seedAndCommit('child-a', 'a1'.repeat(16), PROJECT_A);
    const instanceB = seedAndCommit('child-b', 'b2'.repeat(16), PROJECT_B);
    await publish([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: instanceA,
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    await publish([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: instanceA,
        changeAlias: 'child-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: instanceB,
        changeAlias: 'child-b',
        dependsOn: [],
      },
    ]);
    const withPredecessor = await readStatus(true);
    const without = await readStatus(false);
    expect(without.delta).toBeNull();
    expect(withPredecessor.phase).toBe(without.phase);
    expect(withPredecessor.health).toBe(without.health);
    expect(withPredecessor.progress).toEqual(without.progress);
    expect(withPredecessor.complete).toBe(without.complete);
    expect(withPredecessor.problems).toEqual(without.problems);
    expect(withPredecessor.delta?.added).toEqual(['g-002']);
  });

  it('reports no delta for a first revision', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Delta projection' });
    const instanceA = seedAndCommit('child-a', 'a1'.repeat(16), PROJECT_A);
    await publish([
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: instanceA,
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ]);
    const status = await readStatus(false);
    expect(status.delta).toBeNull();
    // The node lines are unaffected by the delta's absence.
    expect(status.nodes.map(node => node.nodeId)).toEqual(['g-001']);
  });

  it('names an optional intent node on its node line and counts it in no progress pair', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Delta projection' });
    await publish([
      {
        nodeId: 'i-opt',
        kind: 'intent',
        projectId: PROJECT_A,
        targetLineId: LINE,
        summary: 'optional polish work',
        lifecycle: 'optional',
        suggestedPipeline: 'small-feature',
        rationale: 'nice to have',
        dependsOn: [],
      },
      {
        nodeId: 'i-need',
        kind: 'intent',
        projectId: PROJECT_A,
        targetLineId: LINE,
        summary: 'demanded work',
        suggestedPipeline: 'bug-fix',
        rationale: 'core',
        dependsOn: [],
      },
    ]);
    const status = await readStatus(false);
    const optional = status.nodes.find(node => node.nodeId === 'i-opt');
    expect(optional?.lifecycle).toBe('optional');
    const required = status.nodes.find(node => node.nodeId === 'i-need');
    expect(required?.lifecycle).toBe('required');
    // Intent nodes count in no progress pair, either part — an optional one
    // doubly so: 0/0 over zero required CHANGE nodes, in the Issue pair and
    // the lane pair alike.
    expect(status.progress).toEqual({ completed: 0, total: 0 });
    expect(status.projects).toHaveLength(1);
    expect(status.projects[0]?.progress).toEqual({ completed: 0, total: 0 });
  });
});
