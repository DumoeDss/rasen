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
import { createHash } from 'node:crypto';
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
import {
  atomicWorkspaceWriteText,
  createNodeWorkspaceCoordination,
  readAtomicWorkspaceSnapshot,
  type AtomicWorkspaceCarrierAuthority,
} from '../../../src/core/store/workspace/dependencies.js';
import {
  createStoreFinalizationFixture,
  hashTree,
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
      finalizeArchiveAssociation: async ({
        plan,
        requireComplete,
        carriers,
        carrierPrepared,
      }) =>
        void (await completeFinalizationAssociation(f.dependenciesFor(), plan, {
          requireComplete,
          carriers,
          carrierPrepared,
        })),
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

  it('completes a binding after normal commits advance both worktrees', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-after-commits',
    });
    const recordedBefore = (await indexEntry(bound)) as WorkspaceIndexEntry;
    fs.writeFileSync(path.join(bound.planningWorktree, 'planning-note.md'), 'later\n');
    f.git(bound.planningWorktree, ['add', 'planning-note.md']);
    f.git(bound.planningWorktree, ['commit', '-m', 'record later planning work']);
    fs.writeFileSync(path.join(bound.executionWorktree, 'implementation.txt'), 'later\n');
    f.git(bound.executionWorktree, ['add', 'implementation.txt']);
    f.git(bound.executionWorktree, ['commit', '-m', 'record later implementation work']);

    const plan = await planFor(bound);
    const expected = plan.archivePlan.finalization?.association.expected;
    expect(expected?.planning.headOid).not.toBe(recordedBefore.planning.headOid);
    expect(expected?.execution.headOid).not.toBe(recordedBefore.execution.headOid);

    const result = await applyArchive(plan.archivePlan, { adapters: adapters() });

    expect(result.status, JSON.stringify(result.blockers)).toBe('complete');
    expect(association(bound).finalizedChange).toMatchObject({
      changeId: bound.changeId,
      publishedEntry: plan.destination,
    });
    expect(fs.existsSync(bound.changeDir)).toBe(false);
  }, 240_000);

  it('refuses planning a bound pair whose execution association is missing', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-missing-before-plan',
    });
    const associationPath = path.join(
      bound.executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    const associationBefore = fs.readFileSync(associationPath, 'utf8');
    const indexBefore = await indexEntry(bound);
    const changeMetadataPath = path.join(bound.changeDir, '.openspec.yaml');
    const changeBefore = fs.readFileSync(changeMetadataPath, 'utf8');
    fs.unlinkSync(associationPath);

    const transactionBefore = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );
    const refusedPlan = await f
      .finalization()
      .plan(
        f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }, {
          startPath: bound.planningWorktree,
        })
      );

    expect(refusedPlan.applicable).toBe(false);
    expect(refusedPlan.association).toMatchObject({
      noop: false,
      executionAssociationPath: associationPath,
    });
    expect(refusedPlan.blockers).toEqual([
      expect.objectContaining({
        code: 'planning_execution_binding_mismatch',
        expected: associationPath,
        actual: '(missing)',
      }),
    ]);
    expect(refusedPlan.archivePlan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          path: associationPath,
        }),
      ])
    );
    expect(await indexEntry(bound)).toEqual(indexBefore);
    expect(fs.readFileSync(changeMetadataPath, 'utf8')).toBe(changeBefore);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
    expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
      transactionBefore
    );

    fs.writeFileSync(associationPath, associationBefore);
    const recoveredPlan = await f
      .finalization()
      .plan(f.planInput(bound, { outcome: 'abandoned', reason: 'Dropped.' }));
    expect(recoveredPlan.applicable, JSON.stringify(recoveredPlan.blockers)).toBe(true);
    const recovered = await applyArchive(recoveredPlan.archivePlan, {
      adapters: adapters(),
    });
    expect(recovered.status, JSON.stringify(recovered.blockers)).toBe('complete');
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

  it('refuses live Git movement after planning before the first mutation', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-stale-after-plan',
    });
    const plan = await planFor(bound);
    const transactionBefore = hashTree(
      path.join(f.globalDataDir, 'archive-transactions')
    );
    fs.writeFileSync(path.join(bound.planningWorktree, 'post-plan.md'), 'moved\n');
    f.git(bound.planningWorktree, ['add', 'post-plan.md']);
    f.git(bound.planningWorktree, ['commit', '-m', 'move after finalization plan']);
    const changedSource = hashTree(bound.changeDir);

    await expect(
      f.finalization().applyStoredPlan(plan.archivePlan, plan.token)
    ).rejects.toMatchObject({ code: 'finalization_plan_stale' });

    expect(hashTree(bound.changeDir)).toEqual(changedSource);
    expect(fs.existsSync(plan.destination)).toBe(false);
    expect(hashTree(path.join(f.globalDataDir, 'archive-transactions'))).toEqual(
      transactionBefore
    );
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

  it('rejects forged complete association progress when its durable fact is missing', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'forged-association-complete',
    });
    const plan = await planFor(bound);
    let failSourceRemoval = true;
    const failed = await applyArchive(plan.archivePlan, {
      adapters: adapters({
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
      }),
    });
    expect(failed.status).not.toBe('complete');

    const associationPath = path.join(
      bound.executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    const completedBytes = fs.readFileSync(associationPath, 'utf8');
    const forged = JSON.parse(completedBytes) as Record<string, unknown>;
    delete forged.finalizedChange;
    const forgedBytes = `${JSON.stringify(forged, null, 2)}\n`;
    fs.writeFileSync(associationPath, forgedBytes);

    const retry = await applyArchive(plan.archivePlan, { adapters: adapters() });

    expect(retry).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          path: associationPath,
        }),
      ],
    });
    expect(fs.readFileSync(associationPath, 'utf8')).toBe(forgedBytes);
    expect(fs.existsSync(bound.changeDir)).toBe(true);

    fs.writeFileSync(associationPath, completedBytes);
    expect((await applyArchive(plan.archivePlan, { adapters: adapters() })).status).toBe(
      'complete'
    );
  }, 240_000);

  it('does not advance when the planned execution association is missing', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-missing',
    });
    const plan = await planFor(bound);
    const associationPath = path.join(
      bound.executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    const savedPath = `${associationPath}.saved`;
    const entryBefore = await indexEntry(bound);
    fs.renameSync(associationPath, savedPath);

    const failed = await applyArchive(plan.archivePlan, { adapters: adapters() });

    expect(failed).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          path: associationPath,
        }),
      ],
    });
    expect(await indexEntry(bound)).toEqual(entryBefore);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(plan.destination)).toBe(true);

    fs.renameSync(savedPath, associationPath);
    expect((await applyArchive(plan.archivePlan, { adapters: adapters() })).status).toBe(
      'complete'
    );
  }, 240_000);

  it('does not overwrite a disagreeing execution association', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'association-carrier-disagrees',
    });
    const plan = await planFor(bound);
    const associationPath = path.join(
      bound.executionWorktree,
      '.rasen',
      'planning-binding.json'
    );
    const original = fs.readFileSync(associationPath, 'utf8');
    const disagreeing = JSON.parse(original) as Record<string, unknown>;
    disagreeing.targetLineId = 'line-someone-else';
    const disagreeingBytes = `${JSON.stringify(disagreeing, null, 2)}\n`;
    fs.writeFileSync(associationPath, disagreeingBytes);
    const entryBefore = await indexEntry(bound);

    const failed = await applyArchive(plan.archivePlan, { adapters: adapters() });

    expect(failed).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          path: associationPath,
        }),
      ],
    });
    expect(fs.readFileSync(associationPath, 'utf8')).toBe(disagreeingBytes);
    expect(await indexEntry(bound)).toEqual(entryBefore);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(plan.destination)).toBe(true);

    fs.writeFileSync(associationPath, original);
    expect((await applyArchive(plan.archivePlan, { adapters: adapters() })).status).toBe(
      'complete'
    );
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

  it('retains a malformed unrelated index entry instead of normalizing it away', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'binding-valid-a',
    });
    const plan = await planFor(bound);
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${bound.planningScopeId}.json`
    );
    const document = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      entries: unknown[];
    };
    document.entries.push({
      version: 1,
      planningScopeId: bound.planningScopeId,
      changeId: 'malformed-b',
      planning: {},
      execution: {},
    });
    const malformedBytes = `${JSON.stringify(document, null, 2)}\n`;
    fs.writeFileSync(indexPath, malformedBytes);

    const failed = await applyArchive(plan.archivePlan, { adapters: adapters() });

    expect(failed).toMatchObject({
      status: 'recoverable',
      blockers: [
        expect.objectContaining({
          code: 'planning_execution_binding_mismatch',
          path: plan.archivePlan.finalization?.association.executionAssociationPath,
        }),
      ],
    });
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(malformedBytes);
    expect(fs.existsSync(bound.changeDir)).toBe(true);
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
    // The repair uses the exact lifecycle phase and workspace plan identity
    // frozen from the pre-loss entry rather than deriving a new binding fact.
    expect(repaired?.phase).toBe(
      plan.archivePlan.finalization?.association.expected?.indexPhase
    );
    expect(repaired?.planId).toBe(
      plan.archivePlan.finalization?.association.expected?.indexPlanId
    );
    expect(repaired?.workspacePairId).toBe(bound.workspacePairId);
    expect(repaired?.planning.root).toBe(bound.planningWorktree);
    expect(repaired?.execution.root).toBe(bound.executionWorktree);

    // Repeating the phase writes the same value rather than a second entry.
    const before = fs.readFileSync(indexPath, 'utf8');
    await completeFinalizationAssociation(f.dependenciesFor(), plan.archivePlan);
    expect(fs.readFileSync(indexPath, 'utf8')).toBe(before);
  }, 240_000);

  it('resumes an exact self-contained association intent and cleans only its proved carriers', async () => {
    const target = path.join(f.globalDataDir, 'atomic-association-carrier.json');
    const intended = '{"state":"finalized"}\n';
    const digest = createHash('sha256').update(intended, 'utf8').digest('hex');
    const exactIntent = path.join(
      path.dirname(target),
      `.${path.basename(target)}.rasen-write-${digest}.intent`
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{"state":"previous"}\n');
    fs.writeFileSync(exactIntent, intended);

    await atomicWorkspaceWriteText(target, intended);
    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(fs.existsSync(exactIntent)).toBe(false);
    expect(
      fs
        .readdirSync(path.dirname(target))
        .filter(name => name.startsWith(`.${path.basename(target)}.rasen-write-`))
    ).toEqual([]);

    const next = '{"state":"next"}\n';
    const nextDigest = createHash('sha256').update(next, 'utf8').digest('hex');
    const partialIntent = path.join(
      path.dirname(target),
      `.${path.basename(target)}.rasen-write-${nextDigest}.intent`
    );
    fs.writeFileSync(partialIntent, '{"state":');
    await expect(atomicWorkspaceWriteText(target, next)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });
    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(fs.readFileSync(partialIntent, 'utf8')).toBe('{"state":');
  });

  it('never falls back to self-contained recovery when journal carrier authority disagrees', async () => {
    const target = path.join(f.globalDataDir, 'journal-bound-association.json');
    const beforeBytes = '{"state":"before"}\n';
    const intended = '{"state":"finalized"}\n';
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, beforeBytes);
    const snapshot = await readAtomicWorkspaceSnapshot(target);
    let recorded: AtomicWorkspaceCarrierAuthority | undefined;

    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        onPrepared: prepared => {
          recorded = prepared;
          return Promise.reject(
            Object.assign(new Error('injected journal persistence failure'), {
              code: 'EIO',
            })
          );
        },
      })
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(recorded).toBeDefined();

    const carrierPrefix = `.${path.basename(target)}.rasen-write-`;
    const carrierBytesBefore = Object.fromEntries(
      fs
        .readdirSync(path.dirname(target))
        .filter(name => name.startsWith(carrierPrefix))
        .sort()
        .map(name => [name, fs.readFileSync(path.join(path.dirname(target), name), 'utf8')])
    );
    const wrongAuthority = {
      ...recorded!,
      contentDigest: '0'.repeat(64),
    };

    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        authority: wrongAuthority,
      })
    ).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(beforeBytes);
    expect(
      Object.fromEntries(
        fs
          .readdirSync(path.dirname(target))
          .filter(name => name.startsWith(carrierPrefix))
          .sort()
          .map(name => [name, fs.readFileSync(path.join(path.dirname(target), name), 'utf8')])
      )
    ).toEqual(carrierBytesBefore);
  });

  it('publishes a fresh carrier without treating its own directory entries as ancestry drift', async () => {
    const directory = path.join(f.globalDataDir, 'fresh-atomic-carrier');
    const target = path.join(directory, 'binding.json');
    const intended = '{"state":"fresh"}\n';

    await atomicWorkspaceWriteText(target, intended);

    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(
      fs
        .readdirSync(directory)
        .filter(name => name.startsWith(`.${path.basename(target)}.rasen-write-`))
    ).toEqual([]);
  });

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
