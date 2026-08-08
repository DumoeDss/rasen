/**
 * Task 2.7 — the per-ref inventory.
 *
 * `layout-migration-module.test.ts` already proves totality against a damaged
 * Store and the multi-ref survey. What is proved here is everything else the
 * inventory contract promises: a Store with no flat content, a mixed-layout
 * ref, a ref whose Store metadata is an unreadable blob, remote-tracking refs
 * excluded from candidacy with a stated reason, the fingerprint's sensitivity
 * to content, and zero writes across all of it — including the machine root,
 * which is where a plan would otherwise land.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import {
  createLayoutMigrationFixture,
  MIGRATION_FIXTURE_STORE_ID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

describe('store layout v2 migration — inventory', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-inventory-');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('reports an empty flat Store as empty rather than failing', async () => {
    f.commitAll();

    const inventory = await f.migration().inventory(f.input());

    expect(inventory.storeId).toBe(MIGRATION_FIXTURE_STORE_ID);
    expect(inventory.specs).toEqual([]);
    expect(inventory.changes).toEqual([]);
    expect(inventory.archiveEntries).toEqual([]);
    expect(inventory.designDocs).toEqual([]);
    expect(inventory.membershipRecords).toEqual([]);
    expect(inventory.hasAdoptionsManifest).toBe(false);
    expect(inventory.failures).toEqual([]);
    expect(inventory.declaredLayoutVersion).toBeUndefined();
    expect(inventory.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('enumerates every flat collection, including archive entries and design docs', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    f.writeSpec('billing');
    f.writeSpec('telemetry');
    f.writeChange('fix-a');
    f.writeArchiveEntry('2026-07-01-old-thing');
    f.write('rasen/design-docs/cross-cutting.md', '# doc\n');
    f.write('.rasen-store/adoptions.yaml', 'version: 1\nadoptions: {}\n');
    f.commitAll();

    const inventory = await f.migration().inventory(f.input());

    expect(inventory.specs).toEqual(['billing', 'telemetry']);
    expect(inventory.changes).toEqual(['fix-a']);
    expect(inventory.archiveEntries).toEqual(['2026-07-01-old-thing']);
    expect(inventory.designDocs).toEqual(['cross-cutting.md']);
    expect(inventory.membershipRecords).toEqual(['elftia.yaml']);
    expect(inventory.hasAdoptionsManifest).toBe(true);
    // The archive directory is not itself an active Change.
    expect(inventory.changes).not.toContain('archive');
  });

  it('classifies another ref whose Store metadata blob is unparsable as unreadable, without aborting', async () => {
    f.writeSpec('billing');
    f.commitAll();
    // The survey reads `.rasen-store/store.yaml` at each ref as a BLOB, so a
    // sibling branch can carry metadata this Store's own readers would reject.
    f.git('checkout', '-q', '-b', 'broken');
    f.write('.rasen-store/store.yaml', 'version: [not, a, store]\n');
    f.commitAll('break the metadata on a sibling ref');
    f.git('checkout', '-q', 'main');

    const inventory = await f.migration().inventory(f.input());

    expect(inventory.refs.find((ref) => ref.ref === 'refs/heads/broken')?.classification).toBe(
      'unreadable'
    );
    // Totality: one unreadable ref never aborts the scan.
    expect(inventory.refs.find((ref) => ref.checkedOut)?.classification).toBe('flat');
    expect(inventory.specs).toEqual(['billing']);
  });

  it('classifies a layout v2 ref still holding flat content as mixed at plan time', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write(
      '.rasen-store/store.yaml',
      `version: 2\nuid: 11111111-2222-4333-8444-555555555555\nid: ${MIGRATION_FIXTURE_STORE_ID}\nlayoutVersion: 2\n`
    );
    f.commitAll();

    const inventory = await f.migration().inventory(f.input());
    expect(inventory.declaredLayoutVersion).toBe(2);
    expect(inventory.refs.find((ref) => ref.checkedOut)?.classification).toBe('layout-v2');

    // A v2 ref that still holds flat content with no receipt is the half-migrated
    // state; the flat items carry it so the operator sees which content is stuck.
    const plan = await f.migration().plan(f.input({ defaultTargetLine: 'line-0.2' }));
    const spec = plan.items.find((item) => item.kind === 'spec');
    expect(spec?.state).toEqual({ kind: 'blocked', reason: 'mixed-layout' });
    expect(plan.applicable).toBe(false);
  });

  it('surveys remote-tracking refs and states why they are not candidates', async () => {
    f.writeSpec('billing');
    f.commitAll();
    // A remote-tracking ref without a network: write the ref directly.
    const head = f.git('rev-parse', 'HEAD').trim();
    const remoteRef = f.at('.git', 'refs', 'remotes', 'origin', 'main');
    fs.mkdirSync(path.dirname(remoteRef), { recursive: true });
    fs.writeFileSync(remoteRef, `${head}\n`, 'utf8');

    const inventory = await f.migration().inventory(f.input());
    const remote = inventory.refs.find((ref) => ref.ref === 'refs/remotes/origin/main');

    expect(remote?.kind).toBe('remote-tracking');
    expect(remote?.checkedOut).toBe(false);
    expect(remote?.notCandidateReason).toBeTruthy();
    expect(remote?.migrateFrom).toBeUndefined();
  });

  it('changes the fingerprint when flat content changes, and writes nothing anywhere', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing', '# billing\n');
    f.commitAll();

    const storeBefore = snapshotDirectory(f.storeRoot);
    const machineBefore = snapshotDirectory(f.globalDataDir);

    const first = await f.migration().inventory(f.input());
    const repeat = await f.migration().inventory(f.input());
    expect(repeat.fingerprint).toBe(first.fingerprint);

    // Zero writes: not into the Store, and not into the machine root either —
    // inventory is read-only, so no plan or manifest may appear.
    expect(snapshotDirectory(f.storeRoot)).toEqual(storeBefore);
    expect(snapshotDirectory(f.globalDataDir)).toEqual(machineBefore);

    f.writeSpec('billing', '# billing, revised\n');
    f.commitAll('revise');
    const changed = await f.migration().inventory(f.input());
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it('refuses to inventory from outside the Store worktree rather than guessing a ref', async () => {
    f.commitAll();
    const outside = path.join(f.tempDir, 'elsewhere');
    fs.mkdirSync(outside, { recursive: true });

    await expect(
      f.migration().plan(f.input({ startPath: outside }))
    ).rejects.toMatchObject({
      diagnostic: { code: 'migration_not_checked_out' },
    });
  });
});
