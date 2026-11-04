/**
 * `issue-ready-set-scheduling` tasks 3.2/3.3 — the archive-basis ruling,
 * end-to-end on a real temp Store through the real projection:
 *
 *  - task 3.2, the Issue #3 shape replayed: an archived Change whose entry was
 *    SEEDED with a derived v2 identity and carries no v2 outcome record (the
 *    pre-v2 delivery world) counts its work complete — progress, the review
 *    phase, and a dependent's `blockedBy` release — with NO run-state located
 *    anywhere the read can see. No mirrors: the archive fact is the evidence.
 *  - task 3.3, the fail-closed half: a schemaVersion-2 record that fails
 *    validation reports `unknown` with an `invalid-archive-record` problem
 *    naming the file and the reason, keeps gating its dependents, and drives
 *    no completion value.
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
import { serializeArchiveV2 } from '../../../src/core/store/finalization-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';
import {
  deriveIssueReadySet,
  projectIssueStatus,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'main';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const ISSUE = 'iss-legacy-ruling';

describe('the archive-basis ruling (D3/D4) through the projection', () => {
  let f: StoreWorkspaceFixture;
  const scope = () => ({
    store: f.storeId,
    startPath: f.storeRoot,
    globalDataDir: f.globalDataDir,
  });

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-legacy-ruling-',
      projects: [PROJECT_A, PROJECT_B],
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

  /**
   * Seeds a Change and moves it, committed, into the archive line as a
   * SEEDED entry: derived v2 identity in the metadata (the Issue #3 shape —
   * identity comes from the store-side identity derivation, not from a
   * historical archive), entry name dated and instance-suffixed. `record`
   * decides the archive record's bytes; null leaves the entry without one.
   */
  function seedArchived(
    projectId: string,
    changeId: string,
    instanceSeed: string,
    record: string | null
  ): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    const entryName = `2026-08-07-${changeId}--${seeded.instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      projectId,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(seeded.directory, archiveDir);
    if (record !== null) {
      fs.writeFileSync(path.join(archiveDir, 'archive.json'), record, 'utf8');
    }
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed archived ${changeId}`]);
    return seeded.instanceId;
  }

  /** A valid v2 record (the control shape). */
  function validV2Record(projectId: string, changeId: string, instanceSeed: string): string {
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId,
      targetLineId: LINE,
    });
    const changeInstanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
    return serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId,
      targetLineId: LINE,
      changeId,
      changeInstanceId,
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId,
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
        sourceRef: 'refs/heads/main',
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      codeMerge: null,
      specSync: { applied: true, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });
  }

  /** A v2-shaped record that fails validation: the outcome field deleted. */
  function brokenV2Record(projectId: string, changeId: string, instanceSeed: string): string {
    const parsed = JSON.parse(
      validV2Record(projectId, changeId, instanceSeed)
    ) as Record<string, unknown>;
    delete parsed.outcome;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }

  async function publishPlan(nodes: readonly ExecutionPlanNodeInput[]): Promise<void> {
    await issues().create({ ...scope(), issueId: ISSUE, title: 'Legacy ruling' });
    await issues().publishPlan({ ...scope(), issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  /** The status read with NO execution root and no work dirs: zero mirrors. */
  async function readStatus(): Promise<IssueStatus> {
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope(), issueId: ISSUE });
    return projectIssueStatus({ detail, workDirFor: async () => null });
  }

  it('counts an archived-legacy node toward progress and carries the review phase (Issue #3 shape)', async () => {
    const legacyId = seedArchived(PROJECT_A, 'legacy-only', 'a1'.repeat(16), null);
    await publishPlan([
      {
        nodeId: 'g-legacy',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: legacyId,
        changeAlias: 'legacy-only',
        dependsOn: [],
      },
    ]);

    const status = await readStatus();
    // NO run-state located: the observation came from the archive fact alone.
    expect(status.runStateVisibility).toEqual({ kind: 'none' });
    const node = status.nodes[0];
    expect(node?.observation).toBe('finalized');
    expect(node?.runStatePath).toBeNull();
    // The node's facts name the legacy basis — never a v2 outcome, never a
    // run-terminal observation.
    expect(node?.diagnostic).toContain('legacy archive record');
    expect(status.progress).toEqual({ completed: 1, total: 1 });
    // The review phase: every required node's work complete, the Issue open,
    // no verified acceptance record — review implies waiting-human.
    expect(status.phase).toBe('review');
    expect(status.health).toBe('waiting-human');
    expect(status.problems).toEqual([]);
  });

  it('releases a downstream node with NO mirrors — cross-project, ready on the archive fact', async () => {
    // The Issue #3 shape proper: delivered-legacy work in one member project
    // releasing downstream work in another, with zero run-state anywhere.
    const legacyId = seedArchived(PROJECT_B, 'legacy-dep', 'b2'.repeat(16), null);
    const downId = f
      .seedChange({
        root: f.storeRoot,
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeId: 'fresh-down',
        instanceSeed: 'c3'.repeat(16),
      })
      .instanceId;
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed fresh-down']);
    await publishPlan([
      {
        nodeId: 'g-legacy',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: legacyId,
        changeAlias: 'legacy-dep',
        dependsOn: [],
      },
      {
        nodeId: 'g-down',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: downId,
        changeAlias: 'fresh-down',
        dependsOn: ['g-legacy'],
      },
    ]);

    const status = await readStatus();
    const legacy = status.nodes.find(node => node.nodeId === 'g-legacy');
    const down = status.nodes.find(node => node.nodeId === 'g-down');
    expect(legacy?.observation).toBe('finalized');
    expect(legacy?.diagnostic).toContain('legacy archive record');
    // The dependency gate released on the archive fact: no blocker listed.
    expect(down?.blockedBy).toEqual([]);
    expect(down?.observation).toBe('not-started');
    expect(status.progress).toEqual({ completed: 1, total: 2 });
    expect(status.phase).toBe('active');

    // And the ready answer says it: the downstream IS the member; the legacy
    // dependency exits complete with its basis named, never run-terminal.
    const ready = deriveIssueReadySet(status);
    expect(ready?.members.map(member => member.nodeId)).toEqual(['g-down']);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-legacy')).toEqual({
      kind: 'complete',
      basis: legacy?.diagnostic ?? null,
    });
  });

  it('reads a v1-shaped archive record as legacy too (the relocated-record branch)', async () => {
    const legacyId = seedArchived(
      PROJECT_A,
      'v1-record',
      'd4'.repeat(16),
      `${JSON.stringify({ version: 1, changeId: 'v1-record' }, null, 2)}\n`
    );
    await publishPlan([
      {
        nodeId: 'g-v1',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: legacyId,
        changeAlias: 'v1-record',
        dependsOn: [],
      },
    ]);
    const status = await readStatus();
    expect(status.nodes[0]?.observation).toBe('finalized');
    expect(status.nodes[0]?.diagnostic).toContain('legacy archive record');
    expect(status.progress).toEqual({ completed: 1, total: 1 });
  });

  it('fails closed on a corrupt v2 record: unknown, named, and gating (task 3.3)', async () => {
    const brokenId = seedArchived(
      PROJECT_B,
      'corrupt-dep',
      'e5'.repeat(16),
      brokenV2Record(PROJECT_B, 'corrupt-dep', 'e5'.repeat(16))
    );
    const downId = f
      .seedChange({
        root: f.storeRoot,
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeId: 'gated-down',
        instanceSeed: 'f6'.repeat(16),
      })
      .instanceId;
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed gated-down']);
    await publishPlan([
      {
        nodeId: 'g-broken',
        kind: 'change',
        projectId: PROJECT_B,
        targetLineId: LINE,
        changeInstanceId: brokenId,
        changeAlias: 'corrupt-dep',
        dependsOn: [],
      },
      {
        nodeId: 'g-down',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: downId,
        changeAlias: 'gated-down',
        dependsOn: ['g-broken'],
      },
    ]);

    const status = await readStatus();
    const broken = status.nodes.find(node => node.nodeId === 'g-broken');
    // Unknown with the diagnostic — never a guessed outcome, never fresh.
    expect(broken?.observation).toBe('unknown');
    expect(broken?.diagnostic).toContain('archive record does not validate');
    // The problem names the file and the reason.
    const problem = status.problems.find(entry => entry.kind === 'invalid-archive-record');
    expect(problem).toBeDefined();
    expect(problem?.node).toBe('g-broken');
    expect(problem?.ref).toContain('corrupt-dep--');
    expect(problem?.ref).toContain('archive.json');
    expect(problem?.reason).toContain('failed validation');
    // No completion derived: the node is not counted, and the read is not
    // complete over damaged evidence.
    expect(status.progress).toEqual({ completed: 0, total: 2 });
    expect(status.complete).toBe(false);
    // The gate holds: the downstream is blocked on it, never ready.
    const down = status.nodes.find(node => node.nodeId === 'g-down');
    expect(down?.blockedBy).toEqual([
      { nodeId: 'g-broken', projectId: PROJECT_B, observation: 'unknown' },
    ]);
    const ready = deriveIssueReadySet(status);
    expect(ready?.members).toEqual([]);
    const reasonByNode = new Map(ready?.exits.map(entry => [entry.nodeId, entry.reason]));
    expect(reasonByNode.get('g-down')).toEqual({
      kind: 'blocked',
      blockers: [
        {
          nodeId: 'g-broken',
          projectId: PROJECT_B,
          state: `unknown (${broken?.diagnostic})`,
        },
      ],
    });
    expect(reasonByNode.get('g-broken')).toEqual({
      kind: 'unknown',
      diagnostic: broken?.diagnostic ?? null,
    });
  });

  it('keeps the valid v2 record finalizing exactly as before (the control)', async () => {
    const validId = seedArchived(
      PROJECT_A,
      'v2-control',
      '97'.repeat(16),
      validV2Record(PROJECT_A, 'v2-control', '97'.repeat(16))
    );
    await publishPlan([
      {
        nodeId: 'g-v2',
        kind: 'change',
        projectId: PROJECT_A,
        targetLineId: LINE,
        changeInstanceId: validId,
        changeAlias: 'v2-control',
        dependsOn: [],
      },
    ]);
    const status = await readStatus();
    expect(status.nodes[0]?.observation).toBe('finalized');
    // No basis diagnostic on the v2 branch — the outcome column speaks.
    expect(status.nodes[0]?.diagnostic).toBeNull();
    expect(status.progress).toEqual({ completed: 1, total: 1 });
    expect(status.problems).toEqual([]);
  });
});
