/**
 * `issue-revision-history-preservation` tasks 1.1–1.5 — the observation-
 * continuity pins over a REAL Git Store fixture (the same discipline as
 * `issue-status-lifecycle.test.ts`): publishing a revision never changes a
 * node's observed execution state except through real execution or committed
 * Store evidence.
 *
 * These pins assert behavior that is structurally true today and are expected
 * to pass on landing — the deliverable IS the pin (the
 * fixture-coincides-with-the-bug lesson: truth without a pin is invisible to
 * every future regression). Task 1.5's mutation check proves the 1.1 pin
 * observes real evidence rather than a tautology: perturbing one node's
 * run-state between the two readings MUST be detected, then restore and
 * re-verify green.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  issueAddresses,
  productionStoreIssueDependencies,
  revisionAddress,
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
  type IssueNodeStatus,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-cont';

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

function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('publishing a revision preserves other nodes\' observations', () => {
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
      prefix: 'rasen-issue-continuity-',
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

  async function publish(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'plan revision']);
  }

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

  function row(status: IssueStatus, nodeId: string): IssueNodeStatus {
    const found = status.nodes.find(node => node.nodeId === nodeId);
    if (found === undefined) throw new Error(`no node row '${nodeId}'`);
    return found;
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

  it('adding a node leaves its siblings\' observations fact-for-fact identical', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Continuity' });
    const [a, b, c] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publish([node('g-001', a, 'child-a'), node('g-002', b, 'child-b')]);
    writeRunStateFor('child-a', TERMINAL());
    const readN = await readStatus();
    expect(row(readN, 'g-001').observation).toBe('run-terminal');
    expect(row(readN, 'g-002').observation).toBe('not-started');

    // Revision N+1 adds node C on a new instance; A and B are redeclared
    // under the same project, line, and alias.
    await publish([
      node('g-001', a, 'child-a'),
      node('g-002', b, 'child-b'),
      node('g-003', c, 'child-c'),
    ]);
    const readN1 = await readStatus();
    // Fact for fact: observation, runStatePath, locatedBy, attribution — the
    // whole row, not a hand-picked subset.
    expect(row(readN1, 'g-001')).toEqual(row(readN, 'g-001'));
    expect(row(readN1, 'g-002')).toEqual(row(readN, 'g-002'));
    // The added node carries no observation of its siblings.
    expect(row(readN1, 'g-003').observation).toBe('not-started');
    expect(row(readN1, 'g-003').runStatePath).toBeNull();
    expect(readN1.delta?.added).toEqual(['g-003']);
  });

  it('keeps a superseded node\'s terminal observation on its line while every axis excludes it', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Continuity' });
    const [a, b] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
    ];
    await publish([node('g-001', a, 'child-a'), node('g-002', b, 'child-b')]);
    writeRunStateFor('child-a', TERMINAL());
    const readN = await readStatus();

    // N+1 marks g-001 superseded, its reason naming the successor.
    await publish([
      node('g-001', a, 'child-a', {
        lifecycle: 'superseded',
        reason: 'folded into g-002, which carries the same work',
      }),
      node('g-002', b, 'child-b'),
    ]);
    const readN1 = await readStatus();
    const superseded = row(readN1, 'g-001');
    // The observation survives on the node line, beside the lifecycle+reason.
    expect(superseded.observation).toBe('run-terminal');
    expect(superseded.lifecycle).toBe('superseded');
    expect(superseded.reason).toBe('folded into g-002, which carries the same work');
    // Every axis derives from g-002 alone: progress scopes to the one
    // required node, phase is ready (not review — the terminal observation of
    // a superseded node is history, not completion).
    expect(readN1.progress).toEqual({ completed: 0, total: 1 });
    expect(readN1.phase).toBe('ready');
    // The ready-set exit names the superseded lifecycle with the reason.
    const ready = deriveIssueReadySet(readN1);
    expect(ready).not.toBeNull();
    const exit = ready?.exits.find(entry => entry.nodeId === 'g-001');
    expect(exit?.reason).toEqual({
      kind: 'superseded',
      reason: 'folded into g-002, which carries the same work',
    });
    // The delta names the lifecycle change with stable node ids.
    expect(readN1.delta?.lifecycleChanges).toEqual([
      { nodeId: 'g-001', from: 'required', to: 'superseded' },
    ]);
    // g-002's row itself is untouched by its sibling's lifecycle change.
    expect(row(readN1, 'g-002')).toEqual(row(readN, 'g-002'));
  });

  it('moves dependency facts with an edge change, never the observation', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Continuity' });
    const [a, b, z] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-z', 'e5'.repeat(16)),
    ];
    await publish([node('g-001', a, 'child-a'), node('g-002', b, 'child-b')]);
    writeRunStateFor('child-a', TERMINAL());
    const readN = await readStatus();

    // N+1 adds an edge B -> Z with Z non-terminal (a new, not-started node).
    await publish([
      node('g-001', a, 'child-a'),
      node('g-002', b, 'child-b', { dependsOn: ['g-z'] }),
      node('g-z', z, 'child-z'),
    ]);
    const readN1 = await readStatus();
    // B's own observation is unchanged by its new dependency facts.
    expect(row(readN1, 'g-002').observation).toBe('not-started');
    expect(row(readN1, 'g-002').runStatePath).toBeNull();
    expect(row(readN1, 'g-002').locatedBy).toBe(row(readN, 'g-002').locatedBy);
    // Its dependency facts now name Z while Z's work is not complete.
    expect(row(readN1, 'g-002').blockedBy).toEqual([
      { nodeId: 'g-z', projectId: PROJECT, observation: 'not-started' },
    ]);
    expect(readN1.delta?.edgeChanges).toEqual([
      { nodeId: 'g-002', addedDependencies: ['g-z'], removedDependencies: [] },
    ]);
    // A's row is untouched by the edge it is not part of.
    expect(row(readN1, 'g-001')).toEqual(row(readN, 'g-001'));
  });

  it('writes nothing when publishing: run-state, the Issue record, and prior revisions are byte-identical', async () => {
    const created = await issues().create({ ...scope(), issueId: ISSUE, title: 'Continuity' });
    const [a, b, c] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publish([node('g-001', a, 'child-a'), node('g-002', b, 'child-b')]);
    const runStateFile = writeRunStateFor('child-a', TERMINAL());

    const addresses = issueAddresses(f.storeRoot, created.identity.uid);
    const before = new Map<string, string>([
      [runStateFile, sha256OfFile(runStateFile)],
      [addresses.record, sha256OfFile(addresses.record)],
      [
        revisionAddress(f.storeRoot, created.identity.uid, '0001'),
        sha256OfFile(revisionAddress(f.storeRoot, created.identity.uid, '0001')),
      ],
    ]);

    await publish([
      node('g-001', a, 'child-a'),
      node('g-002', b, 'child-b'),
      node('g-003', c, 'child-c'),
    ]);

    for (const [filePath, digest] of before) {
      expect(sha256OfFile(filePath), `byte-identical: ${filePath}`).toBe(digest);
    }
    // The only new bytes are the new revision itself.
    const after = fs.readdirSync(addresses.plans).sort();
    expect(after).toEqual(['0001.yaml', '0002.yaml']);
  });

  it('mutation check: the continuity pin detects a real run-state change between readings', async () => {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Continuity' });
    const [a, b, c] = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    await publish([node('g-001', a, 'child-a'), node('g-002', b, 'child-b')]);
    writeRunStateFor('child-a', TERMINAL());
    const readN = await readStatus();

    await publish([
      node('g-001', a, 'child-a'),
      node('g-002', b, 'child-b'),
      node('g-003', c, 'child-c'),
    ]);
    // Between the two readings, g-001's run-state MOVES — exactly the change
    // the pin must detect if it reads real evidence rather than asserting a
    // constant. A stage regressing from done to in_progress makes the
    // terminal observation false.
    writeRunStateFor(
      'child-a',
      stages({ propose: 'done', apply: 'in_progress' })
    );
    const readPerturbed = await readStatus();
    expect(row(readPerturbed, 'g-001').observation).toBe('in-flight');
    expect(row(readPerturbed, 'g-001')).not.toEqual(row(readN, 'g-001'));

    // Restore the terminal run-state and the pin reads green again — the
    // detection was the evidence, not a broken fixture.
    writeRunStateFor('child-a', TERMINAL());
    const readRestored = await readStatus();
    expect(row(readRestored, 'g-001')).toEqual(row(readN, 'g-001'));
  });
});
