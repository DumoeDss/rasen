/**
 * `issue-cross-project-gating` — the degradation guarantee: the structured
 * blocker facts and the work-complete display basis are display-shape changes
 * that no axis, revision byte, or digest feels.
 *
 * Two shapes:
 *
 *  - a HAND-CRAFTED Phase-2-era revision (single project, serial chain, bytes
 *    as Phase 2 wrote them, digest computed by the unchanged formula) reads
 *    back digest-verified deriving EXACTLY the axes the same evidence derived
 *    before the dependency facts gained their shape — the pin is the pair
 *    (axes identical, entries structured), because either half alone would
 *    not discriminate a basis change from a formatting change;
 *  - a two-project revision derives its axes by the same rules a
 *    single-project one does — dependency facts drive no axis.
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
  normalizePlanNodes,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { writeRunState } from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus, type IssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const PROJECT_B = 'app-b';
const ISSUE = 'iss-dep-degrade';

describe('dependency-fact shape changes move no axis', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });
  let execRoot: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-blocker-degrade-',
      projects: [PROJECT, PROJECT_B],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
    execRoot = f.beside('exec');
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  function seedAndCommit(projectId: string, changeId: string, instanceSeed: string): string {
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

  async function readStatus(): Promise<IssueStatus> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    return projectIssueStatus({ detail, workDirFor: async () => null });
  }

  it('reads a hand-crafted Phase-2-era serial revision with identical axes, digest verified', async () => {
    const instanceIds = [
      seedAndCommit(PROJECT, 'legacy-a', 'a1'.repeat(16)),
      seedAndCommit(PROJECT, 'legacy-b', 'b2'.repeat(16)),
      seedAndCommit(PROJECT, 'legacy-c', 'c3'.repeat(16)),
    ];
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Phase 2 era serial' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + children']);

    // The revision bytes are HAND-AUTHORED, not written by today's serializer:
    // a Phase-2-era publication is what this file pretends to be, and only its
    // digest comes from the module — computed by the unchanged formula over
    // the same body (g-002 pins the formula AND the body, so a read's digest
    // verification proves the serialization this change touched nothing).
    const nodeInputs: readonly ExecutionPlanNodeInput[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[0] as string,
        changeAlias: 'legacy-a',
        dependsOn: [],
      },
      {
        nodeId: 'g-002',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[1] as string,
        changeAlias: 'legacy-b',
        dependsOn: ['g-001'],
      },
      {
        nodeId: 'g-003',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds[2] as string,
        changeAlias: 'legacy-c',
        dependsOn: ['g-002'],
      },
    ];
    const digest = executionPlanDigest({
      version: 1,
      issueId: ISSUE,
      revisionId: '0001',
      supersedes: null,
      createdAt: NOW,
      nodes: normalizePlanNodes(nodeInputs),
    });
    const revisionYaml = [
      'version: 1',
      `issueId: ${ISSUE}`,
      'revisionId: "0001"',
      'supersedes: null',
      `createdAt: ${NOW}`,
      `contentSha256: ${digest}`,
      'nodes:',
      '  - nodeId: g-001',
      '    kind: change',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${JSON.stringify(instanceIds[0])}`,
      '    changeAlias: legacy-a',
      '    dependsOn: []',
      '  - nodeId: g-002',
      '    kind: change',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${JSON.stringify(instanceIds[1])}`,
      '    changeAlias: legacy-b',
      '    dependsOn: [g-001]',
      '  - nodeId: g-003',
      '    kind: change',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${JSON.stringify(instanceIds[2])}`,
      '    changeAlias: legacy-c',
      '    dependsOn: [g-002]',
      '',
    ].join('\n');
    const revisionPath = f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml');
    fs.mkdirSync(path.dirname(revisionPath), { recursive: true });
    fs.writeFileSync(revisionPath, revisionYaml, 'utf8');

    const status = await readStatus();

    // Digest verified: no unreadable-plan problem, the revision read back, and
    // the digest the read carries is the one the unchanged formula computed.
    expect(status.problems).toEqual([]);
    expect(status.nodes).toHaveLength(3);
    // The derivation is the pre-change derivation — an unstarted confirmed
    // serial plan is ready/healthy 0/3, exactly the row the pre-existing
    // 'derives ready' test pinned before the dependency facts changed shape.
    expect(status.phase).toBe('ready');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 3 });
    // And the dependency facts are the structured shape now — the ONLY thing
    // this change moved on a Phase-2-era revision's read.
    expect(status.nodes[1]?.blockedBy).toEqual([
      { nodeId: 'g-001', projectId: PROJECT, observation: 'not-started' },
    ]);
    expect(status.nodes[2]?.blockedBy).toEqual([
      { nodeId: 'g-002', projectId: PROJECT, observation: 'not-started' },
    ]);
  });

  it('derives a two-project revision’s axes by the single-project rules — facts drive no axis', async () => {
    const upId = seedAndCommit(PROJECT_B, 'cross-up', 'e5'.repeat(16));
    const downId = seedAndCommit(PROJECT, 'cross-down', 'f6'.repeat(16));
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Two-project serial' });
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'g-up',
          kind: 'change',
          projectId: PROJECT_B,
          targetLineId: LINE,
          changeInstanceId: upId,
          changeAlias: 'cross-up',
          dependsOn: [],
        },
        {
          nodeId: 'g-down',
          kind: 'change',
          projectId: PROJECT,
          targetLineId: LINE,
          changeInstanceId: downId,
          changeAlias: 'cross-down',
          dependsOn: ['g-up'],
        },
      ],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + cross plan']);

    const before = await readStatus();
    // The same values a single-project two-node serial chain derives: the
    // cross-project edge changes WHO is waited on, never an axis rule.
    expect(before.phase).toBe('ready');
    expect(before.health).toBe('healthy');
    expect(before.progress).toEqual({ completed: 0, total: 2 });
    const downstream = before.nodes.find(node => node.nodeId === 'g-down');
    expect(downstream?.blockedBy).toEqual([
      { nodeId: 'g-up', projectId: PROJECT_B, observation: 'not-started' },
    ]);

    // Work moves; the axes follow the observation rules exactly as they would
    // in a single-project plan, and the dependency fact tracks the WORK (the
    // blocker empties on terminal run-state, with no archive anywhere).
    writeRunState(
      ephemeraDir(execRoot, 'cross-up'),
      {
        pipeline: 'small-feature',
        stages: {
          propose: { status: 'done' },
          apply: { status: 'done' },
          verify: { status: 'done' },
          'review-loop': { status: 'done' },
          ship: { status: 'done' },
          archive: { status: 'done' },
        },
      }
    );
    const after = await projectIssueStatus({
      detail: await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE }),
      executionRoot: execRoot,
      workDirFor: async () => null,
    });
    expect(after.phase).toBe('active');
    expect(after.health).toBe('healthy');
    expect(after.progress).toEqual({ completed: 1, total: 2 });
    expect(after.nodes.find(node => node.nodeId === 'g-down')?.blockedBy).toEqual([]);
  });
});
