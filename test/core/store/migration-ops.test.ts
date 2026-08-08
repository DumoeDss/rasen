import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  adoptProject,
  ejectProject,
  relocateArchive,
  homePrune,
  diagnoseMigrationDrift,
  clearProjectOwnership,
  migrateStoreMembership,
  UNASSIGNED_PROJECT_ID,
} from '../../../src/core/store/migration-ops.js';
import {
  acquireOwnerAwareFileLock,
  machineLockPath,
  releaseOwnerAwareFileLock,
} from '../../../src/core/file-state.js';
import {
  getStoreProjectRecordPath,
  readStoreProjectRecord,
  writeStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { writeMembershipRecord } from '../../../src/core/store/membership.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { readStoreMembership } from '../../../src/core/store/membership-layout.js';
import {
  ensureProjectIdInConfig,
  readStorePointer,
  readProjectConfig,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import {
  moveTreeVerified,
  upsertAdoptionEntry,
} from '../../../src/core/store/migration.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';

/** Writes an active change with one file under rasen/changes/<name>. */
function writeChange(root: string, name: string, body = 'x\n'): void {
  const dir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), body);
}

/** Writes an archived change dir under rasen/changes/archive/<name>. */
function writeArchived(root: string, name: string): void {
  const dir = path.join(root, 'rasen', 'changes', 'archive', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), 'archived\n');
}

function ls(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

describe('store migration ops', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migration-ops-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    // RASEN_HOME (if set on the dev machine) wins over XDG_DATA_HOME and would
    // point every in-process registry write at the real machine data dir.
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeSource(name = 'my-app'): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    writeSpec(root, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeChange(root, 'add-thing');
    return root;
  }

  const TARGET_LINE = 'line-0.2';

  /**
   * Declares planning layout v2 on the fixture store, and gives it the one
   * target-line catalog `--archive move` requires there.
   *
   * `layoutVersion` is optional on BOTH metadata schema versions
   * (`StoreMetadataStateV1`/`V2` in `foundation.ts`) and the migration flips it
   * by spreading whatever metadata it found (`layout-migration/apply.ts`), so a
   * store that predates permanent identities and declares layout v2 is a state
   * the migration really produces — and keeping `version: 1` here preserves the
   * "no identity to record" property the adopt-pointer case asserts.
   *
   * Opt-in per test rather than in `beforeEach`: eject, `archive relocate --to
   * in-repo`, membership migration and the drift diagnostics all still run
   * against a LEGACY FLAT store, and the cases below that cover them have to
   * keep meeting one.
   */
  async function declareLayoutV2(): Promise<void> {
    await writeStoreMetadataState(storeRoot, {
      version: 1,
      id: 'team-store',
      layoutVersion: 2,
    });
    const lines = path.join(storeRoot, '.rasen-store', 'target-lines');
    fs.mkdirSync(lines, { recursive: true });
    fs.writeFileSync(
      path.join(lines, `${TARGET_LINE}.yaml`),
      `version: 1\nid: ${TARGET_LINE}\nstoreRef: refs/heads/main\nprojects: {}\n`
    );
  }

  /**
   * A project's layout v2 partition address, spelled out rather than computed
   * through the production layout contract: a destination assertion that asks
   * the code under test where it put something proves nothing.
   */
  function partition(projectId: string, ...segments: string[]): string {
    return path.join(storeRoot, 'rasen', 'projects', projectId, ...segments);
  }

  it('adopts an in-repo project into the store and converts it to a pointer', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    expect(result.specs).toEqual(['billing']);
    expect(result.changes).toEqual(['add-thing']);
    // Content moved into the project's PARTITION, removed from source (spec
    // store-adopt, "No flat store planning path is created").
    expect(ls(partition(result.projectId, 'specs'))).toContain('billing');
    expect(ls(partition(result.projectId, 'changes'))).toContain('add-thing');
    // The flat namespace gained nothing: `rasen/changes/archive` is the empty
    // shell `createOpenSpecRoot` scaffolds, not something the adoption wrote.
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
    expect(ls(path.join(storeRoot, 'rasen', 'changes'))).toEqual(['archive']);
    expect(ls(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([]);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual([]);
    // Pointer written, planning shape gone.
    expect(readStorePointer(source).value).toBe('team-store');
    // This store predates permanent identities, so there is none to record:
    // the declaration stays the legacy string form. Adopt records an identity
    // when the store HAS one; it never invents one.
    expect(readStorePointer(source).shape).toBe('alias');
    // Suggested commits for both repos, never executed.
    expect(result.suggestedCommits.length).toBe(2);
  });

  it('fails closed on a case-insensitive name collision, moving nothing', async () => {
    await declareLayoutV2();
    const source = makeSource();
    // The collision precheck is scoped to THIS project's partition, so the
    // colliding name has to be planted there rather than in the retired flat
    // namespace (spec store-adopt, "Name collision aborts with a full list").
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });
    fs.mkdirSync(partition(projectId, 'specs', 'BILLING'), { recursive: true });
    fs.writeFileSync(partition(projectId, 'specs', 'BILLING', 'spec.md'), '# billing\n');

    await expect(
      adoptProject({
        sourcePath: source,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      })
    ).rejects.toThrow(/collision/i);
    // Source untouched.
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
  });

  it('rejects a source that already declares a store pointer', async () => {
    await declareLayoutV2();
    const source = makeSource();
    fs.appendFileSync(path.join(source, 'rasen', 'config.yaml'), 'store: other\n');

    await expect(
      adoptProject({
        sourcePath: source,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      })
    ).rejects.toThrow(/pointer/i);
  });

  it('dry-run changes nothing', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
    expect(readStorePointer(source).value).toBeUndefined();
    // Nothing landed in the store, at either address.
    expect(ls(path.join(storeRoot, 'rasen', 'projects'))).toEqual([]);
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
  });

  it('dry-run leaves the tracked config byte-identical (mints no projectId)', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const configPath = path.join(source, 'rasen', 'config.yaml');
    const before = fs.readFileSync(configPath, 'utf-8');

    const preview = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
      dryRun: true,
    });

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    expect(readProjectConfig(source)?.projectId).toBeUndefined();
    expect(preview.projectId).toBe(UNASSIGNED_PROJECT_ID);
    // An already-identified project still previews under its real id.
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });
    const second = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
      dryRun: true,
    });
    expect(second.projectId).toBe(projectId);
  });

  // A preview must report the refusal the real run reports. The target-line
  // check used to sit behind "the project already has an identity", so a first
  // adoption — the case where it never does — previewed clean and then refused
  // for real once the identity had been minted (spec store-adopt, "Archive move
  // without a target line is refused").
  it('refuses an archive move with no target line even before an identity exists', async () => {
    await declareLayoutV2();
    const source = makeSource();
    expect(readProjectConfig(source)?.projectId).toBeUndefined();

    await expect(
      adoptProject({
        sourcePath: source,
        storeId: 'team-store',
        globalDataDir,
        dryRun: true,
      })
    ).rejects.toThrow(/--target-line/);
    // And the real run refuses identically.
    await expect(
      adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir })
    ).rejects.toThrow(/--target-line/);
  });

  it('dry-run previews the real archive move count without moving anything', async () => {
    await declareLayoutV2();
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');
    writeArchived(source, '2026-07-02-older');
    // The destination is inside the project's partition, so the preview can
    // only address it once the project has its permanent identity. Minted here
    // rather than by the preview: a dry run deliberately mints nothing (see
    // "dry-run leaves the tracked config byte-identical").
    await ensureProjectIdInConfig(source, { globalDataDir });

    const preview = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      archive: 'move',
      globalDataDir,
      targetLine: TARGET_LINE,
      dryRun: true,
    });

    expect(preview.archiveMoves.map((m) => m.name).sort()).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    // Inert: the entries are still in the repo and the store holds nothing.
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(path.join(storeRoot, 'rasen', 'projects'))).toEqual([]);
    expect(readStorePointer(source).value).toBeUndefined();
  });

  it('rejects --archive external as retired, changing nothing', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');

    await expect(
      adoptProject({
        sourcePath: source,
        storeId: 'team-store',
        archive: 'external' as never,
        globalDataDir,
      })
    ).rejects.toThrow(/retired/i);

    // Nothing moved, no machine home was minted, no destination was written.
    const { resolveProjectHome } = await import('../../../src/core/project-home.js');
    const probed = await resolveProjectHome(source, { ensure: false, globalDataDir });
    expect(probed === null || !fs.existsSync(probed.archiveDir)).toBe(true);
    expect(readProjectConfig(source)?.archive?.destination).toBeUndefined();
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual(['2026-07-01-old']);
    expect(readStorePointer(source).value).toBeUndefined();
  });

  it('--archive move consolidates into the store and writes no destination config', async () => {
    await declareLayoutV2();
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');

    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      archive: 'move',
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    expect(result.archiveMoves.map((m) => m.name)).toEqual(['2026-07-01-old']);
    // Under the project's stable target-line archive directory, keeping its
    // existing name (spec store-adopt, "Default moves the archive").
    expect(ls(partition(result.projectId, 'changes', 'archive', TARGET_LINE))).toEqual([
      '2026-07-01-old',
    ]);
    expect(readProjectConfig(source)?.archive?.destination).toBeUndefined();
  });

  it('still moves the full archive on a real adopt after the dry-run preview', async () => {
    await declareLayoutV2();
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');
    writeArchived(source, '2026-07-02-older');

    await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
      dryRun: true,
    });
    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    expect(result.archiveMoves.map((m) => m.name).sort()).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(partition(result.projectId, 'changes', 'archive', TARGET_LINE))).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([]);
  });

  it('round-trips adopt -> eject restoring the same content', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const adopt = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });

    const eject = await ejectProject({
      projectId: adopt.projectId,
      storeId: 'team-store',
      globalDataDir,
    });
    expect(eject.specs).toEqual(['billing']);
    expect(eject.changes).toEqual(['add-thing']);
    expect(ls(path.join(source, 'rasen', 'specs'))).toContain('billing');
    expect(ls(path.join(source, 'rasen', 'changes'))).toContain('add-thing');
    expect(readStorePointer(source).value).toBeUndefined();
    // Store no longer holds the content: the partition itself is gone.
    expect(fs.existsSync(partition(adopt.projectId))).toBe(false);
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
  });

  // The `--all` consent path is deliberately LEGACY-FLAT ONLY (spec
  // store-eject, "Missing manifest without --all"): a layout v2 store answers
  // the same question from the project's partition and rejects `--all`
  // outright, so this store stays flat on purpose. Seeded directly rather than
  // by adopting, because adopt into a flat store is now refused.
  it('eject from a legacy flat store refuses without a manifest unless --all', async () => {
    writeSpec(storeRoot, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    // Eject a project id the store has no manifest entry for.
    await expect(
      ejectProject({ projectId: 'ghost-id', storeId: 'team-store', globalDataDir })
      // The refusal now names BOTH ownership sources, because the record is
      // the authority and the manifest is only the legacy fallback.
    ).rejects.toThrow(/no ownership record/i);
  });

  // `archive-relocate` capability: relocation only ever CONSOLIDATES archives
  // into a planning root. `external` is retired along with the destination
  // axis, and relocation writes no configuration at all.
  it('consolidates a legacy machine-home archive back into the planning root', async () => {
    const source = makeSource();
    const home = await adoptHomeArchiveDir(source);
    const legacyEntry = path.join(home, '2026-07-01-old');
    fs.mkdirSync(legacyEntry, { recursive: true });
    fs.writeFileSync(path.join(legacyEntry, 'proposal.md'), 'legacy\n');

    const result = await relocateArchive({
      projectRoot: source,
      to: 'in-repo',
      globalDataDir,
    });

    expect(result.moves.map((m) => m.name)).toContain('2026-07-01-old');
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toContain('2026-07-01-old');
    // No destination configuration is written any more.
    expect(readProjectConfig(source)?.archive?.destination).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).destinationValue).toBeUndefined();
  });

  it('rejects archive relocate --to prune', async () => {
    const source = makeSource();
    await expect(
      relocateArchive({ projectRoot: source, to: 'prune' as never, globalDataDir })
    ).rejects.toThrow(/prune/i);
  });

  it('rejects archive relocate --to external as retired', async () => {
    const source = makeSource();
    await expect(
      relocateArchive({ projectRoot: source, to: 'external' as never, globalDataDir })
    ).rejects.toThrow(/retired/i);
    // A refused relocation writes nothing.
    expect(readProjectConfig(source)?.archive?.destination).toBeUndefined();
  });

  it('home prune reports dangling entries and applies removal', async () => {
    // Register a project home, then delete its path so it becomes dangling.
    await declareLayoutV2();
    const ghost = makeSource('ghost-project');
    await adoptProject({
      sourcePath: ghost,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    fs.rmSync(ghost, { recursive: true, force: true });

    const report = await homePrune({ globalDataDir });
    expect(report.danglingEntries.length).toBeGreaterThanOrEqual(1);
    expect(report.applied).toBe(false);

    const applied = await homePrune({ apply: true, globalDataDir });
    expect(applied.applied).toBe(true);
  });

  it('diagnoses a pointer to an unregistered store', async () => {
    const source = path.join(tempDir, 'ptr-only');
    fs.mkdirSync(path.join(source, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(source, 'rasen', 'config.yaml'), 'schema: spec-driven\nstore: ghost\n');

    const diagnostics = await diagnoseMigrationDrift(source, { globalDataDir });
    expect(diagnostics.some((d) => d.code === 'drift_pointer_unregistered')).toBe(true);
  });

  // --- Task 2.7: interrupted-adopt resume (guards findings #1 and #2) ---
  it('resumes an interrupted adopt without a collision error and preserves the full partition', async () => {
    await declareLayoutV2();
    const source = path.join(tempDir, 'resume-app');
    createOpenSpecRoot(source);
    writeSpec(source, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeSpec(source, 'auth', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeChange(source, 'add-thing');
    // Establish the project's stable id, which keys its partition. Minted
    // directly: a dry-run adopt is inert and deliberately mints nothing.
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });

    // Simulate a crash AFTER the ownership record was written and AFTER
    // 'billing' moved, but before the rest: billing lives in the partition,
    // the catalog records the binding, and auth + the change are still at the
    // source with no pointer. In layout v2 the resume marker is the BOUND
    // CATALOG rather than an adoption name list, because no name list is
    // written any more (spec store-adopt, "Manifest written before source
    // deletion" and "The partition is the ownership record").
    await moveTreeVerified(
      path.join(source, 'rasen', 'specs', 'billing'),
      partition(projectId, 'specs', 'billing')
    );
    fs.mkdirSync(path.join(storeRoot, '.rasen-store', 'projects'), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
      [
        'version: 2',
        `projectId: ${projectId}`,
        'roles:',
        '  planning: true',
        '  knowledge: false',
        'planningBinding:',
        '  state: bound',
        "  boundAt: '2026-07-25T10:00:00.000Z'",
        '',
      ].join('\n')
    );

    // Rerun: must NOT fail the collision precheck on 'billing' (already moved).
    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    expect(result.resumed).toBe(true);
    expect(ls(partition(projectId, 'specs'))).toEqual(['auth', 'billing']);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual([]);
    expect(readStorePointer(source).value).toBe('team-store');
    // The binding the interrupted run recorded survives verbatim — the resume
    // neither re-stamps it nor invents a name list to replace it (finding #2).
    const read = await readStoreMembership(storeRoot, projectId, 'team-store');
    expect(read.entry?.layout).toBe(2);
    expect(read.entry?.layout === 2 ? read.entry.catalog.planningBinding : null).toEqual({
      state: 'bound',
      boundAt: '2026-07-25T10:00:00.000Z',
    });
    const serialized = fs.readFileSync(
      path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
      'utf-8'
    );
    expect(serialized).not.toContain('adoption');
    expect(serialized).not.toContain('billing');
  });

  // --- Task 3.5: eject drift block + --force, eject dry-run ---
  // Manifest drift is a LEGACY FLAT store state by construction: layout v2
  // reads the partition itself, so there is no recorded name list for the store
  // to drift away from (spec store-eject, "Missing files block eject", whose
  // requirement scopes the recorded-content rule to the pre-v2 read path). The
  // store here therefore stays flat, and the adoption is seeded directly
  // because adopt into a flat store is now refused.
  it('eject from a legacy flat store fails closed on manifest drift and proceeds with --force', async () => {
    const source = makeSource();
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });
    await moveTreeVerified(
      path.join(source, 'rasen', 'specs', 'billing'),
      path.join(storeRoot, 'rasen', 'specs', 'billing')
    );
    await moveTreeVerified(
      path.join(source, 'rasen', 'changes', 'add-thing'),
      path.join(storeRoot, 'rasen', 'changes', 'add-thing')
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: true, knowledge: false },
      adoption: {
        specs: ['billing'],
        changes: ['add-thing'],
        adoptedAt: '2026-07-25T10:00:00.000Z',
      },
    });
    // Drift: remove a recorded spec from the store.
    fs.rmSync(path.join(storeRoot, 'rasen', 'specs', 'billing'), { recursive: true, force: true });

    await expect(
      ejectProject({
        projectId,
        storeId: 'team-store',
        globalDataDir,
        destinationPath: source,
      })
    ).rejects.toThrow(/missing manifest-listed/i);

    const forced = await ejectProject({
      projectId,
      storeId: 'team-store',
      globalDataDir,
      destinationPath: source,
      force: true,
    });
    expect(forced.missing).toContain('billing');
    expect(forced.changes).toContain('add-thing');
  });

  it('eject dry-run previews without moving anything', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const adopt = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    const preview = await ejectProject({
      projectId: adopt.projectId,
      storeId: 'team-store',
      globalDataDir,
      dryRun: true,
    });
    expect(preview.specs).toEqual(['billing']);
    // Store still holds the content; source still a pointer.
    expect(ls(partition(adopt.projectId, 'specs'))).toContain('billing');
    expect(readStorePointer(source).value).toBe('team-store');
  });

  it('eject warns on a destination collision rather than silently overwriting', async () => {
    await declareLayoutV2();
    const source = makeSource();
    const adopt = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    // Re-create a same-name spec at the source repo before ejecting back.
    writeSpec(source, 'billing', '## Purpose\n\nlocal\n\n## Requirements\n\n- r\n');
    const result = await ejectProject({
      projectId: adopt.projectId,
      storeId: 'team-store',
      globalDataDir,
    });
    expect(result.collisions).toContain('billing');
  });

  // --- Task 4.5: relocate collision suffixing + split-archive consolidation ---
  it('relocate suffixes a colliding archive name at the target', async () => {
    const source = makeSource();
    // Same-named archive dir already in the repo AND in the legacy machine
    // home, so consolidating into the planning root hits a name collision.
    writeArchived(source, '2026-07-01-old');
    const home = await adoptHomeArchiveDir(source);
    fs.mkdirSync(path.join(home, '2026-07-01-old'), { recursive: true });
    fs.writeFileSync(path.join(home, '2026-07-01-old', 'keep.md'), 'legacy\n');

    const result = await relocateArchive({ projectRoot: source, to: 'in-repo', globalDataDir });
    const move = result.moves.find((m) => m.name === '2026-07-01-old');
    expect(move).toBeDefined();
    // The legacy copy is suffixed rather than overwriting the in-repo one.
    expect(path.basename(move!.target)).not.toBe('2026-07-01-old');
    const repoArchive = path.join(source, 'rasen', 'changes', 'archive');
    expect(ls(repoArchive)).toContain('2026-07-01-old');
    expect(fs.existsSync(path.join(repoArchive, path.basename(move!.target), 'keep.md'))).toBe(true);
  });

  it('relocate consolidates a split archive (repo + machine home) to the target', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-repo');
    const home = await adoptHomeArchiveDir(source);
    fs.mkdirSync(path.join(home, '2026-07-02-home'), { recursive: true });
    fs.writeFileSync(path.join(home, '2026-07-02-home', 'p.md'), 'h\n');

    const result = await relocateArchive({ projectRoot: source, to: 'in-repo', globalDataDir });
    // The repo entry is already at the in-repo target (a no-op self-move); only
    // the machine-home entry is physically moved. Consolidation is verified at
    // the target, which afterward holds the UNION.
    expect(result.moves.map((m) => m.name)).toEqual(['2026-07-02-home']);
    const repoArchive = path.join(source, 'rasen', 'changes', 'archive');
    expect(ls(repoArchive).sort()).toEqual(['2026-07-01-repo', '2026-07-02-home']);
  });

  // --- Task 5.3: live/worktree-referenced homes survive prune ---
  it('home prune never lists a registered project whose path still exists', async () => {
    await declareLayoutV2();
    const source = makeSource();
    await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      targetLine: TARGET_LINE,
    });
    const report = await homePrune({ globalDataDir });
    // The live project is neither dangling nor an unreferenced home.
    expect(report.danglingEntries.some((e) => e.path.includes('my-app'))).toBe(false);
    expect(report.unreferencedHomes.length).toBe(0);
  });

  // --- Task 6.3: remaining drift states ---
  it('diagnoses ambiguous shape + pointer (resolves as in-repo)', async () => {
    const source = path.join(tempDir, 'ambiguous');
    createOpenSpecRoot(source);
    writeSpec(source, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    fs.appendFileSync(path.join(source, 'rasen', 'config.yaml'), 'store: team-store\n');
    const diagnostics = await diagnoseMigrationDrift(source, { globalDataDir });
    expect(diagnostics.some((d) => d.code === 'drift_shape_and_pointer')).toBe(true);
  });

  // `drift_manifest_missing_content` compares a RECORDED name list against the
  // store's flat content. Layout v2 records no name list — the partition is the
  // ownership record — so this drift state belongs to the legacy flat store,
  // and its v2 counterpart is the `store_layout_partition_orphan` diagnostic.
  it('diagnoses a legacy ownership record referencing content missing from the store', async () => {
    const source = makeSource();
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });
    await moveTreeVerified(
      path.join(source, 'rasen', 'specs', 'billing'),
      path.join(storeRoot, 'rasen', 'specs', 'billing')
    );
    await moveTreeVerified(
      path.join(source, 'rasen', 'changes', 'add-thing'),
      path.join(storeRoot, 'rasen', 'changes', 'add-thing')
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: true, knowledge: false },
      adoption: {
        specs: ['billing'],
        changes: ['add-thing'],
        adoptedAt: '2026-07-25T10:00:00.000Z',
      },
    });
    updateProjectConfigKey(source, 'store', 'team-store');
    // Remove an adopted change from the store: the record now over-claims.
    fs.rmSync(path.join(storeRoot, 'rasen', 'changes', 'add-thing'), { recursive: true, force: true });
    const diagnostics = await diagnoseMigrationDrift(source, { globalDataDir });
    expect(diagnostics.some((d) => d.code === 'drift_manifest_missing_content')).toBe(true);
  });

  /** Resolves (and creates) the source project's machine-home archive dir. */
  async function adoptHomeArchiveDir(source: string): Promise<string> {
    const { resolveProjectHome } = await import('../../../src/core/project-home.js');
    const home = await resolveProjectHome(source, { ensure: true, globalDataDir });
    fs.mkdirSync(home!.archiveDir, { recursive: true });
    return home!.archiveDir;
  }

  describe('membership record mutation safety (B6)', () => {
    const EJECT_PROJECT = 'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5';

    function cleanRecordLock(projectId: string): void {
      const lockPath = machineLockPath(
        path.resolve(getStoreProjectRecordPath(storeRoot, projectId))
      );
      fs.rmSync(lockPath, { force: true });
    }

    afterEach(() => {
      cleanRecordLock(EJECT_PROJECT);
    });

    it('clearProjectOwnership acquires the shared membership lock', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: EJECT_PROJECT,
        roles: { planning: true, knowledge: true },
      });

      // Pre-acquire the per-record lock so clearProjectOwnership queues
      // deterministically. Pre-fix (no lock), it completes immediately;
      // post-fix it blocks until the lock is released.
      const lockPath = machineLockPath(
        path.resolve(getStoreProjectRecordPath(storeRoot, EJECT_PROJECT))
      );
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      let resolved = false;
      const promise = clearProjectOwnership(storeRoot, EJECT_PROJECT).then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(resolved).toBe(false);

      await releaseOwnerAwareFileLock(block);
      await promise;
      expect(resolved).toBe(true);

      const after = await readStoreProjectRecord(storeRoot, EJECT_PROJECT);
      expect(after.record?.roles).toEqual({ planning: false, knowledge: true });
    });

    it('preserves a concurrent add-project role when eject runs concurrently', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: EJECT_PROJECT,
        roles: { planning: true, knowledge: false },
      });

      const store = { type: 'store' as const, id: 'team-store', root: storeRoot };

      const lockPath = machineLockPath(
        path.resolve(getStoreProjectRecordPath(storeRoot, EJECT_PROJECT))
      );
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      const promise = Promise.all([
        clearProjectOwnership(storeRoot, EJECT_PROJECT),
        writeMembershipRecord({
          projectRoot: tempDir,
          projectId: EJECT_PROJECT,
          store,
          roles: { planning: false, knowledge: true },
          globalDataDir,
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 150));
      await releaseOwnerAwareFileLock(block);
      await promise;

      const final = await readStoreProjectRecord(storeRoot, EJECT_PROJECT);
      expect(final.record?.roles).toEqual({ planning: false, knowledge: true });
    });

    it('migrateStoreMembership apply acquires the per-record lock', async () => {
      const projectRoot = path.join(tempDir, 'legacy-project');
      createOpenSpecRoot(projectRoot);
      ensureProjectIdInConfig(projectRoot, EJECT_PROJECT);
      upsertAdoptionEntry(storeRoot, EJECT_PROJECT, {
        specs: ['billing'],
        changes: [],
        timestamp: '2026-07-27T00:00:00Z',
      });

      const lockPath = machineLockPath(
        path.resolve(getStoreProjectRecordPath(storeRoot, EJECT_PROJECT))
      );
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      let resolved = false;
      const promise = migrateStoreMembership({
        storeId: 'team-store',
        apply: true,
        globalDataDir,
      }).then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(resolved).toBe(false);

      await releaseOwnerAwareFileLock(block);
      await promise;
      expect(resolved).toBe(true);

      const record = await readStoreProjectRecord(storeRoot, EJECT_PROJECT);
      expect(record.record).not.toBeNull();
      expect(record.record?.roles.planning).toBe(true);
    });
  });
});
