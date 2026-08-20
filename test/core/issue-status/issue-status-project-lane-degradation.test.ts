/**
 * `issue-project-grouped-views` — the degradation guarantee: lanes are an
 * additive grouping over a readable revision, never a reinterpretation of it.
 *
 * The discriminating shape is a HAND-CRAFTED Phase-2-era revision (bytes as
 * Phase 2 wrote them, digest computed by the unchanged formula) naming ONE
 * project — exactly the ground truth the persistent `issue-registry` store's
 * Issue #1 carries. It reads back digest-verified with the identical
 * phase/health/progress the pre-lane projection derived (the Phase-1 table's
 * values), and gains exactly one lane whose pair equals the Issue-level pair.
 * If lane derivation had moved any axis, this read would show it.
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
const PROJECT = 'app-a';
const ISSUE = 'iss-p2-lane';

describe('a Phase-2-era single-project revision reads with one lane and identical axes', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-lane-degrade-',
      projects: [PROJECT],
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

  it('reads a hand-crafted single-project revision digest-verified, one lane, axes unchanged', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'legacy-child',
      instanceSeed: 'e7'.repeat(16),
    });
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Phase 2 era' });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + committed child']);

    // The revision bytes are HAND-AUTHORED, not written by today's serializer:
    // a Phase-2-era publication is what this file pretends to be, and only its
    // digest comes from the module — computed by the unchanged formula over
    // the same body (the g-002 D2 pin methodology).
    const nodeInput: ExecutionPlanNodeInput = {
      nodeId: 'legacy-node',
      kind: 'change',
      projectId: PROJECT,
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
      `    projectId: ${PROJECT}`,
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
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'hand-commit Phase-2-era plan']);

    const status = await readStatus();

    // Digest verified: no unreadable-plan problem, the revision read back.
    expect(status.problems).toEqual([]);
    // The axes are the pre-lane derivation's values — an unstarted confirmed
    // change plan is ready/healthy 0/1 (the Phase-1 table row), unchanged by
    // lane derivation existing at all.
    expect(status.phase).toBe('ready');
    expect(status.health).toBe('healthy');
    expect(status.progress).toEqual({ completed: 0, total: 1 });
    // The lane view over the same revision: exactly one lane, no alias input
    // supplied so the alias is null, its pair equal to the Issue-level pair
    // over the same nodes, its node list the revision's canonical order.
    expect(status.projects).toHaveLength(1);
    expect(status.projects[0].projectId).toBe(PROJECT);
    expect(status.projects[0].alias).toBeNull();
    expect(status.projects[0].nodeIds).toEqual(['legacy-node']);
    expect(status.projects[0].progress).toEqual(status.progress);
  });
});
