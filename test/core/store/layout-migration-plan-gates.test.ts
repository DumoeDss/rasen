/**
 * Task 5.9 — destinations, the blocked states, minted identity, and the apply
 * gate that has no `--force`.
 *
 * The unresolved states are covered by `layout-migration-provenance.test.ts`
 * and the module suite; this file owns the DESTINATION side: containment,
 * case-folded uniqueness, no-clobber, the Store-identity and dirty-source
 * blocks, identity minting and verification, and the one gate.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseChangeInstanceSeed,
  parseProjectId,
  parseTargetLineId,
  verifyChangeInstanceId,
} from '../../../src/core/index.js';
import {
  migrationItemDiagnosticCode,
  migrationItemStateLabel,
} from '../../../src/core/store/layout-migration/types.js';
import {
  stagePlan,
  verifyStagedTree,
} from '../../../src/core/store/layout-migration/apply.js';
import { productionStoreLayoutMigrationDependencies } from '../../../src/core/store/layout-migration/dependencies.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  targetLineMappingV2,
  MIGRATION_FIXTURE_STORE_UID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

/** Can this host hold `billing/` and `Billing/` as two directories? */
function caseSensitiveFilesystem(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-case-probe-'));
  try {
    fs.writeFileSync(path.join(probe, 'a'), '');
    return !fs.existsSync(path.join(probe, 'A'));
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

describe('store layout v2 migration — destinations, gates, and minted identity', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-gates-');
  });

  afterEach(() => {
    f.cleanup();
  });

  function labels(items: readonly { state: Parameters<typeof migrationItemStateLabel>[0] }[]): string[] {
    return items.map((item) => migrationItemStateLabel(item.state));
  }

  it('computes every destination inside the owning project partition', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.writeArchiveEntry('2026-07-01-old-thing');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia'], [
      'archive:',
      '  2026-07-01-old-thing:',
      '    project: elftia',
    ]));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const byName = new Map(plan.items.map((item) => [item.name, item]));

    expect(byName.get('billing')?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'specs', 'billing')
    );
    expect(byName.get('fix-a')?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'changes', 'fix-a')
    );
    // A legacy Archive entry keeps its directory name and lands under the
    // declared line; nothing is renamed into the v2 entry-name form.
    expect(byName.get('2026-07-01-old-thing')?.destination).toBe(
      f.at('rasen', 'projects', 'elftia', 'changes', 'archive', LINE, '2026-07-01-old-thing')
    );
    expect(plan.applicable).toBe(true);
  });

  it('blocks when a computed destination already exists, naming both paths', async () => {
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write('rasen/projects/elftia/specs/billing/spec.md', '# already here\n');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const spec = plan.items.find((item) => item.kind === 'spec');

    expect(migrationItemStateLabel(spec!.state)).toBe('blocked:destination-exists');
    expect(migrationItemDiagnosticCode(spec!)).toBe('migration_destination_conflict');
    expect(spec?.reason).toContain('rasen');
    expect(plan.applicable).toBe(false);
  });

  it('no-clobbers generated Issue roots at plan and apply time and retires only the legacy source', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');
    f.write(
      MAPPING,
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
      ])
    );
    f.write('rasen/issues/release-coordinator', 'a conflicting file\n');
    f.commitAll('plant generated destination conflict');

    const blocked = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const coordinator = blocked.items.find(item => item.name === 'release-coordinator');
    expect(migrationItemStateLabel(coordinator!.state)).toBe('blocked:destination-exists');
    expect(blocked.applicable).toBe(false);

    fs.rmSync(f.issueAt('release-coordinator'));
    f.commitAll('remove generated destination conflict');
    const applicable = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(applicable.applicable).toBe(true);
    expect(applicable.retirementSet).toContain('rasen/changes/release-coordinator');
    expect(applicable.retirementSet).not.toContain('rasen/issues/release-coordinator');

    f.write('rasen/issues/release-coordinator/foreign.txt', 'created after planning\n');
    await expect(f.migration().apply(applicable.token!)).rejects.toThrow(/now exists/iu);
    expect(f.readBytes('rasen/issues/release-coordinator/foreign.txt').toString('utf8')).toBe(
      'created after planning\n'
    );
    expect(f.readBytes('rasen/changes/release-coordinator/proposal.md').toString('utf8'))
      .toBe('# release-coordinator\n');
    expect(f.readBytes('.rasen-store/store.yaml').toString('utf8')).not.toContain(
      'layoutVersion: 2'
    );
  });

  it('verifies the exact generated inventory and reparses staged Issue bytes before publication', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');
    f.write(
      MAPPING,
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
      ])
    );
    f.commitAll('declare generated Issue');
    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const staged = await stagePlan(
      productionStoreLayoutMigrationDependencies,
      plan,
      undefined
    );
    const issueEntry = staged.entries.find(entry => entry.kind === 'issue-tree')!;
    fs.writeFileSync(path.join(issueEntry.staged, 'issue.yaml'), 'version: 1\nid: wrong\n', 'utf8');
    fs.writeFileSync(path.join(issueEntry.staged, 'unplanned.txt'), 'surprise\n', 'utf8');

    await expect(
      verifyStagedTree(productionStoreLayoutMigrationDependencies, plan, staged)
    ).rejects.toThrow(/wrong digest|was not planned|invalid/iu);
    expect(fs.existsSync(f.issueAt('release-coordinator'))).toBe(false);
  });

  // Two capabilities that fold onto one destination cannot even be CREATED on a
  // case-insensitive filesystem, so the collision is unconstructable on this
  // host and the check is unreachable from real files. `path.win32` destination
  // construction is covered separately in
  // `layout-migration-windows-paths.test.ts` (task 11.2).
  it.skipIf(!caseSensitiveFilesystem())(
    'blocks two capabilities that differ only in case rather than merging them',
    async () => {
      await f.member('elftia', { specs: ['billing', 'Billing'], changes: [] });
      f.write('rasen/specs/billing/spec.md', '# billing\n');
      f.write('rasen/specs/Billing/spec.md', '# Billing\n');
      f.write(MAPPING, targetLineMapping(LINE, ['elftia'], [
        'specs:',
        '  billing:',
        '    owner: elftia',
        '  Billing:',
        '    owner: elftia',
      ]));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

      // What must NOT happen is a clean plan that silently merges two
      // capabilities into one partition directory.
      expect(plan.applicable).toBe(false);
      expect(labels(plan.blockers).some((state) => state.startsWith('blocked:'))).toBe(true);
    }
  );

  it('blocks every Change needing an identity when the Store has no permanent uid', async () => {
    f.cleanup();
    f = await createLayoutMigrationFixture('rasen-layout-gates-v1-', {
      storeIdentity: 'legacy-v1',
    });
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const change = plan.items.find((item) => item.name === 'fix-a');

    expect(migrationItemStateLabel(change!.state)).toBe('blocked:store-identity-missing');
    expect(change?.repair).toContain('upgrade-identity');
    expect(plan.applicable).toBe(false);
    expect(plan.token).toBeUndefined();
  });

  it('mints one verifiable identity per relocated Change and records the old alias', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a', 'fix-b'] });
    f.writeChange('fix-a');
    f.writeChange('fix-b');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    expect(plan.mintedIdentities.map((entry) => entry.changeId)).toEqual(['fix-a', 'fix-b']);
    const seeds = new Set(plan.mintedIdentities.map((entry) => entry.instanceSeed));
    expect(seeds.size).toBe(2);
    for (const minted of plan.mintedIdentities) {
      expect(minted.minted).toBe(true);
      expect(minted.oldAlias).toBe(minted.changeId);
      // Re-derive independently: the plan's ids must be derivable from the
      // facts it recorded, not merely internally consistent strings.
      const planningScopeId = derivePlanningScopeId({
        storeUid: MIGRATION_FIXTURE_STORE_UID,
        projectId: parseProjectId('elftia'),
        targetLineId: parseTargetLineId(LINE),
      });
      expect(minted.planningScopeId).toBe(planningScopeId);
      expect(minted.changeInstanceId).toBe(
        deriveChangeInstanceId({
          planningScopeId,
          instanceSeed: parseChangeInstanceSeed(minted.instanceSeed),
        })
      );
      expect(
        verifyChangeInstanceId(minted.changeInstanceId, {
          planningScopeId,
          instanceSeed: minted.instanceSeed,
        })
      ).toBe(minted.changeInstanceId);
    }
  });

  it('verifies an existing v2 identity rather than re-minting it', async () => {
    const planningScopeId = derivePlanningScopeId({
      storeUid: MIGRATION_FIXTURE_STORE_UID,
      projectId: parseProjectId('elftia'),
      targetLineId: parseTargetLineId(LINE),
    });
    const instanceSeed = parseChangeInstanceSeed('ab'.repeat(16));
    const instanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a', {
      '.openspec.yaml': [
        'schema: spec-driven',
        'identity:',
        '  version: 2',
        `  instanceSeed: ${instanceSeed}`,
        `  instanceId: ${instanceId}`,
        `  storeUid: ${MIGRATION_FIXTURE_STORE_UID}`,
        '  projectId: elftia',
        `  targetLineId: ${LINE}`,
        '',
      ].join('\n'),
    });
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const minted = plan.mintedIdentities.find((entry) => entry.changeId === 'fix-a');

    expect(minted?.minted).toBe(false);
    expect(minted?.instanceSeed).toBe(String(instanceSeed));
    expect(minted?.changeInstanceId).toBe(instanceId);
  });

  it('reports untracked files inside a moved tree and requires --include-untracked', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();
    f.write('rasen/changes/fix-a/scratch.md', '# not committed\n');

    const refused = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const item = refused.items.find((candidate) => candidate.name === 'fix-a');
    expect(item?.untracked).toContain('rasen/changes/fix-a/scratch.md');
    expect(refused.applicable).toBe(false);

    const allowed = await f
      .migration()
      .plan(f.input({ mappingPath: MAPPING, includeUntracked: true }));
    expect(allowed.applicable).toBe(true);
    expect(allowed.includeUntracked).toBe(true);
  });

  it('unconditionally blocks every untracked, ignored, or linked byte below a generated source', async () => {
    await f.member('elftia');
    f.writeChange('release-coordinator');
    f.write(
      MAPPING,
      targetLineMappingV2(LINE, ['elftia'], [
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
      ])
    );
    f.ignore('rasen/changes/release-coordinator/ignored/');
    f.commitAll('declare generated source safety policy');
    f.writeUntracked('rasen/changes/release-coordinator/scratch.md', 'untracked\n');
    f.writeUntracked('rasen/changes/release-coordinator/ignored/secret.md', 'ignored\n');

    const outside = path.join(f.tempDir, 'outside-source.txt');
    fs.writeFileSync(outside, 'outside\n', 'utf8');
    let linkCreated = false;
    try {
      fs.symlinkSync(
        outside,
        f.at('rasen', 'changes', 'release-coordinator', 'outside-link'),
        'file'
      );
      linkCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') throw error;
    }

    const plan = await f.migration().plan(
      f.input({ mappingPath: MAPPING, includeUntracked: true })
    );
    const coordinator = plan.items.find(item => item.name === 'release-coordinator')!;
    expect(migrationItemStateLabel(coordinator.state)).toBe('blocked:dirty-source');
    expect(migrationItemDiagnosticCode(coordinator)).toBe('migration_source_unsafe');
    expect(coordinator.untracked).toContain('rasen/changes/release-coordinator/scratch.md');
    expect(coordinator.untracked?.some(entry => entry.includes('/ignored'))).toBe(true);
    if (linkCreated) {
      expect(coordinator.untracked).toContain(
        'rasen/changes/release-coordinator/outside-link'
      );
    }
    expect(coordinator.repair).toContain('--include-untracked cannot authorize data loss');
    expect(plan.applicable).toBe(false);
  });

  it('is one gate with no override: a single unresolved item refuses the whole plan and writes nothing', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.writeChange('mystery-change');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const before = snapshotDirectory(f.storeRoot);
    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    // `fix-a` is perfectly resolvable; there is no partial migration.
    expect(plan.items.find((item) => item.name === 'fix-a')?.owner).toBe('elftia');
    expect(plan.applicable).toBe(false);
    expect(plan.blockers.map((item) => item.name)).toEqual(['mystery-change']);
    expect(plan.token).toBeUndefined();
    expect(plan.retirementSet).toEqual([]);
    expect(snapshotDirectory(f.storeRoot)).toEqual(before);
  });

  it('names the mapping key that would resolve each blocker', async () => {
    await f.member('elftia');
    f.writeChange('mystery-change');
    f.writeArchiveEntry('2026-07-01-mystery');
    f.commitAll();

    const plan = await f.migration().plan(f.input({ defaultTargetLine: LINE }));
    const byName = new Map(plan.blockers.map((item) => [item.name, item]));

    expect(byName.get('mystery-change')?.repair).toContain('changes.mystery-change.project');
    expect(byName.get('2026-07-01-mystery')?.repair).toContain(
      'archive.2026-07-01-mystery.project'
    );
  });

  it('records the retirement set only for an applicable plan', async () => {
    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    expect(plan.applicable).toBe(true);
    // Both flat roots plus every relocated source, so a resumed retirement can
    // remove exactly what the plan moved.
    expect([...plan.retirementSet].sort()).toEqual([
      'rasen/changes',
      'rasen/changes/fix-a',
      'rasen/specs',
      'rasen/specs/billing',
    ]);
    // Retained design docs are never in the retirement set.
    expect(plan.retirementSet).not.toContain('rasen/design-docs');
  });

  it('stores the plan in the machine root, never inside either Git repository', async () => {
    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const before = snapshotDirectory(f.storeRoot);
    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

    expect(plan.token).toBeDefined();
    expect(snapshotDirectory(f.storeRoot)).toEqual(before);
    const machineFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else machineFiles.push(target);
      }
    };
    walk(path.join(f.globalDataDir, 'store-layout-migration'));
    expect(machineFiles.some((file) => file.includes(plan.planId))).toBe(true);
  });
});
