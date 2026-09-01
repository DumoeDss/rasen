/**
 * `issue-revision-history-preservation` tasks 2.1–2.4 — the retarget-lineage
 * pins over a REAL two-project Git Store fixture: a Change node whose target
 * project or line changes between revisions carries a NEW Change instance
 * (the publication refusal forces it), the new revision reads the node fresh
 * unless the new instance carries its own evidence, and the prior lineage's
 * facts stay readable in the prior revision (resolved the same read
 * `confirm --revision` uses) and the delta's retarget entry.
 *
 * The refusal pin (2.1) is this group's mutation check: it proves the
 * fresh-lineage rule has a teeth-path — the scope conflict is what makes a
 * publishable retarget necessarily carry a new instance, so lineage cannot
 * blur through publication at all.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssueError,
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

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const ISSUE = 'iss-rt';

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

describe('a retargeted node starts a new observation lineage', () => {
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
      prefix: 'rasen-issue-retarget-',
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

  function seedAndCommit(
    changeId: string,
    instanceSeed: string,
    projectId: string
  ): string {
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

  function writeRunStateFor(alias: string, state: RunState): string {
    const dir = ephemeraDir(execRoot, alias);
    writeRunState(dir, state);
    return path.join(dir, 'auto-run.json');
  }

  async function publish(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes,
      // The registry membership test the module takes as an injected input —
      // the intent rows name suggestions these units do not resolve for real.
      pipelineKnown: () => true,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'plan revision']);
  }

  /** The projection read, exactly the shape the CLI's show composes. */
  async function readStatus(): Promise<IssueStatus> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    const supersedes = detail.plan?.revision?.supersedes ?? null;
    const predecessorPlan =
      supersedes === null
        ? null
        : await new StoreQueryModuleImpl().resolveExecutionPlan({
            ...scope(),
            issueId: ISSUE,
            revisionId: supersedes,
          });
    return projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
      predecessorPlan,
    });
  }

  /**
   * The prior revision's own composition — the same read `confirm
   * --revision` resolves (`resolveExecutionPlan` on the named ordinal),
   * assembled around the projection the same way its input doc allows.
   */
  async function readPriorRevision(revisionId: string): Promise<IssueStatus> {
    const query = new StoreQueryModuleImpl();
    const detail = await query.showIssue({ ...scope(), issueId: ISSUE });
    const plan = await query.resolveExecutionPlan({ ...scope(), issueId: ISSUE, revisionId });
    return projectIssueStatus({
      detail: { ...detail, plan },
      executionRoot: execRoot,
      changesDir,
      workDirFor: NO_WORK_DIR,
    });
  }

  const node = (
    nodeId: string,
    projectId: string,
    changeInstanceId: string,
    alias: string,
    extra: Partial<Pick<ExecutionPlanNodeInput, 'dependsOn'>> = {}
  ): ExecutionPlanNodeInput => ({
    nodeId,
    kind: 'change',
    projectId,
    targetLineId: LINE,
    changeInstanceId,
    changeAlias: alias,
    dependsOn: [],
    ...extra,
  });

  it('refuses a retarget that keeps the old instance, naming both scopes, creating no revision', async () => {
    const created = await issues().create({ ...scope(), issueId: ISSUE, title: 'Retarget' });
    const instanceA = seedAndCommit('child-x', 'a1'.repeat(16), PROJECT_A);
    await publish([node('g-x', PROJECT_A, instanceA, 'child-x')]);

    // The retarget that must NOT publish: g-x redeclared under project B
    // while naming the instance committed under project A.
    let thrown: unknown;
    try {
      await publish([node('g-x', PROJECT_B, instanceA, 'child-x')]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreIssueError);
    const refusal = thrown as StoreIssueError;
    expect(refusal.issueCode).toBe('issue_reference_scope_conflict');
    expect(refusal.message).toContain("Node 'g-x' declares app-b/main");
    expect(refusal.message).toContain(`is committed as app-a/main`);

    // No revision was created: the plans directory still holds exactly the
    // one revision, so no lineage could blur through a half-published state.
    const plans = f
      .git(f.storeRoot, ['ls-files', `rasen/issues/${created.identity.uid}/plans`])
      .split(/\r?\n/u)
      .filter(line => line.trim().length > 0);
    expect(plans).toEqual([`rasen/issues/${created.identity.uid}/plans/0001.yaml`]);
  });

  it('reads a retargeted node fresh while the prior revision keeps its terminal history', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Retarget' });
    const instanceA = seedAndCommit('child-x', 'a1'.repeat(16), PROJECT_A);
    const instanceB = seedAndCommit('child-x2', 'b2'.repeat(16), PROJECT_B);
    await publish([node('g-x', PROJECT_A, instanceA, 'child-x')]);
    writeRunStateFor('child-x', TERMINAL());
    const readN = await readStatus();
    expect(readN.nodes.find(entry => entry.nodeId === 'g-x')?.observation).toBe('run-terminal');

    // N+1 retargets g-x to project B on a NEW instance with no run-state and
    // no archive evidence — the old lineage's run-state lives under the old
    // alias and must not leak into the new node's observation.
    await publish([node('g-x', PROJECT_B, instanceB, 'child-x2')]);
    const readN1 = await readStatus();
    const retargeted = readN1.nodes.find(entry => entry.nodeId === 'g-x');
    expect(retargeted?.observation).toBe('not-started');
    expect(retargeted?.alias).toBe('child-x2');
    expect(retargeted?.runStatePath).toBeNull();
    // The delta names the retarget with both projects.
    expect(readN1.delta?.retargeted).toEqual([
      {
        nodeId: 'g-x',
        fromProjectId: PROJECT_A,
        toProjectId: PROJECT_B,
        fromTargetLineId: LINE,
        toTargetLineId: LINE,
      },
    ]);

    // The prior revision still composes the terminal fact under project A —
    // the history is readable where it lives, via the same ordinal read
    // confirm takes.
    const prior = await readPriorRevision('0001');
    const priorRow = prior.nodes.find(entry => entry.nodeId === 'g-x');
    expect(priorRow?.observation).toBe('run-terminal');
    expect(priorRow?.alias).toBe('child-x');
    expect(priorRow?.runStatePath).toBe(
      path.join(ephemeraDir(execRoot, 'child-x'), 'auto-run.json')
    );
  });

  it('reads the evidence a retargeted instance carries as its own, never the prior lineage\'s', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Retarget' });
    const instanceA = seedAndCommit('child-x', 'a1'.repeat(16), PROJECT_A);
    const instanceB = seedAndCommit('child-x2', 'b2'.repeat(16), PROJECT_B);
    await publish([node('g-x', PROJECT_A, instanceA, 'child-x')]);
    // The OLD lineage's run-state is mid-flight; the NEW instance's own
    // run-state is terminal.
    writeRunStateFor('child-x', stages({ propose: 'done', apply: 'in_progress' }));
    writeRunStateFor('child-x2', TERMINAL());

    await publish([node('g-x', PROJECT_B, instanceB, 'child-x2')]);
    const readN1 = await readStatus();
    const observed = readN1.nodes.find(entry => entry.nodeId === 'g-x');
    // The terminal observation comes from the new instance's OWN run-state
    // location — the prior lineage's in-flight record is not inherited.
    expect(observed?.observation).toBe('run-terminal');
    expect(observed?.runStatePath).toBe(
      path.join(ephemeraDir(execRoot, 'child-x2'), 'auto-run.json')
    );
    expect(observed?.alias).toBe('child-x2');
  });

  it('carries no lineage for an intent node\'s retarget: not-started, delta naming both projects', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Retarget' });
    await publish([
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
    ]);
    await publish([
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
    ]);
    const readN1 = await readStatus();
    const moved = readN1.nodes.find(entry => entry.nodeId === 'i-move');
    // An intent node's observation is not-started by construction, whatever
    // its target — there is no lineage to inherit.
    expect(moved?.observation).toBe('not-started');
    expect(moved?.runStatePath).toBeNull();
    // The delta names the retarget exactly as a Change node's.
    expect(readN1.delta?.retargeted).toEqual([
      {
        nodeId: 'i-move',
        fromProjectId: PROJECT_A,
        toProjectId: PROJECT_B,
        fromTargetLineId: LINE,
        toTargetLineId: LINE,
      },
    ]);
  });
});
