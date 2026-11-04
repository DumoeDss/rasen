/**
 * Task 10.5 — the migration diagnostics, through `doctorStores` rather than the
 * diagnostic module directly.
 *
 * Diagnosis is the only thing that catches a layout a manual Git merge produced,
 * so the two properties that matter are: every state has a code with a repair
 * command, and diagnosing modifies nothing — not the Store, not the machine
 * data directory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assertStoreLayoutForWrite,
  readStoreLayoutState,
} from '../../../src/core/store/layout-write-guard.js';
import {
  listStoreMembers,
  resolveProjectMembership,
} from '../../../src/core/store/membership.js';
import { migrateStoreMembership } from '../../../src/core/store/migration-ops.js';
import { doctorStores } from '../../../src/core/store/operations.js';
import { productionStoreLayoutMigrationDependencies } from '../../../src/core/store/layout-migration/index.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  MIGRATION_FIXTURE_STORE_ID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

describe('store layout v2 migration — doctor diagnostics', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-doctor-');
  });

  afterEach(() => {
    f.cleanup();
  });

  async function codes(): Promise<string[]> {
    const result = await doctorStores(MIGRATION_FIXTURE_STORE_ID);
    return result.diagnostics.map((entry) => entry.code);
  }

  async function findings(): Promise<
    Array<{ code: string; severity: string; message: string; fix?: string }>
  > {
    const result = await doctorStores(MIGRATION_FIXTURE_STORE_ID);
    return result.diagnostics.map((entry) => ({
      code: entry.code,
      severity: entry.severity,
      message: entry.message,
      ...(entry.fix === undefined ? {} : { fix: entry.fix }),
    }));
  }

  it('reports a flat ref, naming the ref and the command that migrates it', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.commitAll();

    const reported = await findings();
    const flat = reported.find((entry) => entry.code === 'store_layout_flat_requires_migration');

    expect(flat).toBeDefined();
    expect(flat?.message).toContain('refs/heads/main');
    expect(flat?.fix).toContain(`rasen store migrate-layout ${MIGRATION_FIXTURE_STORE_ID}`);
  });

  it('reports unresolved ownership and an unresolved shared spec separately', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    await f.member('scene-bridge', { specs: [], changes: ['fix-b'] });
    f.writeSpec('telemetry');
    f.writeChange('fix-a', { 'specs/telemetry/spec.md': '# delta\n' });
    f.writeChange('fix-b', { 'specs/telemetry/spec.md': '# delta\n' });
    f.writeChange('mystery-change');
    f.commitAll();

    const reported = await codes();

    expect(reported).toContain('store_layout_unresolved_ownership');
    expect(reported).toContain('store_layout_shared_spec_unresolved');
  });

  it('reports retained Store-level design docs as standing classification debt', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.write('rasen/design-docs/cross-cutting.md', '# doc\n');
    f.commitAll();

    const reported = await findings();
    const doc = reported.find((entry) => entry.code === 'store_layout_design_doc_unclassified');

    expect(doc).toBeDefined();
    expect(doc?.message).toContain('cross-cutting.md');
  });

  it('reports mixed residue when a v2 declaration still holds flat content', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write(
      '.rasen-store/store.yaml',
      `version: 2\nuid: 11111111-2222-4333-8444-555555555555\nid: ${MIGRATION_FIXTURE_STORE_ID}\nlayoutVersion: 2\n`
    );
    f.commitAll();

    const reported = await findings();
    const mixed = reported.find((entry) => entry.code === 'store_layout_mixed_residue');

    expect(mixed).toBeDefined();
    expect(mixed?.fix).toContain('migrate-layout');
    // A v2 declaration also makes any surviving v1 membership record a finding.
    expect(await codes()).toContain('store_layout_legacy_membership_record');
  });

  it('reports a partition with no catalog as an orphan', async () => {
    f.write(
      '.rasen-store/store.yaml',
      `version: 2\nuid: 11111111-2222-4333-8444-555555555555\nid: ${MIGRATION_FIXTURE_STORE_ID}\nlayoutVersion: 2\n`
    );
    f.write('rasen/projects/ghost/specs/billing/spec.md', '# billing\n');
    f.commitAll();

    expect(await codes()).toContain('store_layout_partition_orphan');
  });

  it('reports a relocated legacy Archive record after a real migration', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.writeArchiveEntry('2026-07-01-old-thing');
    f.write(
      MAPPING,
      targetLineMapping(LINE, ['elftia'], [
        'archive:',
        '  2026-07-01-old-thing:',
        '    project: elftia',
      ])
    );
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);
    await f.migration().recover(f.input({ action: 'retire-flat' }));

    const reported = await findings();
    const legacy = reported.find((entry) => entry.code === 'store_layout_legacy_archive_record');
    expect(legacy).toBeDefined();
    // Informational: the entry really is in the partition, under its original
    // directory name, with an un-upgraded record.
    expect(
      fs.existsSync(
        f.at('rasen', 'projects', 'elftia', 'changes', 'archive', LINE, '2026-07-01-old-thing')
      )
    ).toBe(true);

    // A `.find(...).toBeDefined()` cannot see what is sitting BESIDE the code
    // it looks for. Two spurious `invalid_store_project_record` errors — doctor
    // telling the operator to delete the catalog the migration had just
    // written — lived here undetected because nothing asserted the absence of
    // an unexpected error. A clean migration produces no error-severity
    // finding at all.
    expect(reported.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('reports the migrated Store roster through the same reader every consumer uses', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.writeSpec('billing');
    f.write(
      MAPPING,
      targetLineMapping(LINE, ['elftia'], ['specs:', '  billing:', '    owner: elftia'])
    );
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);
    await f.migration().recover(f.input({ action: 'retire-flat' }));

    // `listStoreMembers` is what `store doctor`, the management API's space
    // listing and session-launch membership check, learned-skill authority and
    // bootstrap all consume. Against the Store THIS migration just produced it
    // must answer with the project catalogs, not with silence.
    const listing = await listStoreMembers(
      { type: 'store', id: MIGRATION_FIXTURE_STORE_ID, root: f.storeRoot },
      { globalDataDir: f.globalDataDir }
    );
    expect(listing.members.map((member) => member.projectId)).toEqual(['elftia']);
    expect(listing.members[0]?.provenance).toBe('project-catalog');
    expect(listing.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(
      await resolveProjectMembership(
        { type: 'store', id: MIGRATION_FIXTURE_STORE_ID, root: f.storeRoot },
        'elftia',
        { globalDataDir: f.globalDataDir }
      )
    ).not.toBeNull();
  });

  it('never tells the operator to delete a healthy catalog, on any command surface', async () => {
    // R2-2. H1 fixed `listStoreMembers`; the OTHER v1-only read in
    // `migrateStoreMembership` was left, and its parse diagnostics are passed
    // straight through to the operator — so `store migrate-membership` against a
    // Store this migration had just produced still answered
    // `error: invalid_store_project_record — Repair or remove <catalog>`.
    // Following that deletes the ownership record and orphans the partition.
    await f.member('elftia', { specs: [], changes: [] });
    f.writeSpec('billing');
    f.write(
      MAPPING,
      targetLineMapping(LINE, ['elftia'], ['specs:', '  billing:', '    owner: elftia'])
    );
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);
    await f.migration().recover(f.input({ action: 'retire-flat' }));

    const catalogPath = f.at('.rasen-store', 'projects', 'elftia.yaml');
    const before = fs.readFileSync(catalogPath, 'utf8');

    const result = await migrateStoreMembership({
      storeId: MIGRATION_FIXTURE_STORE_ID,
      apply: true,
      globalDataDir: f.globalDataDir,
    });

    // Nothing converted, nothing written, and — the finding — nothing telling
    // the operator to remove the file the migration just wrote.
    expect(result.converted).toEqual([]);
    expect(result.storeWrites).toEqual([]);
    expect(result.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    const advice = result.diagnostics.map((entry) => `${entry.message} ${entry.fix ?? ''}`).join('\n');
    expect(advice).not.toContain('Repair or remove');
    expect(advice).not.toContain('invalid_store_project_record');
    expect(fs.readFileSync(catalogPath, 'utf8')).toBe(before);

    // And it says why there is nothing to do, rather than saying nothing.
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'store_layout_membership_already_migrated'
    );
  });

  it('treats a flat tree re-introduced after retirement as mixed, and refuses writes', async () => {
    // D13's whole reason to exist: Git can bypass Rasen. A branch that still
    // carried flat planning content merges CLEANLY once retirement removed
    // those paths, so this is the state a real merge produces.
    await f.member('elftia', { specs: [], changes: [] });
    f.writeSpec('billing');
    f.write(
      MAPPING,
      targetLineMapping(LINE, ['elftia'], ['specs:', '  billing:', '    owner: elftia'])
    );
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);
    await f.migration().recover(f.input({ action: 'retire-flat' }));
    f.commitAll('publish and retire');
    expect(fs.existsSync(f.at('rasen', 'specs'))).toBe(false);

    // The merge.
    f.writeSpec('telemetry');
    f.write('rasen/changes/legacy-work/proposal.md', '# legacy-work\n');
    f.commitAll('merge a branch that still carried the flat tree');

    const state = await readStoreLayoutState(f.storeRoot);
    expect(state.retirementRecorded).toBe(true);
    expect(state.mixed).toBe(true);

    const mixed = (await findings()).find(
      (entry) => entry.code === 'store_layout_mixed_residue'
    );
    expect(mixed?.severity).toBe('error');
    // Counting receipts instead of reading their PHASE said "retirement is a
    // separate step and has not run yet" two commits after it ran, and offered
    // `--retire-flat`, which deletes only what the original plan's retirement
    // set names.
    expect(mixed?.message).not.toContain('has not run yet');
    expect(mixed?.fix).not.toContain('--retire-flat');

    // D12: a mixed Store refuses both layouts and points at recovery.
    await expect(
      assertStoreLayoutForWrite({
        storeRoot: f.storeRoot,
        storeId: MIGRATION_FIXTURE_STORE_ID,
        intent: 'store-adopt',
        writes: 'partition',
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'store_layout_mixed_residue' } });
  });

  it('reports an interrupted run after a real mid-publication failure', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);

    // Fail the layout flip, so the run is recorded as failed with the
    // partition already renamed into place: the half-migrated state doctor
    // exists to surface.
    const base = productionStoreLayoutMigrationDependencies;
    const failing = f.migration({
      fs: {
        ...base.fs,
        async writeText(target: string, content: string): Promise<void> {
          if (target.endsWith(path.join('.rasen-store', 'store.yaml'))) {
            throw new Error('injected write failure');
          }
          await base.fs.writeText(target, content);
        },
      },
    });
    await expect(failing.apply(plan.token!)).rejects.toThrow(/injected write failure/u);

    const reported = await findings();
    const incomplete = reported.find(
      (entry) => entry.code === 'store_layout_migration_incomplete'
    );
    expect(incomplete).toBeDefined();
    expect(incomplete?.message).toContain("'failed'");
    expect(incomplete?.message).toContain('injected write failure');
    // Both recovery routes are named, because either is legitimate here.
    expect(incomplete?.fix).toContain('--resume');
    expect(incomplete?.fix).toContain('--rollback');
  });

  it('diagnoses without modifying the Store or the machine data directory', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.write('rasen/design-docs/cross-cutting.md', '# doc\n');
    f.commitAll();

    const storeBefore = snapshotDirectory(f.storeRoot);
    const machineBefore = snapshotDirectory(f.globalDataDir);

    const reported = await codes();
    expect(reported.length).toBeGreaterThan(0);

    expect(snapshotDirectory(f.storeRoot)).toEqual(storeBefore);
    expect(snapshotDirectory(f.globalDataDir)).toEqual(machineBefore);
    // Specifically: no plan, no staging directory, no manifest.
    expect(fs.existsSync(f.at('.rasen', 'migration', 'staging'))).toBe(false);
  });

  it('gives every finding a code and a repair, so none is a dead end', async () => {
    await f.member('elftia', { specs: [], changes: [] });
    f.writeSpec('telemetry');
    f.writeChange('mystery-change');
    f.write('rasen/design-docs/cross-cutting.md', '# doc\n');
    f.commitAll();

    for (const finding of await findings()) {
      expect(finding.code, JSON.stringify(finding)).toMatch(/^[a-z0-9_]+$/u);
      expect(finding.message.length, finding.code).toBeGreaterThan(0);
      expect(finding.fix, finding.code).toBeTruthy();
    }
  });
});
