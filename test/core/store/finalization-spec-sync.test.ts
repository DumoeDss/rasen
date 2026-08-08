/**
 * `store-finalization-outcomes-v2` tasks 6.7 and 6.8 — landed-only spec
 * synchronization.
 *
 * The invariant the whole portfolio exists to protect is that ONLY `landed`
 * may change a canonical spec. Two halves are asserted here:
 *
 * - the digest mapping and its precondition blocks, which make the recorded
 *   `specSync` describe exactly what the transaction did rather than an
 *   independently constructed claim;
 * - the BYTE-IDENTITY gate: a Change carrying real ADDED / MODIFIED / REMOVED
 *   deltas is finalized as `abandoned` and as `superseded`, and every file
 *   under the project partition's `specs/` is hashed before and after. "No diff
 *   was reported" is not the same claim as "byte-identical", and only the
 *   second one is worth making.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveSpecActionFor,
  archiveSpecActionsFor,
  type ChangeFinalizationError,
} from '../../../src/core/store/finalization/index.js';
import type { PreparedArchiveSpecAction } from '../../../src/core/archive-engine.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  prepareSpecActions,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../../helpers/store-finalization-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

function action(
  overrides: Partial<PreparedArchiveSpecAction> = {}
): PreparedArchiveSpecAction {
  return {
    capability: 'alpha',
    action: 'update',
    source: '/change/specs/alpha/spec.md',
    target: '/store/specs/alpha/spec.md',
    sourceSha256: digest('source'),
    targetPrecondition: { state: 'file', sha256: digest('before') },
    rebuilt: 'after',
    counts: { added: 0, modified: 1, removed: 0, renamed: 0 },
    ...overrides,
  } as PreparedArchiveSpecAction;
}

describe('the digest mapping table', () => {
  it('maps create to (null, sha256(rebuilt))', () => {
    expect(
      archiveSpecActionFor(
        action({
          action: 'create',
          targetPrecondition: { state: 'absent' },
          rebuilt: 'created body',
        })
      )
    ).toEqual({
      action: 'create',
      capabilityId: 'alpha',
      beforeSha256: null,
      afterSha256: digest('created body'),
    });
  });

  it('maps update to (precondition digest, sha256(rebuilt))', () => {
    expect(archiveSpecActionFor(action())).toEqual({
      action: 'update',
      capabilityId: 'alpha',
      // The BEFORE is the precondition the engine will revalidate, so the
      // record and the transaction cannot disagree about what was overwritten.
      beforeSha256: digest('before'),
      afterSha256: digest('after'),
    });
  });

  it('maps delete to (precondition digest, null)', () => {
    expect(archiveSpecActionFor(action({ action: 'delete' }))).toEqual({
      action: 'delete',
      capabilityId: 'alpha',
      beforeSha256: digest('before'),
      afterSha256: null,
    });
  });

  it('maps a whole list in order', () => {
    expect(
      archiveSpecActionsFor([
        action({ capability: 'alpha' }),
        action({ capability: 'beta', action: 'delete' }),
      ]).map(entry => [entry.action, entry.capabilityId])
    ).toEqual([
      ['update', 'alpha'],
      ['delete', 'beta'],
    ]);
  });
});

describe('the precondition blocks', () => {
  it('blocks a create whose target is not absent', () => {
    let thrown: unknown;
    try {
      archiveSpecActionFor(action({ action: 'create' }));
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_record_invalid');
    expect((thrown as ChangeFinalizationError).expected).toBe(
      "target precondition 'absent'"
    );
  });

  it.each(['update', 'delete'] as const)(
    'blocks a %s whose target precondition is absent',
    verb => {
      let thrown: unknown;
      try {
        archiveSpecActionFor(action({ action: verb, targetPrecondition: { state: 'absent' } }));
      } catch (error) {
        thrown = error;
      }
      expect(codeOf(thrown)).toBe('finalization_record_invalid');
      expect((thrown as ChangeFinalizationError).expected).toBe(
        "target precondition 'file'"
      );
    }
  );

  it('refuses a capability that is not a canonical capability id', () => {
    let thrown: unknown;
    try {
      archiveSpecActionFor(action({ capability: 'Not A Capability' }));
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_record_invalid');
    expect((thrown as ChangeFinalizationError).actual).toBe('Not A Capability');
  });
});

describe('a real finalization against real delta specs', () => {
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

  /** The project partition's canonical specs inside a planning worktree. */
  function specsDir(planningWorktree: string): string {
    return path.join(planningWorktree, 'rasen', 'projects', PROJECT, 'specs');
  }

  /**
   * Seeds a Change carrying one ADDED (create), one MODIFIED (update), and one
   * REMOVED (delete) capability delta, against canonical specs that already
   * exist for the latter two.
   */
  function seedDeltas(bound: BoundChange): void {
    const canonical = specsDir(bound.planningWorktree);
    f.write(
      path.join(canonical, 'alpha', 'spec.md'),
      [
        '# alpha Specification',
        '',
        '## Purpose',
        'Alpha purpose.',
        '',
        '## Requirements',
        '',
        '### Requirement: Important Rule',
        'Some details.',
        '',
        '#### Scenario: Original',
        '- **WHEN** something happens',
        '- **THEN** the rule applies',
        '',
      ].join('\n')
    );
    f.write(
      path.join(canonical, 'gamma', 'spec.md'),
      [
        '# gamma Specification',
        '',
        '## Purpose',
        'Gamma purpose.',
        '',
        '## Requirements',
        '',
        '### Requirement: Retired Rule',
        'Going away.',
        '',
        '#### Scenario: Retired',
        '- **WHEN** the change lands',
        '- **THEN** the rule is gone',
        '',
      ].join('\n')
    );

    f.write(
      path.join(bound.changeDir, 'specs', 'alpha', 'spec.md'),
      [
        '# alpha - Changes',
        '',
        '## MODIFIED Requirements',
        '',
        '### Requirement: Important Rule',
        'Updated details.',
        '',
        '#### Scenario: Original',
        '- **WHEN** something happens',
        '- **THEN** the updated rule applies',
        '',
      ].join('\n')
    );
    f.write(
      path.join(bound.changeDir, 'specs', 'beta', 'spec.md'),
      [
        '# beta - Changes',
        '',
        '## ADDED Requirements',
        '',
        '### Requirement: Brand New Rule',
        'The system SHALL do the new thing.',
        '',
        '#### Scenario: New',
        '- **WHEN** the new thing is requested',
        '- **THEN** it happens',
        '',
      ].join('\n')
    );
    f.write(
      path.join(bound.changeDir, 'specs', 'gamma', 'spec.md'),
      [
        '# gamma - Changes',
        '',
        '## REMOVED Requirements',
        '',
        '### Requirement: Retired Rule',
        '',
        '**Reason**: superseded by alpha.',
        '',
      ].join('\n')
    );
  }

  it('applies exactly the prepared actions for a landed outcome, and records their digests', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'landing-change',
    });
    seedDeltas(bound);
    const canonical = specsDir(bound.planningWorktree);
    const actions = await prepareSpecActions(bound.changeDir, canonical, bound.changeId);
    expect(actions.map(entry => [entry.capability, entry.action]).sort()).toEqual([
      ['alpha', 'update'],
      ['beta', 'create'],
      ['gamma', 'delete'],
    ]);

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

    expect(plan.outcome).toBe('landed');
    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    // The record's actions come from the SAME prepared actions the engine will
    // apply — one list, not two.
    const record = plan.recordDraft as unknown as {
      specSync: { applied: boolean; actions: Array<Record<string, unknown>> };
    };
    expect(record.specSync.applied).toBe(true);
    expect(record.specSync.actions.map(entry => [entry.action, entry.capabilityId])).toEqual([
      ['update', 'alpha'],
      ['create', 'beta'],
      ['delete', 'gamma'],
    ]);
    for (const [index, entry] of record.specSync.actions.entries()) {
      const prepared = actions[index] as PreparedArchiveSpecAction;
      expect(entry.afterSha256).toBe(
        prepared.action === 'delete' ? null : digest(prepared.rebuilt)
      );
      expect(entry.beforeSha256).toBe(
        prepared.targetPrecondition.state === 'absent'
          ? null
          : prepared.targetPrecondition.sha256
      );
    }

    const result = await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
    expect(result.status, JSON.stringify(result.blockers)).toBe('complete');
    expect(result.specSyncApplied).toBe(true);
    expect(result.specSyncActionCount).toBe(3);
    expect(fs.readFileSync(path.join(canonical, 'alpha', 'spec.md'), 'utf8')).toContain(
      'Updated details.'
    );
    expect(fs.existsSync(path.join(canonical, 'beta', 'spec.md'))).toBe(true);
    // A landed delete removes the capability DIRECTORY, not just its file.
    expect(fs.existsSync(path.join(canonical, 'gamma'))).toBe(false);
  }, 180_000);

  it.each(['abandoned', 'superseded'] as const)(
    'leaves every canonical spec byte-identical for a %s outcome',
    async outcome => {
      // The successor is resolved by reading COMMITTED metadata as a Git blob
      // on the Store's target-line ref, so it has to be committed there — an
      // uncommitted directory is not a successor.
      const successor = f.seedChange({
        root: f.storeRoot,
        projectId: PROJECT,
        targetLineId: LINE,
        changeId: 'successor-change',
        instanceSeed: 'b'.repeat(32),
      });
      f.git(f.storeRoot, ['add', '.']);
      f.git(f.storeRoot, ['commit', '-m', 'seed the successor Change']);
      f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

      const bound = await f.bind({
        projectId: PROJECT,
        targetLineId: LINE,
        changeId: 'passive-change',
      });
      seedDeltas(bound);
      const canonical = specsDir(bound.planningWorktree);
      const actions = await prepareSpecActions(bound.changeDir, canonical, bound.changeId);
      expect(actions.length).toBe(3);

      // Content hashes, computed from bytes, not an mtime comparison and not a
      // "git reported no diff" claim.
      const before = hashTree(canonical);
      expect(Object.keys(before).sort()).toEqual([
        'alpha/spec.md',
        'gamma/spec.md',
      ]);

      const plan = await f.finalization().plan(
        f.planInput(
          bound,
          outcome === 'superseded'
            ? {
                outcome,
                reason: 'The work moved to the successor.',
                by: successor.instanceId,
              }
            : { outcome, reason: 'The approach was dropped.' },
          {
            archive: f.preparation(bound, {
              // The candidates ARE supplied. A passive plan variant has no
              // field that can carry them, so they must go nowhere.
              specActionCandidates: actions,
              hasDeltaSpecs: true,
            }),
          }
        )
      );

      expect(plan.outcome).toBe(outcome);
      expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
      expect('specActions' in plan).toBe(false);
      expect(plan.archivePlan.specActions).toEqual([]);
      expect(
        (plan.recordDraft as unknown as { specSync: unknown }).specSync
      ).toEqual({ applied: false, actions: [] });

      const result = await f.finalization().applyStoredPlan(plan.archivePlan, plan.token);
      expect(result.status, JSON.stringify(result.blockers)).toBe('complete');
      expect(result.specSyncApplied).toBe(false);
      expect(result.specSyncActionCount).toBe(0);

      const after = hashTree(canonical);
      expect(after).toEqual(before);
    },
    240_000
  );

  it('records applied:true with an empty action list for a landed Change with no deltas', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'no-delta-change',
    });

    const plan = await f.finalization().plan(
      f.planInput(bound, {
        outcome: 'landed',
        commit: f.refOid(bound.executionWorktree, 'HEAD'),
      })
    );

    expect(plan.applicable, JSON.stringify(plan.blockers)).toBe(true);
    expect(
      (plan.recordDraft as unknown as { specSync: unknown }).specSync
    ).toEqual({ applied: true, actions: [] });
  }, 180_000);

  it('refuses --skip-specs on a landed Change that carries deltas', async () => {
    const bound = await f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'skip-conflict-change',
    });
    seedDeltas(bound);
    const canonical = specsDir(bound.planningWorktree);
    const actions = await prepareSpecActions(bound.changeDir, canonical, bound.changeId);
    const before = hashTree(canonical);

    let thrown: unknown;
    try {
      await f.finalization().plan(
        f.planInput(
          bound,
          { outcome: 'landed', commit: f.refOid(bound.executionWorktree, 'HEAD') },
          {
            skipSpecs: true,
            archive: f.preparation(bound, {
              specActionCandidates: actions,
              hasDeltaSpecs: true,
            }),
          }
        )
      );
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('finalization_spec_skip_conflict');
    expect(hashTree(canonical)).toEqual(before);
  }, 180_000);
});
