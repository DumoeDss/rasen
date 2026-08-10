/**
 * `store-finalization-outcomes-v2` tasks 9.6, 9.7 and 9.8 — the immutable plan,
 * its token, revalidation under the locks, and concurrency.
 *
 * Three separable claims:
 *
 * - PLANNING the same inputs twice AT THE SAME INSTANT produces the same
 *   identifier. The plan id deliberately excludes the transaction's INSTANCE
 *   fields (its random id, its own hash, and the stage/journal paths derived
 *   from that id) — otherwise "equal inputs produce an identical plan" would be
 *   false for every re-plan. It does NOT exclude the wall clock: `archivedAt`
 *   is a recorded fact of the finalization and is inside the hashed decision,
 *   in both `recordDraft` and `archivePlan.finalization.record`. So the clock
 *   is part of "equal inputs", and this fixture freezes it
 *   (`withDeterministicFinalizationClock`) rather than the identifier being
 *   time-independent. `finalization-surface-parity.test.ts` states the same
 *   fact the other way round, by normalizing both `archivedAt` fields before
 *   it compares four surfaces taken milliseconds apart.
 * - APPLYING revalidates every frozen fact under the locks and INVALIDATES on a
 *   mismatch. Nothing is repaired into agreement. Every such precondition is
 *   driven by a fact frozen in the PLAN, so it holds on `--apply-plan`, which
 *   carries no token and is the only surface a saved plan is applied through.
 * - The locks are the ones child 4 published, in its order: two finalizations
 *   of one Change instance are mutually exclusive, and two finalizations in
 *   different scopes are not.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canPersistStoreFinalizationPlan } from '../../../src/core/archive.js';

import {
  finalizationLockKeys,
  finalizationPlanId,
  inspectFinalizationApplyPlan,
  unheldIntegrationLockKey,
  withFinalizationLocks,
  type ChangeFinalizationError,
} from '../../../src/core/store/finalization/index.js';
import {
  applyArchive,
  defaultArchiveEngineAdapters,
  hashArchivePlan,
  loadStoredArchivePlan,
} from '../../../src/core/archive-engine.js';
import { createNodeWorkspaceCoordination } from '../../../src/core/store/workspace/dependencies.js';
import { lockIsHeld } from '../../../src/core/store/workspace/locks.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  prepareSpecActions,
  type StoreFinalizationFixture,
} from '../../helpers/store-finalization-fixture.js';

const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';
const STORE_UID = 'store-uid-under-test';

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

describe('the finalization plan identifier', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT_A],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('is identical for equal inputs and differs when any decision changes', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'plan-determinism',
    });

    const first = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    const second = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));

    expect(second.planId).toBe(first.planId);
    expect(canPersistStoreFinalizationPlan(first)).toBe(true);
    // …and the two runs are genuinely separate transactions, so the identifier
    // is not "the same because nothing was recomputed".
    expect(second.archivePlan.transactionId).not.toBe(first.archivePlan.transactionId);
    expect(second.token?.archivePlanToken).not.toBe(first.token?.archivePlanToken);

    const differentReason = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'A different reason.' }));
    expect(differentReason.planId).not.toBe(first.planId);

    const differentOutcome = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'cancelled', reason: 'Dropped.' }));
    expect(differentOutcome.planId).not.toBe(first.planId);
  }, 240_000);

  it('changes when either HALF of the decision changes, so the token covers both', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'plan-halves',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));

    // A change to the FINALIZATION half.
    expect(
      finalizationPlanId({
        ...(plan as unknown as Record<string, unknown>),
        destination: `${plan.destination}-tampered`,
      } as Parameters<typeof finalizationPlanId>[0])
    ).not.toBe(plan.planId);

    // A change to the ARCHIVE half.
    expect(
      finalizationPlanId({
        ...(plan as unknown as Record<string, unknown>),
        archivePlan: { ...plan.archivePlan, change: 'tampered' },
      } as Parameters<typeof finalizationPlanId>[0])
    ).not.toBe(plan.planId);

    // The token additionally pins the exact transaction, so a plan id that
    // matches never buys past a different stored plan.
    expect(plan.token?.archivePlanToken).toContain(plan.archivePlan.transactionId);
    expect(plan.token?.planId).toBe(plan.planId);
    expect(plan.token?.changeInstanceId).toBe(bound.changeInstanceId);
    expect(plan.token?.workspacePairId).toBe(bound.workspacePairId);
  }, 180_000);

  it('applies a stored plan when merge confirmation satisfies only the timing gate', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'stored-merge-confirmation',
    });
    const archive = f.preparation(bound, {
      timing: {
        mode: 'on-merge',
        deliveryMode: 'pr',
        override: false,
      },
    });
    const plan = await f
      .finalization()
      .plan(
        f.planInput(
          bound,
          { outcome: 'abandoned', reason: 'Dropped.' },
          { archive }
        )
      );

    expect(plan.applicable).toBe(false);
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        archiveBlocker: expect.objectContaining({
          code: 'archive_merge_confirmation_required',
          operation: 'timing',
        }),
      }),
    ]);
    expect(canPersistStoreFinalizationPlan(plan)).toBe(true);
    expect(
      inspectFinalizationApplyPlan(plan, { mergeConfirmed: true })
    ).toEqual({
      applicable: true,
      blockers: [],
    });
    const blocked = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);
    expect(blocked).toMatchObject({
      status: 'blocked',
      associationPhase: 'pending',
      recoveryCommand:
        `rasen archive --apply-plan ${plan.token?.archivePlanToken} --yes`,
    });
    expect(fs.existsSync(bound.changeDir)).toBe(true);


    const result = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token, {
        mergeConfirmed: true,
      });
    expect(result.status).toBe('complete');
    expect(fs.existsSync(bound.changeDir)).toBe(false);
    const refusedAbort = await f
      .finalization()
      .abortStoredPlan(plan.archivePlan, f.globalDataDir);
    expect(refusedAbort).toMatchObject({
      status: 'blocked',
      effectivePhase: 'complete',
      journalPath: plan.archivePlan.paths.publishedJournal,
      associationPhase: 'applied',
      retainedPaths: expect.arrayContaining([
        plan.destination,
        plan.archivePlan.paths.publishedJournal,
      ]),
      recoveryCommand:
        `rasen archive --apply-plan ${plan.token?.archivePlanToken} --yes`,
      blockers: [
        expect.objectContaining({ code: 'archive_abort_phase_unsafe' }),
      ],
    });
    expect(refusedAbort.manualRecoveryAction).toBeUndefined();
  }, 240_000);

  it('refuses Store plan persistence when a merge gate has any second blocker', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'stored-merge-with-second-blocker',
    });
    const plan = await f.finalization().plan(
      f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }, {
        archive: f.preparation(bound, {
          timing: { mode: 'on-merge', deliveryMode: 'pr', override: false },
          tasks: { total: 1, completed: 0, override: false },
        }),
      })
    );

    expect(plan.blockers).toHaveLength(2);
    expect(canPersistStoreFinalizationPlan(plan)).toBe(false);
    expect(
      inspectFinalizationApplyPlan(plan, { mergeConfirmed: true }).applicable
    ).toBe(false);
  }, 180_000);

  it('preserves merge confirmation in a recoverable replay command and advances on retry', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'merge-confirmed-recovery',
    });
    const plan = await f
      .finalization()
      .plan(
        f.planInput(
          bound,
          { outcome: 'abandoned', reason: 'Dropped.' },
          {
            archive: f.preparation(bound, {
              timing: {
                mode: 'on-merge',
                deliveryMode: 'pr',
                override: false,
              },
            }),
          }
        )
      );
    const writeArchiveV2Json = defaultArchiveEngineAdapters.writeArchiveV2Json;
    let refused = false;
    const writeSpy = vi
      .spyOn(defaultArchiveEngineAdapters, 'writeArchiveV2Json')
      .mockImplementation(async (archivedDir, prepared) => {
        if (!refused) {
          refused = true;
          const failure = new Error('injected accounting persistence failure');
          (failure as NodeJS.ErrnoException).code = 'EIO';
          throw failure;
        }
        return writeArchiveV2Json(archivedDir, prepared);
      });

    let failed;
    try {
      failed = await f
        .finalization()
        .applyStoredPlan(plan.archivePlan, plan.token, {
          mergeConfirmed: true,
        });
    } finally {
      writeSpy.mockRestore();
    }
    expect(failed).toMatchObject({
      status: 'recoverable',
      recoveryCommand:
        `rasen archive --apply-plan ${plan.token?.archivePlanToken} --yes`,
    });
    expect(failed.manualRecoveryAction).toBeUndefined();

    const retry = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token, {
        mergeConfirmed: true,
      });
    expect(retry.status).toBe('complete');
    expect(fs.existsSync(bound.changeDir)).toBe(false);
  }, 240_000);

  it('returns manual-only structured recovery for a corrupt owned journal', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'corrupt-owned-journal',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    fs.mkdirSync(plan.archivePlan.paths.stage, { recursive: true });
    fs.writeFileSync(plan.archivePlan.paths.journal, '{corrupt journal');

    const result = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);

    expect(result).toMatchObject({
      status: 'recoverable',
      associationPhase: 'pending',
      blockers: [
        expect.objectContaining({
          archiveBlocker: expect.objectContaining({
            code: 'archive_journal_invalid',
          }),
        }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(result.recoveryCommand).toBeUndefined();
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);
  it('does not mutate source, canonical specs, or Archive when direct-plan persistence fails', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'persistence-zero-write',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    const canonical = path.join(
      bound.planningWorktree,
      'rasen',
      'projects',
      PROJECT_A,
      'specs'
    );
    const beforeSource = hashTree(bound.changeDir);
    const beforeCanonical = hashTree(canonical);
    const beforeArchive = fs.existsSync(bound.archiveLine)
      ? hashTree(bound.archiveLine)
      : {};

    fs.writeFileSync(
      path.join(f.globalDataDir, 'archive-transactions'),
      'not a transaction directory\n'
    );

    await expect(
      f.finalization().applyStoredPlan(plan.archivePlan, plan.token)
    ).rejects.toBeDefined();
    expect(hashTree(bound.changeDir)).toEqual(beforeSource);
    expect(hashTree(canonical)).toEqual(beforeCanonical);
    expect(
      fs.existsSync(bound.archiveLine) ? hashTree(bound.archiveLine) : {}
    ).toEqual(beforeArchive);
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  it('preserves abort guidance and leaves association pending on an early collision', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'stored-abort-guidance',
    });
    f.write(
      path.join(bound.changeDir, 'evidence', 'ship-log.md'),
      '# Ship Log\n\n## Archive\nreserved by another transaction\n'
    );
    const plan = await f
      .finalization()
      .plan(
        f.planInput(bound, {
          outcome: 'abandoned',
          reason: 'Dropped.',
        })
      );
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);

    const result = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);

    expect(result).toMatchObject({
      status: 'abort-required',
      associationPhase: 'pending',
      specSyncApplied: false,
      abortCommand:
        `rasen archive --abort-plan ${plan.token?.archivePlanToken} --yes`,
    });
    expect(result.recoveryCommand).toBeUndefined();
    await expect(
      loadStoredArchivePlan(plan.token!.archivePlanToken, f.globalDataDir)
    ).resolves.toEqual(plan.archivePlan);
    const aborted = await f
      .finalization()
      .abortStoredPlan(plan.archivePlan, f.globalDataDir);
    expect(aborted.status).toBe('aborted');
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(plan.destination)).toBe(false);
    await expect(
      f.finalization().applyStoredPlan(plan.archivePlan, plan.token)
    ).rejects.toMatchObject({ code: 'archive_plan_aborted' });
  }, 240_000);

  it('resumes after durable spec progress without rechecking consumed fresh-plan inputs', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'resume-after-spec-progress',
    });
    const canonical = path.join(
      bound.planningWorktree,
      'rasen',
      'projects',
      PROJECT_A,
      'specs'
    );
    const target = path.join(canonical, 'alpha', 'spec.md');
    f.write(
      target,
      '# alpha Specification\n\n## Purpose\nAlpha.\n\n## Requirements\n\n### Requirement: Rule\nDetails.\n\n#### Scenario: One\n- **WHEN** a\n- **THEN** b\n'
    );
    f.write(
      path.join(bound.changeDir, 'specs', 'alpha', 'spec.md'),
      '# alpha - Changes\n\n## MODIFIED Requirements\n\n### Requirement: Rule\nUpdated details.\n\n#### Scenario: One\n- **WHEN** a\n- **THEN** c\n'
    );
    const actions = await prepareSpecActions(
      bound.changeDir,
      canonical,
      bound.changeId
    );
    const plan = await f.finalization().plan(
      f.planInput(
        bound,
        {
          outcome: 'landed',
          commit: f.refOid(bound.executionWorktree, 'HEAD'),
        },
        {
          archive: f.preparation(bound, {
            specActionCandidates: actions,
            hasDeltaSpecs: true,
          }),
        }
      )
    );
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);

    const mkdir = defaultArchiveEngineAdapters.fs.mkdir;
    let destinationRefused = false;
    const first = await applyArchive(plan.archivePlan, {
      adapters: {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          mkdir: async (targetPath, options) => {
            if (
              targetPath === plan.destination &&
              destinationRefused === false
            ) {
              destinationRefused = true;
              const failure = new Error('injected destination reservation failure');
              (failure as NodeJS.ErrnoException).code = 'EACCES';
              throw failure;
            }
            return mkdir(targetPath, options);
          },
        },
      },
    });
    expect(first).toMatchObject({
      status: 'recoverable',
      specsUpdated: true,
      totals: { modified: 1 },
    });
    expect(fs.readFileSync(target, 'utf8')).toContain('Updated details.');
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    const catalogPath =
      plan.archivePlan.finalization!.revalidation.targetLine.catalogPath;
    const catalogText = fs.readFileSync(catalogPath, 'utf8');
    f.write(
      catalogPath,
      `${catalogText}\n# external drift after durable spec progress\n`
    );

    const stale = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);
    expect(stale).toMatchObject({
      status: 'recoverable',
      effectivePhase: 'specs-applied',
      associationPhase: 'pending',
      retainedPaths: expect.arrayContaining([
        plan.archivePlan.paths.stage,
        plan.archivePlan.paths.journal,
        bound.changeDir,
      ]),
      blockers: [
        expect.objectContaining({ code: 'finalization_plan_stale' }),
      ],
      manualRecoveryAction: {
        kind: 'manual-recovery-required',
      },
    });
    expect(stale.recoveryCommand).toBeUndefined();
    expect(stale.abortCommand).toBeUndefined();

    f.write(catalogPath, catalogText);

    const retry = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);
    expect(retry).toMatchObject({
      status: 'complete',
      associationPhase: 'applied',
      specSyncApplied: true,
    });
    expect(fs.existsSync(bound.changeDir)).toBe(false);
    expect(fs.existsSync(plan.destination)).toBe(true);
  }, 240_000);

  it('reports an applied association after a durable post-removal failure', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'post-removal-recovery',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    const lstat = defaultArchiveEngineAdapters.fs.lstat;
    let cleanupRefused = false;
    const lstatSpy = vi
      .spyOn(defaultArchiveEngineAdapters.fs, 'lstat')
      .mockImplementation(async targetPath => {
        if (
          targetPath === plan.archivePlan.paths.stage &&
          !fs.existsSync(bound.changeDir) &&
          cleanupRefused === false
        ) {
          cleanupRefused = true;
          const failure = new Error('injected stage cleanup failure');
          (failure as NodeJS.ErrnoException).code = 'EACCES';
          throw failure;
        }
        return lstat(targetPath);
      });

    let failed;
    try {
      failed = await f
        .finalization()
        .applyStoredPlan(plan.archivePlan, plan.token);
    } finally {
      lstatSpy.mockRestore();
    }

    expect(failed).toMatchObject({
      status: 'recoverable',
      associationPhase: 'applied',
      recoveryCommand:
        `rasen archive --apply-plan ${plan.token?.archivePlanToken} --yes`,
    });
    expect(fs.existsSync(bound.changeDir)).toBe(false);
    expect(fs.existsSync(plan.destination)).toBe(true);

    const retry = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);
    expect(retry, JSON.stringify(retry, null, 2)).toMatchObject({
      status: 'complete',
      associationPhase: 'applied',
    });
  }, 240_000);

});

describe('revalidation invalidates rather than repairs', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT_A],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('aborts when the planning worktree HEAD moved between plan and apply', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'head-moved',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable).toBe(true);

    f.write(path.join(bound.planningWorktree, 'note.md'), '# moved on\n');
    f.git(bound.planningWorktree, ['add', 'note.md']);
    f.git(bound.planningWorktree, ['commit', '-m', 'move HEAD after planning']);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain(
      'never repaired into agreement'
    );
    // Nothing was published.
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  it('aborts when the target-line code ref moved, rather than re-proving against new history', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'code-ref-moved',
    });
    const commit = f.refOid(bound.executionWorktree, 'HEAD');
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'landed', commit }));
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    expect(plan.token?.codeRefOid).toBe(f.refOid(f.projectRoot(PROJECT_A), 'refs/heads/release/0.2'));

    const codeRepo = f.projectRoot(PROJECT_A);
    f.write(path.join(codeRepo, 'moved.txt'), 'moved\n');
    f.git(codeRepo, ['add', 'moved.txt']);
    f.git(codeRepo, ['commit', '-m', 'advance the release line']);
    f.git(codeRepo, ['branch', '-f', 'release/0.2', 'HEAD']);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('refs/heads/release/0.2');
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  it('aborts when a canonical spec target changed underneath the frozen digest', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'spec-digest-moved',
    });
    const canonical = path.join(
      bound.planningWorktree,
      'rasen',
      'projects',
      PROJECT_A,
      'specs'
    );
    f.write(
      path.join(canonical, 'alpha', 'spec.md'),
      '# alpha Specification\n\n## Purpose\nAlpha.\n\n## Requirements\n\n### Requirement: Rule\nDetails.\n\n#### Scenario: One\n- **WHEN** a\n- **THEN** b\n'
    );
    f.write(
      path.join(bound.changeDir, 'specs', 'alpha', 'spec.md'),
      '# alpha - Changes\n\n## MODIFIED Requirements\n\n### Requirement: Rule\nUpdated details.\n\n#### Scenario: One\n- **WHEN** a\n- **THEN** c\n'
    );
    const actions = await prepareSpecActions(bound.changeDir, canonical, bound.changeId);
    expect(actions).toHaveLength(1);

    const plan = await f.finalization().plan(
      f.planInput(
        bound,
        { outcome: 'landed', commit: f.refOid(bound.executionWorktree, 'HEAD') },
        {
          archive: f.preparation(bound, {
            specActionCandidates: actions,
            hasDeltaSpecs: true,
          }),
        }
      )
    );
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);

    // Someone edited the canonical spec between plan and apply.
    fs.appendFileSync(path.join(canonical, 'alpha', 'spec.md'), '\nEdited underneath.\n');

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('alpha');
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  // ---- the surface that ships: `--apply-plan`, which carries NO token -----
  //
  // `src/core/archive.ts` calls `applyStoredPlan(plan)` with no second
  // argument, and that is the only surface a saved plan is ever applied
  // through — it is also the mutating half of the management-API bridge. Every
  // case above passes `plan.token`, so before this block the preconditions were
  // only ever exercised on a surface no user reaches. These four repeat the
  // safety-critical ones with the token OMITTED, exactly as production calls
  // it.

  it('APPLY-PLAN (no token) still aborts when the planning worktree HEAD moved', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'head-moved-tokenless',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable).toBe(true);

    f.write(path.join(bound.planningWorktree, 'note.md'), '# moved on\n');
    f.git(bound.planningWorktree, ['add', 'note.md']);
    f.git(bound.planningWorktree, ['commit', '-m', 'move HEAD after planning']);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('the planning worktree HEAD');
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  /**
   * The one that matters most. A `landed` record asserts `reachable: true`, and
   * a landed outcome is also the only one that SYNCHRONIZES the canonical
   * specs. Publishing both on the strength of a proof that has since been
   * invalidated — by a revert, a reset after a bad merge, or a force-push
   * landing locally — is the failure this closes.
   *
   * The ref is REWOUND rather than advanced: a fast-forward leaves the record's
   * claim true, so advancing it would not test the property.
   */
  it('APPLY-PLAN (no token) re-proves code-ref identity and refuses a commit the ref no longer contains', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'reachability-rewound',
    });
    const codeRepo = f.projectRoot(PROJECT_A);
    const before = f.refOid(codeRepo, 'refs/heads/release/0.2');

    // A real commit on the execution side, then the line fast-forwards onto it,
    // which is what makes the landed proof true at plan time.
    f.write(path.join(bound.executionWorktree, 'feature.txt'), 'shipped\n');
    f.git(bound.executionWorktree, ['add', 'feature.txt']);
    f.git(bound.executionWorktree, ['commit', '-m', 'implement the feature']);
    const commit = f.refOid(bound.executionWorktree, 'HEAD');
    f.git(codeRepo, ['branch', '-f', 'release/0.2', commit]);

    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'landed', commit }));
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    expect(plan.archivePlan.finalization?.record).toMatchObject({
      codeMerge: { commit, reachable: true },
    });

    // The line is rewound: the merge is undone and the commit is no longer
    // reachable from it.
    f.git(codeRepo, ['branch', '-f', 'release/0.2', before]);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain(
      'the target line code ref refs/heads/release/0.2'
    );
    expect((thrown as Error).message).toContain(`expected: ${commit}`);
    expect((thrown as Error).message).toContain(`actual: ${before}`);
    // Nothing was published, and — because a landed outcome is the only one
    // that writes specs — nothing was synchronized either.
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  /**
   * The Change source fingerprint, measured rather than read off the code.
   *
   * The spec lists it among the preconditions applying must revalidate "before
   * its first write", and it is enforced in the ENGINE rather than in
   * `revalidate()` — which raises the question of whether it fires early enough
   * to matter. It does: `applyArchive` compares the active tree's deletion
   * authority against the frozen fingerprint before it stages anything, so a
   * Change edited between plan and apply is refused with NOTHING published and
   * the source intact. Asserted end-to-end so the ordering claim rests on
   * observed state, not on a line number.
   */
  it('APPLY-PLAN (no token) refuses an edited Change source before publishing anything', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'source-edited',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable).toBe(true);

    // The Change is edited after planning — the ordinary way a plan goes stale.
    f.write(path.join(bound.changeDir, 'proposal.md'), '# Edited after planning\n');

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('the Change source at');
    // "Before the first write", stated as observable facts: nothing published,
    // the source intact, and the archive line still ABSENT — the transaction
    // did not even create the directory it would have published into.
    expect(fs.existsSync(plan.destination)).toBe(false);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 240_000);

  it('APPLY-PLAN (no token) refuses when the target-line catalog was re-pointed', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'catalog-repointed',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable).toBe(true);
    const frozen = plan.archivePlan.finalization?.revalidation.targetLine as {
      catalogPath: string;
      catalogDigest: string;
    };
    expect(frozen.catalogDigest).toMatch(/^[0-9a-f]{64}$/u);
    // The catalog the plan froze is the one in the checkout the finalization
    // runs against — the PLANNING worktree, not the integration checkout.
    expect(frozen.catalogPath.startsWith(bound.planningWorktree)).toBe(true);

    // Exactly what `rasen store target-line set-ref` does: the line now names a
    // different Store ref, so the plan's frozen address and ref set no longer
    // describe the line. Written by substituting into the text production
    // itself wrote, so the case cannot pass on a shape mismatch.
    f.git(f.storeRoot, ['branch', 'release/0.3', 'refs/heads/release/0.2']);
    const repointed = fs
      .readFileSync(frozen.catalogPath, 'utf8')
      .replace('storeRef: refs/heads/release/0.2', 'storeRef: refs/heads/release/0.3');
    expect(repointed).toContain('refs/heads/release/0.3');
    fs.writeFileSync(frozen.catalogPath, repointed);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('the target-line catalog');
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);
  it('rejects a self-consistent plan outside the Foundation-authorized archive root', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'unauthorized-archive-root',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    const originalFinalization = plan.archivePlan.finalization!;
    const unauthorizedRoot = f.beside('attacker-selected-archive');
    const unauthorizedDestination = path.join(
      unauthorizedRoot,
      path.basename(plan.destination)
    );
    const unauthorizedStage = path.join(
      unauthorizedRoot,
      path.basename(plan.archivePlan.paths.stage)
    );
    const { planHash: _originalHash, ...originalWithoutHash } = plan.archivePlan;
    const alteredWithoutHash = {
      ...originalWithoutHash,
      paths: {
        ...originalWithoutHash.paths,
        archiveParent: unauthorizedRoot,
        stage: unauthorizedStage,
        final: unauthorizedDestination,
        journal: path.join(
          unauthorizedStage,
          path.basename(originalWithoutHash.paths.journal)
        ),
        publishedJournal: path.join(
          unauthorizedDestination,
          path.basename(originalWithoutHash.paths.publishedJournal)
        ),
      },
      finalization: {
        ...originalFinalization,
        destination: unauthorizedDestination,
        revalidation: {
          ...originalFinalization.revalidation,
          archive: {
            ...originalFinalization.revalidation.archive,
            root: unauthorizedRoot,
            destination: unauthorizedDestination,
          },
        },
      },
    };
    const alteredPlan = {
      ...alteredWithoutHash,
      planHash: hashArchivePlan(alteredWithoutHash),
    };
    const sourceBefore = hashTree(bound.changeDir);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(alteredPlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain(
      'the Store archive destination authorized by Foundation'
    );
    expect(hashTree(bound.changeDir)).toEqual(sourceBefore);
    expect(fs.existsSync(unauthorizedRoot)).toBe(false);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 240_000);

});

describe('revalidating the successor a superseded record names', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT_A],
      storeBranches: ['release/0.2', 'release/0.3'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2' },
        },
        { id: LINE_03, storeRef: 'refs/heads/release/0.3' },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  /**
   * `supersededBy` names another Change INSTANCE, and the only thing that ever
   * made that name true is a committed blob at a Store ref. The evidence is
   * frozen into the plan at search time and — before this — was never read
   * again, so an apply could publish a pointer to a Change that had been
   * deleted from every ref in between: the exact fabrication the successor
   * search exists to prevent.
   */
  it('APPLY-PLAN (no token) refuses when the successor Change is gone from the ref it was found at', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'superseded-by-deleted',
    });
    // The successor lives on the OTHER line and is read as a committed blob.
    const successor = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT_A,
      targetLineId: LINE_03,
      changeId: 'successor-work',
      instanceSeed: 'e'.repeat(32),
    });
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'seed the successor Change']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.3', 'HEAD']);

    const plan = await f.finalization().plan(
      f.planInput(bound, {
        outcome: 'superseded',
        reason: 'The work moved to 0.3.',
        by: successor.instanceId,
      })
    );
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    expect(plan.archivePlan.finalization?.revalidation.successor).toMatchObject({
      changeInstanceId: successor.instanceId,
      foundAtRef: 'refs/heads/release/0.3',
    });

    // The successor Change is deleted and the deletion is committed onto the
    // very ref the evidence names.
    fs.rmSync(successor.directory, { recursive: true, force: true });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'drop the successor Change']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.3', 'HEAD']);

    let thrown: unknown;
    try {
      await f.finalization().applyStoredPlan(plan.archivePlan);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_plan_stale');
    expect((thrown as Error).message).toContain('the successor Change metadata');
    expect((thrown as Error).message).toContain('refs/heads/release/0.3');
    expect(fs.existsSync(plan.destination)).toBe(false);
  }, 240_000);

  it('finishes exact recovery after an owned reservation despite later catalog drift', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'reserved-before-progress',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);

    const copyFile = defaultArchiveEngineAdapters.fs.copyFile;
    let finalCopyRefused = false;
    const first = await applyArchive(plan.archivePlan, {
      adapters: {
        ...defaultArchiveEngineAdapters,
        fs: {
          ...defaultArchiveEngineAdapters.fs,
          copyFile: async (source, target, flags) => {
            if (
              target.startsWith(`${plan.destination}${path.sep}`) &&
              !finalCopyRefused
            ) {
              finalCopyRefused = true;
              const failure = new Error('injected post-reservation copy failure');
              (failure as NodeJS.ErrnoException).code = 'EIO';
              throw failure;
            }
            return copyFile(source, target, flags);
          },
        },
      },
    });
    expect(first).toMatchObject({
      status: 'recoverable',
      effectivePhase: 'specs-applied',
    });
    expect(finalCopyRefused).toBe(true);
    expect(fs.existsSync(plan.destination)).toBe(true);

    const catalogPath =
      plan.archivePlan.finalization!.revalidation.targetLine.catalogPath;
    f.write(
      catalogPath,
      `${fs.readFileSync(catalogPath, 'utf8')}\n# drift after reservation\n`
    );

    const retry = await f
      .finalization()
      .applyStoredPlan(plan.archivePlan, plan.token);
    expect(retry, JSON.stringify(retry, null, 2)).toMatchObject({
      status: 'complete',
      associationPhase: 'applied',
    });
    expect(fs.existsSync(bound.changeDir)).toBe(false);
    expect(fs.existsSync(plan.destination)).toBe(true);
  }, 240_000);
});

describe('idempotence and the published record', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT_A],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('reports an already-published entry as complete, decided from its RECORD', async () => {
    const bound = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'idempotent-change',
    });
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    const result = await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
    expect(result.status).toBe('complete');
    expect(fs.existsSync(bound.changeDir)).toBe(false);

    // The state a RECOVERABLE run leaves behind: the entry is published and an
    // active source for the same Change instance is still on disk. Re-planning
    // must report the recorded outcome and write nothing a second time.
    f.seedChange({
      root: bound.planningWorktree,
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: bound.changeId,
    });
    const replanned = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));

    expect(replanned.alreadyComplete).toBe(true);
    expect(replanned.applicable).toBe(false);
    expect(fs.readdirSync(bound.archiveLine)).toHaveLength(1);

    // …and the decision comes from the record's `changeInstanceId`, not from a
    // directory whose name happens to match: a DIFFERENT instance of the same
    // alias is not already complete.
    f.seedChange({
      root: bound.planningWorktree,
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: bound.changeId,
      instanceSeed: 'f'.repeat(32),
    });
    const otherInstance = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }))
      .catch((error: unknown) => error);
    // The workspace index still binds the ORIGINAL instance, so a second
    // instance of the same alias is refused rather than silently finalized —
    // and it is certainly not reported as already complete.
    expect(
      otherInstance instanceof Error
        ? codeOf(otherInstance)
        : (otherInstance as { alreadyComplete: boolean }).alreadyComplete
    ).not.toBe(true);
  }, 240_000);
});

describe('the lock protocol', () => {
  let f: StoreFinalizationFixture;
  let coordination: ReturnType<typeof createNodeWorkspaceCoordination>;

  const scopeA = {
    storeUid: STORE_UID,
    projectId: PROJECT_A,
    targetLineId: LINE_02,
    changeInstanceId: `ci_${'a'.repeat(64)}`,
  };

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT_A],
      lines: [{ id: LINE_02, storeRef: 'refs/heads/main' }],
    });
    coordination = createNodeWorkspaceCoordination(f.globalDataDir);
  });

  afterEach(() => {
    f.cleanup();
  });

  it('takes exactly the scope and change keys, in child 4 s fixed order', () => {
    const keys = finalizationLockKeys(scopeA);
    expect(keys.map(key => key.kind)).toEqual(['scope', 'change']);
    expect(keys[0]?.material).toEqual({
      storeUid: STORE_UID,
      projectId: PROJECT_A,
      targetLineId: LINE_02,
    });
    expect(keys[1]?.material).toEqual({ changeInstanceId: scopeA.changeInstanceId });
    // The workspace key is not taken (no worktree is created, moved, or
    // removed) and neither is the integration key — which is nonetheless
    // DEFINED, so a reader can see the omission is a decision.
    expect(keys.some(key => key.kind === 'workspace')).toBe(false);
    expect(keys.some(key => key.kind === 'integration')).toBe(false);
    expect(
      unheldIntegrationLockKey({ storeUid: STORE_UID, targetLineId: LINE_02 }).kind
    ).toBe('integration');
  });

  it('leaves the integration lock UNHELD while a finalization runs', async () => {
    const integration = unheldIntegrationLockKey({
      storeUid: STORE_UID,
      targetLineId: LINE_02,
    });
    await withFinalizationLocks(coordination, scopeA, async () => {
      expect(await lockIsHeld(coordination, integration)).toBe(false);
      expect(
        await lockIsHeld(coordination, finalizationLockKeys(scopeA)[0]!)
      ).toBe(true);
    });
  });

  /**
   * Holds `scope`'s locks from a SEPARATE async context and hands back a
   * release function. Contending from inside the holder's own context would
   * trip the acquisition-order assertion instead of the file lock, which is a
   * programming-error guard rather than the mutual exclusion under test.
   */
  async function hold(scope: typeof scopeA): Promise<{
    release: () => void;
    done: Promise<void>;
  }> {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const done = withFinalizationLocks(coordination, scope, () => gate);
    // Wait until the locks are actually on disk before contending.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await lockIsHeld(coordination, finalizationLockKeys(scope)[1]!)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return { release, done };
  }

  it('makes two finalizations of ONE Change instance mutually exclusive', async () => {
    let secondEntered = false;
    const holder = await hold(scopeA);

    // A separate acquisition, as a second process would make it. The deadline
    // is short so the test measures exclusion, not patience.
    const second = withFinalizationLocks(
      coordination,
      scopeA,
      async () => {
        secondEntered = true;
      },
      { deadlineMs: 250, pollMs: 25 }
    );

    let thrown: unknown;
    try {
      await second;
    } catch (error) {
      thrown = error;
    }
    holder.release();
    await holder.done;

    expect(secondEntered).toBe(false);
    expect((thrown as { diagnostic?: { code?: string } }).diagnostic?.code).toBe(
      'workspace_lock_unavailable'
    );
    expect((thrown as Error).message).toContain('is held by');
  });

  it('lets different projects and different target lines finalize concurrently', async () => {
    const otherProject = {
      ...scopeA,
      projectId: PROJECT_B,
      changeInstanceId: `ci_${'b'.repeat(64)}`,
    };
    const otherLine = {
      ...scopeA,
      targetLineId: LINE_03,
      changeInstanceId: `ci_${'c'.repeat(64)}`,
    };
    const entered: string[] = [];
    const holder = await hold(scopeA);

    // Neither of these waits on the held scope: a short deadline would time
    // out if they contended, so completing proves independence.
    await withFinalizationLocks(
      coordination,
      otherProject,
      async () => {
        entered.push('other-project');
      },
      { deadlineMs: 250, pollMs: 25 }
    );
    await withFinalizationLocks(
      coordination,
      otherLine,
      async () => {
        entered.push('other-line');
      },
      { deadlineMs: 250, pollMs: 25 }
    );

    holder.release();
    await holder.done;
    expect(entered).toEqual(['other-project', 'other-line']);
  });

  it('retries contention within a bounded deadline instead of failing immediately', async () => {
    const holder = await hold(scopeA);
    let released = false;

    // Started while the lock is held; it must WAIT and then succeed.
    const contender = withFinalizationLocks(
      coordination,
      scopeA,
      async () => {
        expect(released).toBe(true);
        return 'acquired-after-waiting';
      },
      { deadlineMs: 10_000, pollMs: 25 }
    );

    await new Promise(resolve => setTimeout(resolve, 200));
    released = true;
    holder.release();
    await holder.done;

    expect(await contender).toBe('acquired-after-waiting');
  });

  it('never retries a SEMANTIC conflict thrown from inside the critical section', async () => {
    let invocations = 0;
    await expect(
      withFinalizationLocks(
        coordination,
        scopeA,
        async () => {
          invocations += 1;
          throw new Error('planning_execution_binding_mismatch: the binding disagrees');
        },
        { deadlineMs: 5_000, pollMs: 25 }
      )
    ).rejects.toThrow('the binding disagrees');

    // Retrying cannot change the answer and only delays the diagnostic.
    expect(invocations).toBe(1);
    // And the locks were released despite the failure.
    for (const key of finalizationLockKeys(scopeA)) {
      expect(await lockIsHeld(coordination, key)).toBe(false);
    }
  });
});
