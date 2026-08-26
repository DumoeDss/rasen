/**
 * `issue-delivery-evidence-rollup` tasks 5.1/5.2 — the delivery block pinned
 * byte-shape by byte-shape over a real Store, on every surface it threads:
 * the grouped archive entries, the Execution Plan node resolutions, the
 * projection's per-node named states, and the Issue-level rollup.
 *
 * The v1 ledger facts are the receipts material this change exists to surface
 * (every real `issue-registry` entry is a v1 ledger), so their verbatim read —
 * and the defensive read of a malformed ledger (absent/wrongly typed fields
 * read as their named absences, never repaired) — is the suite's spine. The v2
 * shapes (landed-code, planning-only, passive) have no real-store samples yet
 * and are pinned here instead, per design D6.
 *
 * The read-discipline bytes close the suite: reading delivery facts writes
 * nothing — every Store byte and every run-state byte identical before and
 * after — and the same evidence derives the identical delivery twice.
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
import { writeRunState } from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import {
  deriveIssueDeliveryEvidence,
  projectIssueStatus,
} from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-archive-delivery';

/** The archived record shapes under test, keyed by change alias. */
const ARCHIVED_SHAPES = [
  'v1-ledger',
  'v1-defensive',
  'v2-landed-code',
  'v2-planning-only',
  'v2-passive',
  'record-absent',
  'unparseable-json',
  'v2-invalid',
] as const;
type ArchivedShape = (typeof ARCHIVED_SHAPES)[number];

/**
 * Same real-Git fixture class as the `workspace-*` suites: every case builds a
 * layout-v2 Store with real commits, and the cost is worktree and commit
 * wall-clock time rather than source size. The 30s default passes solo and
 * fails under the parallel load of the store suites (observed at 42.5s), where
 * a timeout reads as a broken assertion rather than as a timeout.
 */
describe('the archive delivery block (readArchiveEntry + threading + rollup)', { timeout: 180_000 }, () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };
  let execRoot: string;
  const instanceIds = new Map<ArchivedShape, string>();

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-archive-delivery-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
    execRoot = f.beside('exec');
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  /** Seeds one Change and moves it, committed, into the archive line. */
  function archiveWithRecord(shape: ArchivedShape, seed: string, recordText: string | null): void {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: shape,
      instanceSeed: seed,
    });
    instanceIds.set(shape, seeded.instanceId);
    const entryName = `2026-08-22-${shape}--${seeded.instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      PROJECT,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(seeded.directory, archiveDir);
    if (recordText !== null) {
      fs.writeFileSync(path.join(archiveDir, 'archive.json'), recordText, 'utf8');
    }
  }

  const planningWorktree = () =>
    deriveWorktreeInstanceId({ repositoryIdentity: 'repo', worktreeIdentity: 'planning' });
  const executionWorktree = () =>
    deriveWorktreeInstanceId({ repositoryIdentity: 'repo', worktreeIdentity: 'execution' });

  /** The shared v2 skeleton; per-shape fields layered on top by each builder. */
  function v2Record(
    changeId: string,
    seed: string,
    over: Record<string, unknown>
  ): string {
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
    });
    const changeInstanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed: seed });
    return serializeArchiveV2({
      schemaVersion: 2,
      storeUid: f.storeUid,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      changeInstanceId,
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId,
        planningWorktreeInstanceId: planningWorktree(),
        executionWorktreeInstanceId: executionWorktree(),
      }),
      planning: {
        worktreeInstanceId: planningWorktree(),
        sourceRef: 'refs/heads/feat/delivery-shapes',
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      specSync: { applied: true, actions: [] },
      evidence: [{ path: 'evidence/ship-log.md', sha256: 'b'.repeat(64) }],
      missing: ['verification-report'],
      archivedAt: NOW,
      ...over,
    } as Parameters<typeof serializeArchiveV2>[0]);
  }

  /** The full v1 ledger the real v1 writer emits — the receipts shape. */
  function v1Ledger(changeId: string): string {
    return `${JSON.stringify(
      {
        change: changeId,
        archivedAt: '2026-08-20T05:56:26.013Z',
        codeCommit: '31d0b6440a453a128af29b900329c5389e52cf30',
        planningBranch: 'feat/issue-phase2',
        planningTreeState: 'dirty',
        evidence: [
          { path: 'evidence/affected-set-gate.log', sha256: 'c'.repeat(64) },
          { path: 'evidence/ship-log.md', sha256: 'd'.repeat(64) },
        ],
        probes: [],
        handoffAbsorbed: [],
        ephemeraDiscarded: [],
        missing: ['verification-report'],
      },
      null,
      2
    )}\n`;
  }

  /**
   * A v1 ledger whose delivery fields are absent or wrongly typed: every field
   * must read as its named absence — never repaired, never defaulted — and a
   * list field that IS present contributes only its well-shaped members.
   */
  function v1DefensiveLedger(changeId: string): string {
    return `${JSON.stringify(
      {
        change: changeId,
        // archivedAt absent → null.
        codeCommit: 12345,
        // planningBranch absent → null.
        evidence: [
          { path: 7, sha256: false },
          { path: 'evidence/only-shaped.md', sha256: 'e'.repeat(64) },
        ],
        missing: [42, 'verification-report', null],
      },
      null,
      2
    )}\n`;
  }

  async function seedAll(): Promise<void> {
    archiveWithRecord('v1-ledger', 'a1'.repeat(16), v1Ledger('v1-ledger'));
    archiveWithRecord('v1-defensive', 'b2'.repeat(16), v1DefensiveLedger('v1-defensive'));
    archiveWithRecord(
      'v2-landed-code',
      'c3'.repeat(16),
      v2Record('v2-landed-code', 'c3'.repeat(16), {
        implementation: 'code',
        outcome: 'landed',
        reason: null,
        supersededBy: null,
        codeMerge: {
          repoUid: 'repo-uid',
          worktreeInstanceId: executionWorktree(),
          targetRef: 'refs/heads/main',
          commit: 'f'.repeat(40),
          reachable: true,
        },
      })
    );
    archiveWithRecord(
      'v2-planning-only',
      'd4'.repeat(16),
      v2Record('v2-planning-only', 'd4'.repeat(16), {
        implementation: 'none',
        outcome: 'landed',
        reason: null,
        supersededBy: null,
        codeMerge: null,
      })
    );
    archiveWithRecord(
      'v2-passive',
      'e5'.repeat(16),
      v2Record('v2-passive', 'e5'.repeat(16), {
        implementation: 'none',
        outcome: 'cancelled',
        reason: 'the operator withdrew the scope',
        supersededBy: null,
        codeMerge: null,
        specSync: { applied: false, actions: [] },
        evidence: [],
        missing: [],
      })
    );
    archiveWithRecord('record-absent', 'f6'.repeat(16), null);
    archiveWithRecord('unparseable-json', 'a7'.repeat(16), '{not json at all\n');
    // schemaVersion-2 bytes that fail validation: a complete valid record with
    // the outcome field deleted — v2 in shape, invalid in fact, so no delivery
    // fact may be derived from the damaged bytes.
    const brokenV2 = JSON.parse(
      v2Record('v2-invalid', 'b8'.repeat(16), {
        implementation: 'none',
        outcome: 'landed',
        reason: null,
        supersededBy: null,
        codeMerge: null,
      })
    ) as Record<string, unknown>;
    delete brokenV2.outcome;
    archiveWithRecord('v2-invalid', 'b8'.repeat(16), `${JSON.stringify(brokenV2, null, 2)}\n`);

    // The not-archived sibling: committed evidence, a run-terminal run-state,
    // and NO archive entry — the run-terminal truth of the real store's three.
    // The ghost sibling publishes against real evidence and loses it AFTER
    // publication — the only way an unresolved reference becomes Store content
    // (publication refuses uncommitted references outright).
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'never-archived',
      instanceSeed: 'c9'.repeat(16),
    });
    const ghost = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'ghost-ref',
      instanceSeed: 'd0'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'never-archived'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    commitStore('archive the eight record shapes + two active changes');

    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    await issues.create({ ...scope, issueId: ISSUE, title: 'Delivery shapes' });
    const nodes: readonly ExecutionPlanNodeInput[] = [
      ...ARCHIVED_SHAPES.map(shape => ({
        nodeId: shape,
        kind: 'change' as const,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: instanceIds.get(shape) as string,
        changeAlias: shape,
        dependsOn: [],
      })),
      {
        nodeId: 'never-archived',
        kind: 'change' as const,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: active.instanceId,
        changeAlias: 'never-archived',
        dependsOn: [],
      },
      {
        nodeId: 'ghost-ref',
        kind: 'change' as const,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: ghost.instanceId,
        changeAlias: 'ghost-ref',
        dependsOn: [],
      },
      {
        nodeId: 'the-intent',
        kind: 'intent' as const,
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'an intent node carries no delivery evidence by construction',
        dependsOn: [],
      },
    ];
    await issues.publishPlan({ ...scope, issueId: ISSUE, nodes });
    commitStore('issue + plan');
    // The reference breaks AFTER publication; a read re-resolves and the
    // projection's `unattributed` state derives from that reference problem.
    f.git(f.storeRoot, ['rm', '-r', '-q', path.join('rasen', 'projects', PROJECT, 'changes', 'ghost-ref')]);
    f.git(f.storeRoot, ['commit', '-m', 'remove ghost-ref evidence']);
  }

  it('pins the delivery facts per shape, verbatim through every level', async () => {
    await seedAll();

    // --- Level A: the grouped archive entries (readArchiveEntry) -----------
    const grouped = await new StoreQueryModuleImpl().listChanges({ ...scope, state: 'archived' });
    const archived = grouped.groups.flatMap(group => group.archived);
    expect(archived.map(entry => entry.changeId).sort()).toEqual([...ARCHIVED_SHAPES].sort());
    const deliveryByShape = new Map(archived.map(entry => [entry.changeId, entry.delivery]));

    // The v1 ledger reads back verbatim: commit, branch, date, inventory with
    // digests, missing names — and the outcome absence the legacy basis owns.
    const v1 = deliveryByShape.get('v1-ledger');
    expect(v1).toEqual({
      basis: 'legacy',
      archivedAt: '2026-08-20T05:56:26.013Z',
      codeCommit: '31d0b6440a453a128af29b900329c5389e52cf30',
      planningBranch: 'feat/issue-phase2',
      outcome: null,
      evidence: [
        { path: 'evidence/affected-set-gate.log', sha256: 'c'.repeat(64) },
        { path: 'evidence/ship-log.md', sha256: 'd'.repeat(64) },
      ],
      missing: ['verification-report'],
      entryName: expect.stringMatching(/^2026-08-22-v1-ledger--/u) as unknown as string,
      foundAtRef: 'refs/heads/main',
      blobPath: expect.stringContaining('archive.json') as unknown as string,
    });

    // The defensive ledger: every absent/wrongly typed field reads as its
    // named absence — no value repaired into place, no crash, no invention.
    const defensive = deliveryByShape.get('v1-defensive');
    expect(defensive).toMatchObject({
      basis: 'legacy',
      archivedAt: null,
      codeCommit: null,
      planningBranch: null,
      outcome: null,
      evidence: [{ path: 'evidence/only-shaped.md', sha256: 'e'.repeat(64) }],
      missing: ['verification-report'],
    });

    // The v2 landed-code record maps its code-merge and planning facts.
    expect(deliveryByShape.get('v2-landed-code')).toMatchObject({
      basis: 'v2',
      archivedAt: NOW,
      codeCommit: 'f'.repeat(40),
      planningBranch: 'refs/heads/feat/delivery-shapes',
      outcome: 'landed',
      evidence: [{ path: 'evidence/ship-log.md', sha256: 'b'.repeat(64) }],
      missing: ['verification-report'],
    });

    // Planning-only and passive name the record's own no-merge absence; an
    // EMPTY inventory is a frozen empty inventory, not an absent one.
    expect(deliveryByShape.get('v2-planning-only')).toMatchObject({
      basis: 'v2',
      codeCommit: null,
      planningBranch: 'refs/heads/feat/delivery-shapes',
      outcome: 'landed',
    });
    expect(deliveryByShape.get('v2-passive')).toMatchObject({
      basis: 'v2',
      codeCommit: null,
      outcome: 'cancelled',
      evidence: [],
      missing: [],
    });

    // No record, unparseable bytes, invalid v2 bytes: NO delivery facts —
    // the absence and the damage are named by the state vocabulary, not by
    // an empty fact block that would read as a real reading.
    for (const shape of ['record-absent', 'unparseable-json', 'v2-invalid'] as const) {
      expect(deliveryByShape.get(shape), shape).toBeNull();
    }

    // --- Level B: the plan resolutions the projection consumes ------------
    const plan = await new StoreQueryModuleImpl().resolveExecutionPlan({ ...scope, issueId: ISSUE });
    expect(plan.revision).not.toBeNull();
    const resolutionByNode = new Map(
      (plan.readiness.nodes ?? []).map(row => [row.node.nodeId, row.resolution])
    );
    for (const shape of ARCHIVED_SHAPES) {
      expect(resolutionByNode.get(shape)?.delivery, shape).toEqual(deliveryByShape.get(shape));
    }
    // The active node consulted no record at all: no delivery field.
    expect('delivery' in (resolutionByNode.get('never-archived') as object)).toBe(false);

    // --- Level C: the projection's named states ----------------------------
    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir: path.join(execRoot, 'rasen', 'changes'),
      workDirFor: async () => null,
    });
    const nodeById = new Map(status.nodes.map(node => [node.nodeId, node]));
    const stateOf = (nodeId: string) => nodeById.get(nodeId)?.delivery?.state;

    expect(stateOf('v1-ledger')).toBe('record');
    expect(nodeById.get('v1-ledger')?.delivery).toMatchObject({
      basis: 'legacy',
      codeCommit: '31d0b6440a453a128af29b900329c5389e52cf30',
      planningBranch: 'feat/issue-phase2',
    });
    expect(stateOf('v1-defensive')).toBe('record');
    expect(stateOf('v2-landed-code')).toBe('record');
    expect(nodeById.get('v2-landed-code')?.delivery).toMatchObject({
      basis: 'v2',
      codeCommit: 'f'.repeat(40),
      outcome: 'landed',
    });
    expect(stateOf('v2-planning-only')).toBe('record');
    expect(stateOf('v2-passive')).toBe('record');

    // The pre-record entry: the record's absence named with its locator.
    expect(stateOf('record-absent')).toBe('no-record');
    const noRecord = nodeById.get('record-absent')?.delivery;
    if (noRecord?.state !== 'no-record') throw new Error('unreachable: pinned above');
    expect(noRecord.foundAtRef).toBe('refs/heads/main');
    expect(noRecord.blobPath).toContain('record-absent');
    expect(noRecord.blobPath).toContain('archive.json');

    // Damaged bytes: unreadable, with the standing problem authoritative.
    for (const shape of ['unparseable-json', 'v2-invalid'] as const) {
      expect(stateOf(shape), shape).toBe('unreadable');
      expect(
        status.problems.some(
          problem => problem.kind === 'invalid-archive-record' && problem.node === shape
        ),
        shape
      ).toBe(true);
    }

    // The run-terminal not-archived sibling and the broken reference.
    expect(nodeById.get('never-archived')?.observation).toBe('run-terminal');
    expect(stateOf('never-archived')).toBe('not-archived');
    expect(nodeById.get('ghost-ref')?.observation).toBe('unknown');
    expect(stateOf('ghost-ref')).toBe('unattributed');

    // An intent node carries none by construction.
    expect(nodeById.get('the-intent')?.delivery).toBeNull();

    // --- Level D: the rollup over the same read ----------------------------
    const rollup = deriveIssueDeliveryEvidence(plan.revisionId, status);
    expect(rollup).not.toBeNull();
    // One entry per change node in the REVISION's canonical node order (the
    // publication's own sorted spelling, not the authored order) — the intent
    // node contributes none.
    expect(rollup?.entries.map(entry => entry.nodeId)).toEqual(
      [...ARCHIVED_SHAPES, 'never-archived', 'ghost-ref'].sort()
    );
    expect(rollup?.counts).toEqual({
      record: 5,
      'no-record': 1,
      'not-archived': 1,
      unreadable: 2,
      unattributed: 1,
    });
    // Counts summarize; entries stay full — every record entry still carries
    // its facts beside the count that names it. The alias is the committed
    // claimant's changeId — for an archived claimant, the entry-name-derived
    // alias the node line already shows (the real store's receipts spell it
    // `2026-08-20-issue-node-lifecycle` the same way).
    const recordEntry = rollup?.entries.find(entry => entry.nodeId === 'v1-ledger');
    expect(recordEntry?.alias).toMatch(/^2026-08-22-v1-ledger--/u);
    expect(recordEntry?.observation).toBe('finalized');
    expect(recordEntry?.delivery).toMatchObject({ state: 'record', basis: 'legacy' });
  });

  it('derives the identical delivery twice and writes nothing while doing it', async () => {
    await seedAll();

    /** sha256 of every file under a root, keyed by the path relative to it. */
    const digestTree = (root: string): Map<string, string> => {
      const digests = new Map<string, string>();
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.git') continue;
          const target = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(target);
          else {
            digests.set(
              path.relative(root, target),
              createHash('sha256').update(fs.readFileSync(target)).digest('hex')
            );
          }
        }
      };
      walk(root);
      return digests;
    };

    const storeBefore = digestTree(path.join(f.storeRoot, 'rasen'));
    const execBefore = digestTree(path.join(execRoot, '.rasen'));

    const readOnce = async () => {
      const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
      const status = await projectIssueStatus({
        detail,
        executionRoot: execRoot,
        changesDir: path.join(execRoot, 'rasen', 'changes'),
        workDirFor: async () => null,
      });
      return {
        nodes: status.nodes.map(node => node.delivery),
        rollup: deriveIssueDeliveryEvidence(detail.plan?.revisionId ?? null, status),
      };
    };
    const first = await readOnce();
    const second = await readOnce();
    // Purity by receipt: the same evidence, read twice, derives identical
    // delivery facts and the identical rollup — no clock, no counter, no
    // ordering accident anywhere in the derivation.
    expect(second).toEqual(first);

    expect(digestTree(path.join(f.storeRoot, 'rasen'))).toEqual(storeBefore);
    expect(digestTree(path.join(execRoot, '.rasen'))).toEqual(execBefore);
  });
});
