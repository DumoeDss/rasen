/**
 * `store-finalization-outcomes-v2` tasks 10.7 and 13.3 — association completion
 * and the recovery matrix.
 *
 * The shape this phase must NOT take is a best-effort write after publication:
 * a crash in that window leaves a bound workspace pair pointing at a Change
 * directory that has moved, which is exactly the state child 4's index treats
 * as a conflict and refuses to operate against. So failures are injected
 * BEFORE, DURING, and AFTER the phase, and each case asserts the two
 * invariants that matter:
 *
 *   - the transaction never reports COMPLETE with a stale binding;
 *   - a bound pair never ends up pointing at a moved Change directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyArchive,
  defaultArchiveEngineAdapters,
  type ArchiveEngineAdapters,
  type ArchivePlan,
} from '../../../src/core/archive-engine.js';
import { completeFinalizationAssociation } from '../../../src/core/store/finalization/index.js';
import {
  readWorkspaceIndexEntry,
  writeWorkspaceIndexEntry,
  type WorkspaceIndexEntry,
} from '../../../src/core/store/workspace/registry.js';
import { createNodeWorkspaceCoordination } from '../../../src/core/store/workspace/dependencies.js';
import {
  createStoreFinalizationFixture,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../../helpers/store-finalization-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

describe('association completion inside the transaction', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  /** The Module's own association adapter, plus whatever failure is injected. */
  function adapters(overrides: Partial<ArchiveEngineAdapters> = {}): ArchiveEngineAdapters {
    return {
      ...defaultArchiveEngineAdapters,
      finalizeArchiveAssociation: async ({ plan }: { plan: ArchivePlan }) =>
        void (await completeFinalizationAssociation(f.dependenciesFor(), plan)),
      ...overrides,
    };
  }

  async function planFor(bound: BoundChange) {
    const plan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    return plan;
  }

  function indexEntry(bound: BoundChange): Promise<WorkspaceIndexEntry | null> {
    return readWorkspaceIndexEntry(
      createNodeWorkspaceCoordination(f.globalDataDir),
      bound.planningScopeId,
      bound.changeId
    );
  }

  function association(bound: BoundChange): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(
        path.join(bound.executionWorktree, '.rasen', 'planning-binding.json'),
        'utf8'
      )
    ) as Record<string, unknown>;
  }

  it('completes the binding as part of the transaction, not after it', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-complete',
    });
    const plan = await planFor(bound);

    const result = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(result.status).toBe('complete');

    const entry = await indexEntry(bound);
    // The WORKTREE lifecycle is not advanced. `phase` has exactly one reader in
    // the repository — `phaseReached` in child 4's `workspace/cleanup.ts` —
    // which reads it as a `CleanupPhase` ordinal, so the terminal 'complete'
    // would mean "both sides already removed". A finalization removes no
    // worktree, so the pair stays `bound` and stays cleanable. The cleanup case
    // at the end of this suite is what proves the consequence.
    expect(entry?.phase).toBe('bound');
    // That the phase RAN is carried by the execution-side `finalizedChange`
    // block below, which is finalization's durable carrier — never by an
    // advanced lifecycle phase.
    expect(entry?.changeInstanceId).toBe(bound.changeInstanceId);
    expect(entry?.workspacePairId).toBe(bound.workspacePairId);
    expect(association(bound).finalizedChange).toMatchObject({
      changeId: bound.changeId,
      outcome: 'abandoned',
      publishedEntry: plan.destination,
    });
    // The active Change directory has moved, and the binding says so — the
    // pair does NOT point at a directory that is no longer there.
    expect(fs.existsSync(bound.changeDir)).toBe(false);
    expect(fs.existsSync(plan.destination)).toBe(true);
  }, 240_000);

  it('injected failure BEFORE the phase leaves the binding untouched', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'fail-before',
    });
    const plan = await planFor(bound);
    const before = association(bound);
    const entryBefore = await indexEntry(bound);

    const result = await applyArchive(plan.archivePlan, { adapters: adapters({
      writeArchiveV2Json: async () => {
        throw new Error('injected accounting failure');
      },
    }) });

    expect(result.status).not.toBe('complete');
    // Untouched, field for field — a stronger claim than "not 'complete'",
    // which the correct value satisfies for free and therefore cannot detect a
    // partial write.
    expect(await indexEntry(bound)).toEqual(entryBefore);
    expect(association(bound)).toEqual(before);
    expect(association(bound).finalizedChange).toBeUndefined();
    // The active source survives, so nothing is lost and the pair still points
    // at a directory that exists.
    expect(fs.existsSync(bound.changeDir)).toBe(true);
  }, 240_000);

  it('injected failure DURING the phase keeps the archive published and stays recoverable', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'fail-during',
    });
    const plan = await planFor(bound);
    const entryBefore = await indexEntry(bound);

    const failed = await applyArchive(plan.archivePlan, { adapters: adapters({
      finalizeArchiveAssociation: async () => {
        throw new Error('injected binding failure');
      },
    }) });

    expect(failed.status).not.toBe('complete');
    // Published and staying published; the journal names the unfinished phase.
    expect(fs.existsSync(plan.destination)).toBe(true);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(association(bound).finalizedChange).toBeUndefined();
    expect(await indexEntry(bound)).toEqual(entryBefore);

    // Re-applying the SAME plan completes rather than duplicating.
    const retried = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(retried.status).toBe('complete');
    expect(fs.readdirSync(bound.archiveLine)).toHaveLength(1);
    expect((await indexEntry(bound))?.phase).toBe('bound');
    expect(association(bound).finalizedChange).toMatchObject({ changeId: bound.changeId });
  }, 240_000);

  it('injected failure AFTER the phase still completes on retry, writing the same bytes', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'fail-after',
    });
    const plan = await planFor(bound);

    let failSourceRemoval = true;
    const failed = await applyArchive(plan.archivePlan, { adapters: adapters({
      fs: {
        ...defaultArchiveEngineAdapters.fs,
        rename: async (source: string, target: string) => {
          if (failSourceRemoval && source === plan.archivePlan.paths.active) {
            failSourceRemoval = false;
            throw new Error('injected source-removal failure');
          }
          return defaultArchiveEngineAdapters.fs.rename(source, target);
        },
      },
    }) });

    expect(failed.status).not.toBe('complete');
    // The binding was already completed, because the phase precedes removal.
    const afterFailure = association(bound);
    expect(afterFailure.finalizedChange).toMatchObject({ changeId: bound.changeId });
    expect((await indexEntry(bound))?.phase).toBe('bound');

    const retried = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(retried.status).toBe('complete');
    // Idempotent by construction: the same derived value, so the retry writes
    // the same bytes rather than appending a second record.
    expect(association(bound)).toEqual(afterFailure);
    expect(fs.existsSync(bound.changeDir)).toBe(false);
  }, 240_000);

  it('fails closed on a DISAGREEING index entry, and completes once it is repaired', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'binding-disagrees',
    });
    const plan = await planFor(bound);
    const coordination = createNodeWorkspaceCoordination(f.globalDataDir);
    const recorded = (await indexEntry(bound)) as WorkspaceIndexEntry;

    // Someone else's pair is recorded for this Change.
    await writeWorkspaceIndexEntry(coordination, {
      ...recorded,
      workspacePairId: `wp_${'9'.repeat(64)}`,
    });

    const failed = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(failed.status).not.toBe('complete');
    expect(
      failed.blockers.some(blocker => blocker.message.includes('disagrees with the finalized pair'))
    ).toBe(true);
    // The archive stays published and the source survives: recoverable, not lost.
    expect(fs.existsSync(plan.destination)).toBe(true);
    expect(fs.existsSync(bound.changeDir)).toBe(true);

    await writeWorkspaceIndexEntry(coordination, recorded);
    const retried = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(retried.status).toBe('complete');
    expect((await indexEntry(bound))?.phase).toBe('bound');
    expect(association(bound).finalizedChange).toMatchObject({ changeId: bound.changeId });
  }, 240_000);

  it('repairs a MISSING index entry from what is already true on disk, idempotently', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'binding-missing',
    });
    const plan = await planFor(bound);
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${bound.planningScopeId}.json`
    );
    // The entry disappeared — the ordinary way machine state is lost.
    fs.rmSync(indexPath, { force: true });

    const result = await applyArchive(plan.archivePlan, { adapters: adapters() });
    expect(result.status).toBe('complete');

    const repaired = await indexEntry(bound);
    // The repair DERIVES the lifecycle phase, and derives it by child 4's own
    // bind rule (a pair with a `workspacePairId` is `bound`) rather than
    // stamping a phase this operation did not reach.
    expect(repaired?.phase).toBe('bound');
    // `planId` names a WORKSPACE plan. There is none to name here, so the
    // repair writes what child 4's repair writes rather than borrowing the
    // archive transaction id from a different id space.
    expect(repaired?.planId).toBe('');
    expect(repaired?.workspacePairId).toBe(bound.workspacePairId);
    expect(repaired?.planning.root).toBe(bound.planningWorktree);
    expect(repaired?.execution.root).toBe(bound.executionWorktree);

    // Repeating the phase writes the same value rather than a second entry.
    const before = fs.readFileSync(indexPath, 'utf8');
    await completeFinalizationAssociation(f.dependenciesFor(), plan.archivePlan);
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(before);
  }, 240_000);

  it('is a recorded NO-OP, declared in advance, for a plan with no workspace pair', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'noop-association',
    });
    const plan = await planFor(bound);
    const entryBefore = await indexEntry(bound);
    const noopPlan: ArchivePlan = {
      ...plan.archivePlan,
      finalization: {
        ...plan.archivePlan.finalization!,
        association: { noop: true, reason: 'this scope has no workspace pair' },
      },
    };

    // "Nothing to do" is a PLANNED outcome, declared with its reason, rather
    // than a silent skip.
    expect(noopPlan.finalization?.association.reason).toContain('no workspace pair');
    expect(await completeFinalizationAssociation(f.dependenciesFor(), noopPlan)).toBe(
      'no-op'
    );
    // Nothing was written: the index entry is untouched field for field, and no
    // binding gained a finalized-Change block.
    expect(await indexEntry(bound)).toEqual(entryBefore);
    expect(association(bound).finalizedChange).toBeUndefined();

    // The DEFAULT engine adapter honours the declaration rather than inventing
    // a binding, and refuses only when the plan says the phase is real.
    await expect(
      defaultArchiveEngineAdapters.finalizeArchiveAssociation({ plan: noopPlan })
    ).resolves.toBeUndefined();
    await expect(
      defaultArchiveEngineAdapters.finalizeArchiveAssociation({ plan: plan.archivePlan })
    ).rejects.toThrow(/finalization Module adapter/u);
  }, 240_000);

  // ---- the cross-Module consequence --------------------------------------

  /**
   * The one assertion that makes the phase value above load-bearing rather than
   * cosmetic. The index entry this phase writes is child 4's document, and its
   * `phase` field is read by child 4's cleanup as a `CleanupPhase` ordinal — so
   * a finalization that stamps a terminal phase there disables the cleanup that
   * runs after it. Nothing inside this change can observe that; only running
   * child 4's real `planCleanup` + `applyCleanup` after a real finalization can.
   *
   * With `phase: 'complete'` written here, this test fails on every one of the
   * last four assertions at once: `removed` is empty, `git worktree remove` is
   * never called, both directories survive, and Git still lists both worktrees
   * — while the index entry that named them is deleted and the result still
   * reports `complete`.
   */
  it('leaves the workspace pair CLEANABLE — child 4 still removes both worktrees', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'cleanable-after-finalization',
    });
    const plan = await planFor(bound);

    expect((await applyArchive(plan.archivePlan, { adapters: adapters() })).status).toBe('complete');
    expect(await indexEntry(bound)).not.toBeNull();

    // Compared by directory NAME, so the assertion does not depend on how Git
    // spells a Windows path in `--porcelain` output.
    const planningName = path.basename(bound.planningWorktree);
    expect(f.git(f.storeRoot, ['worktree', 'list', '--porcelain'])).toContain(planningName);

    const selectors = {
      store: f.storeId,
      project: PROJECT,
      targetLine: LINE,
      changeId: bound.changeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      // The finalization published an Archive entry into the planning worktree
      // and did not commit it, which is the user's to keep or discard. The
      // question here is whether the REMOVAL LOOP runs, not whether untracked
      // work blocks it, so the precondition is satisfied explicitly rather than
      // left to make the case vacuous.
      includeUntracked: true,
    } as Parameters<ReturnType<typeof f.workspace>['planCleanup']>[0];

    const cleanup = await f.workspace().planCleanup(selectors);
    expect(cleanup.applicable, JSON.stringify(cleanup.blockers)).toBe(true);
    expect(cleanup.targets.map(target => target.side)).toEqual(['execution', 'planning']);

    const result = await f.workspace().applyCleanup(cleanup.token!);

    // Both sides were actually removed — not skipped, not "already done".
    expect([...result.removed].sort()).toEqual(
      [bound.executionWorktree, bound.planningWorktree].sort()
    );
    expect(fs.existsSync(bound.planningWorktree)).toBe(false);
    expect(fs.existsSync(bound.executionWorktree)).toBe(false);
    // And Git agrees: the registrations are gone, so the pair is not merely
    // absent from disk while still claimed by the repository.
    expect(f.git(f.storeRoot, ['worktree', 'list', '--porcelain'])).not.toContain(planningName);
    expect(result.indexEntryRemoved).toBe(true);
  }, 240_000);
});
