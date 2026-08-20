/**
 * `issue-target-project-binding` — the degradation guarantee: membership is a
 * publication-time authority that no read re-litigates.
 *
 * Two shapes, both real on this machine's persistent store:
 *
 *  - a HAND-CRAFTED Phase-2-era revision (bytes as Phase 2 wrote them, digest
 *    computed by the unchanged formula) whose target project is knowledge-only
 *    — published under the lax gate, exactly the ground truth `issue-registry`
 *    carries — reads back digest-verified with identical derivation;
 *  - a revision published under the new gate whose target's roles are then
 *    flipped to knowledge-only reads back identically (the drift case).
 *
 * The discriminating half of every assertion: if a read re-checked membership,
 * these reads would refuse or report a problem. They derive exactly what the
 * same evidence derived before the project fact began being shown.
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
import { projectIssueStatus, type IssueStatus } from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PLANNING = 'app-a';
const KNOWLEDGE_ONLY = 'docs-side';
const ISSUE = 'iss-p2-era';

describe('reading a revision never re-verifies membership', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-target-degrade-',
      projects: [PLANNING, KNOWLEDGE_ONLY],
      knowledgeOnlyProjects: [KNOWLEDGE_ONLY],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  async function readStatus(): Promise<IssueStatus> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    return projectIssueStatus({ detail, workDirFor: async () => null });
  }

  /** Replaces a member's catalog with the opposite planning role, committed. */
  function flipPlanningRole(projectId: string): void {
    const catalogPath = f.at('.rasen-store', 'projects', `${projectId}.yaml`);
    const flipped = fs
      .readFileSync(catalogPath, 'utf8')
      .replace('planning: true', 'planning: false');
    expect(flipped).not.toBe(fs.readFileSync(catalogPath, 'utf8'));
    fs.writeFileSync(catalogPath, flipped, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `flip ${projectId} to knowledge-only`]);
  }

  it('reads a hand-crafted Phase-2-era revision with a knowledge-only target, digest verified', async () => {
    // The Change is real and committed under the knowledge-only member — the
    // drift shape: committed planning content on a roster that says the member
    // does not plan here.
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: KNOWLEDGE_ONLY,
      targetLineId: LINE,
      changeId: 'legacy-child',
      instanceSeed: 'e7'.repeat(16),
    });
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Phase 2 era' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + committed child']);

    // The revision bytes are HAND-AUTHORED, not written by today's serializer:
    // a Phase-2-era publication under the lax gate is what this file pretends
    // to be, and only its digest comes from the module — computed by the
    // unchanged formula over the same body (the g-002 D2 pin methodology: the
    // digest's pre-change and post-change derivations are byte-identical
    // because the formula and the body are).
    const nodeInput: ExecutionPlanNodeInput = {
      nodeId: 'legacy-node',
      kind: 'change',
      projectId: KNOWLEDGE_ONLY,
      targetLineId: LINE,
      changeInstanceId: seeded.instanceId,
      changeAlias: 'legacy-child',
      dependsOn: [],
    };
    const digest = executionPlanDigest({
      version: 1,
      issueId: ISSUE,
      revisionId: '0001',
      supersedes: null,
      createdAt: NOW,
      nodes: normalizePlanNodes([nodeInput]),
    });
    const revisionYaml = [
      'version: 1',
      `issueId: ${ISSUE}`,
      'revisionId: "0001"',
      'supersedes: null',
      `createdAt: ${NOW}`,
      `contentSha256: ${digest}`,
      'nodes:',
      '  - nodeId: legacy-node',
      '    kind: change',
      `    projectId: ${KNOWLEDGE_ONLY}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${seeded.instanceId}`,
      '    changeAlias: legacy-child',
      '    dependsOn: []',
      '',
    ].join('\n');
    fs.mkdirSync(path.dirname(f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml')), {
      recursive: true,
    });
    fs.writeFileSync(f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml'), revisionYaml, 'utf8');

    const status = await readStatus();

    // Digest verified: no unreadable-plan problem, the revision read back.
    expect(status.problems).toEqual([]);
    // The derivation is the pre-change derivation: an unstarted confirmed
    // change plan is ready/healthy 0/1 — unchanged by the project fact.
    expect(status.phase).toBe('ready');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 1 });
    expect(status.nodes[0]).toMatchObject({
      nodeId: 'legacy-node',
      observation: 'not-started',
      // And the target project is now REPORTED where it was invisible before.
      projectId: KNOWLEDGE_ONLY,
      targetLineId: LINE,
    });
  });

  it('reads a revision unchanged after its target project flips to knowledge-only', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PLANNING,
      targetLineId: LINE,
      changeId: 'drift-child',
      instanceSeed: 'f9'.repeat(16),
    });
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Drift era' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + child']);
    await issues().publishPlan({
      ...scope(),
      issueId: ISSUE,
      nodes: [
        {
          nodeId: 'drift-node',
          kind: 'change',
          projectId: PLANNING,
          targetLineId: LINE,
          changeInstanceId: seeded.instanceId,
          changeAlias: 'drift-child',
          dependsOn: [],
        },
      ],
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan + child']);

    const before = await readStatus();
    expect(before.phase).toBe('ready');
    expect(before.problems).toEqual([]);

    // The persistent-store-shaped drift: the roster moves under a published
    // revision. Publication of a NEW revision targeting this member would now
    // refuse; the revision that exists reads exactly as it did.
    flipPlanningRole(PLANNING);

    const after = await readStatus();
    expect(after.phase).toBe(before.phase);
    expect(after.health).toBe(before.health);
    expect(after.progress).toEqual(before.progress);
    expect(after.problems).toEqual([]);
    expect(after.nodes[0]).toMatchObject({
      nodeId: 'drift-node',
      projectId: PLANNING,
      observation: 'not-started',
    });
  });
});
