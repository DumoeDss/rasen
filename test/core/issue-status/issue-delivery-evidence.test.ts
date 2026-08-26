/**
 * `issue-delivery-evidence-rollup` tasks 3.2/2.3 — the rollup derivation's
 * unit pins, plus the no-axis drift fence.
 *
 * The derivation is pure over its `(revisionId, status)` input, so the unit
 * rows build synthetic statuses directly (the ready-set suite's discipline).
 * The drift fence runs the REAL projection over a real Store fixture twice —
 * once with delivery facts, once with them stripped and once with them
 * mutated — and holds every axis the projection already determines to the
 * identical value: the spec's "drives no axis" requirement, as a receipt
 * rather than a convention.
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
import { writeRunState } from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { readIssueAcceptanceFacts } from '../../../src/core/issue-acceptance/index.js';
import {
  deriveIssueDeliveryEvidence,
  projectIssueStatus,
  type IssueNodeDelivery,
  type IssueNodeStatus,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';
import type { ResolvedPlanNode } from '../../../src/core/store/query/index.js';
import type { IssueDetail } from '../../../src/core/store/query/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';

// -----------------------------------------------------------------------------
// Hand-built statuses: the derivation units
// -----------------------------------------------------------------------------

function changeRow(
  nodeId: string,
  delivery: IssueNodeDelivery | null,
  observation: IssueNodeStatus['observation'] = 'finalized'
): IssueNodeStatus {
  return {
    nodeId,
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    lifecycle: 'required',
    reason: null,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: nodeId,
    observation,
    blockedBy: [],
    diagnostic: null,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
    delivery,
  };
}

function intentRow(nodeId: string): IssueNodeStatus {
  return {
    ...changeRow(nodeId, null, 'not-started'),
    kind: 'intent',
    alias: null,
  };
}

function statusOver(nodes: readonly IssueNodeStatus[], progress: IssueStatus['progress']): IssueStatus {
  return {
    phase: 'active',
    health: 'healthy',
    progress,
    nodes,
    delta: null,
    projects: [],
    problems: [],
    runStateVisibility: { kind: 'none' },
    complete: true,
    acceptance: null,
  };
}

const RECORD: IssueNodeDelivery = {
  state: 'record',
  basis: 'legacy',
  archivedAt: '2026-08-20T05:56:26.013Z',
  codeCommit: '31d0b6440a453a128af29b900329c5389e52cf30',
  planningBranch: 'feat/issue-phase2',
  outcome: null,
  evidence: [{ path: 'evidence/ship-log.md', sha256: 'a'.repeat(64) }],
  missing: ['verification-report'],
  entryName: '2026-08-20-demo',
  foundAtRef: 'refs/heads/main',
  blobPath: 'rasen/projects/p/changes/archive/main/2026-08-20-demo/archive.json',
};

describe('deriveIssueDeliveryEvidence (pure derivation)', () => {
  it('carries one entry per change node in node order, intent nodes excluded', () => {
    const status = statusOver(
      [
        changeRow('a-record', RECORD),
        intentRow('the-intent'),
        changeRow('b-not-archived', { state: 'not-archived' }, 'run-terminal'),
        changeRow('c-unattributed', { state: 'unattributed' }, 'unknown'),
      ],
      { completed: 1, total: 3 }
    );
    const rollup = deriveIssueDeliveryEvidence('0001', status);
    expect(rollup).not.toBeNull();
    // Canonical node order, one entry per CHANGE node — the intent node
    // contributes none, whatever its lifecycle says.
    expect(rollup?.entries.map(entry => entry.nodeId)).toEqual([
      'a-record',
      'b-not-archived',
      'c-unattributed',
    ]);
    // Each entry names its node's identity and observed state beside the
    // delivery evidence itself.
    expect(rollup?.entries[0]).toEqual({
      nodeId: 'a-record',
      alias: 'a-record',
      projectId: PROJECT,
      lifecycle: 'required',
      observation: 'finalized',
      delivery: RECORD,
    });
  });

  it('counts summarize while every entry stays listed in full', () => {
    const status = statusOver(
      [
        changeRow('r1', RECORD),
        changeRow('r2', { ...RECORD, basis: 'v2', outcome: 'landed' }),
        changeRow('n1', { state: 'no-record', foundAtRef: 'refs/heads/main', blobPath: 'x' }),
        changeRow('a1', { state: 'not-archived' }, 'run-terminal'),
        changeRow('u1', { state: 'unreadable' }, 'unknown'),
        changeRow('x1', { state: 'unattributed' }, 'unknown'),
      ],
      { completed: 2, total: 6 }
    );
    const rollup = deriveIssueDeliveryEvidence('0002', status);
    expect(rollup?.counts).toEqual({
      record: 2,
      'no-record': 1,
      'not-archived': 1,
      unreadable: 1,
      unattributed: 1,
    });
    // The counts replaced nothing: all six entries carry their full facts.
    expect(rollup?.entries).toHaveLength(6);
    expect(rollup?.entries[0].delivery).toEqual(RECORD);
  });

  it('derives the identical rollup twice over the same status', () => {
    const status = statusOver(
      [changeRow('a-record', RECORD), changeRow('b-not-archived', { state: 'not-archived' }, 'run-terminal')],
      { completed: 1, total: 2 }
    );
    expect(deriveIssueDeliveryEvidence('0001', status)).toEqual(
      deriveIssueDeliveryEvidence('0001', status)
    );
  });

  it('reports no rollup when the revision did not read back', () => {
    // progress: null is the projection's own "no latest readable revision"
    // rule — an empty rollup would read "no delivery evidence", a different
    // claim, so the derivation reports nothing at all.
    const unreadable = statusOver([], null);
    expect(deriveIssueDeliveryEvidence('0001', unreadable)).toBeNull();
    // A caller that resolved no revision id at all reports the same nothing.
    const readable = statusOver([changeRow('a-record', RECORD)], { completed: 1, total: 1 });
    expect(deriveIssueDeliveryEvidence(null, readable)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// The no-axis drift fence (task 2.3), over the real projection
// -----------------------------------------------------------------------------

describe('delivery facts drive no projection axis', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };
  let execRoot: string;
  let changesDir: string;
  const ISSUE = 'iss-delivery-drift';

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-delivery-drift-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
    execRoot = f.beside('exec');
    changesDir = path.join(execRoot, 'rasen', 'changes');
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  /** Re-derives the status with each resolution's delivery REPLACED. */
  async function projectWithDeliveryRewritten(
    detail: IssueDetail,
    acceptance: Awaited<ReturnType<typeof readIssueAcceptanceFacts>>,
    rewrite: (resolved: ResolvedPlanNode) => ResolvedPlanNode
  ): Promise<IssueStatus> {
    if (detail.plan === null) throw new Error('fixture plan missing');
    const rewritten: IssueDetail = {
      ...detail,
      plan: {
        ...detail.plan,
        readiness: {
          ...detail.plan.readiness,
          nodes: detail.plan.readiness.nodes.map(rewrite),
        },
      },
    };
    return projectIssueStatus({
      detail: rewritten,
      executionRoot: execRoot,
      changesDir,
      workDirFor: async () => null,
      acceptance,
    });
  }

  it('holds phase, health, progress, lanes, problems, and the gate identical', async () => {
    // One archived v1 ledger (record facts), one run-terminal active change
    // (not-archived), and an acceptance condition so the gate derives too.
    const archived = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'archived-one',
      instanceSeed: 'a1'.repeat(16),
    });
    const entryName = `2026-08-22-archived-one--${archived.instanceId.slice(3, 15)}`;
    const archiveDir = f.at('rasen', 'projects', PROJECT, 'changes', 'archive', LINE, entryName);
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(archived.directory, archiveDir);
    fs.writeFileSync(
      path.join(archiveDir, 'archive.json'),
      `${JSON.stringify(
        {
          change: 'archived-one',
          archivedAt: NOW,
          codeCommit: 'f'.repeat(40),
          planningBranch: 'feat/delivery-drift',
          evidence: [{ path: 'evidence/ship-log.md', sha256: 'b'.repeat(64) }],
          missing: [],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'active-two',
      instanceSeed: 'b2'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'active-two'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    commitStore('seed archived + active changes');

    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    await issues.create({ ...scope, issueId: ISSUE, title: 'Delivery drift' });
    const nodes: readonly ExecutionPlanNodeInput[] = [
      {
        nodeId: 'n-archived',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: archived.instanceId,
        changeAlias: 'archived-one',
        dependsOn: [],
      },
      {
        nodeId: 'n-active',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: active.instanceId,
        changeAlias: 'active-two',
        dependsOn: [],
      },
    ];
    await issues.publishPlan({ ...scope, issueId: ISSUE, nodes });
    await issues.publishAcceptance({
      ...scope,
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'The drift fence condition' }],
    });
    commitStore('issue + plan + acceptance');

    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
    const acceptance = await readIssueAcceptanceFacts({ ...scope, issueId: ISSUE });
    const read = () =>
      projectIssueStatus({
        detail,
        executionRoot: execRoot,
        changesDir,
        workDirFor: async () => null,
        acceptance,
      });

    const withFacts = await read();
    // The fence is not vacuous: delivery facts were derived on this evidence
    // (nodes in the revision's canonical order — n-active sorts first).
    expect(withFacts.nodes.map(node => node.delivery?.state)).toEqual(['not-archived', 'record']);
    expect(deriveIssueDeliveryEvidence(detail.plan?.revisionId ?? null, withFacts)?.counts).toEqual({
      record: 1,
      'no-record': 0,
      'not-archived': 1,
      unreadable: 0,
      unattributed: 0,
    });

    // (a) The pre-delivery world: every resolution's delivery stripped, the
    //     projection re-run — the axes must not move.
    const stripped = await projectWithDeliveryRewritten(detail, acceptance, resolved => {
      const { delivery, ...rest } = resolved.resolution;
      void delivery;
      return { ...resolved, resolution: rest };
    });
    // (b) Wild delivery facts on the same evidence — record facts swapped for
    //     absences and back — still move nothing.
    const mutated = await projectWithDeliveryRewritten(detail, acceptance, resolved => ({
      ...resolved,
      resolution: {
        ...resolved.resolution,
        delivery:
          resolved.resolution.delivery == null
            ? { ...RECORD, entryName: '2026-08-22-forged' }
            : null,
      },
    }));

    for (const other of [stripped, mutated]) {
      expect(other.phase).toBe(withFacts.phase);
      expect(other.health).toBe(withFacts.health);
      expect(other.progress).toEqual(withFacts.progress);
      expect(other.projects).toEqual(withFacts.projects);
      expect(other.problems).toEqual(withFacts.problems);
      expect(other.complete).toBe(withFacts.complete);
      expect(other.acceptance?.gate).toEqual(withFacts.acceptance?.gate);
      expect(other.nodes.map(node => node.observation)).toEqual(
        withFacts.nodes.map(node => node.observation)
      );
    }
    // The mutation itself landed (the fence covered real delivery divergence,
    // not a no-op rewrite): the active node's injected facts change nothing —
    // `not-archived` wins before any record fact is consulted — while the
    // archived node's record facts became a named no-record absence.
    expect(mutated.nodes.map(node => node.delivery?.state)).toEqual(['not-archived', 'no-record']);
  });
});
