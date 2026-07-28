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
import {
  ensureProjectIdInConfig,
  readStorePointer,
  readProjectConfig,
} from '../../../src/core/project-config.js';
import {
  moveTreeVerified,
  upsertAdoptionEntry,
  readAdoptionEntry,
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

  it('adopts an in-repo project into the store and converts it to a pointer', async () => {
    const source = makeSource();
    const result = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });

    expect(result.specs).toEqual(['billing']);
    expect(result.changes).toEqual(['add-thing']);
    // Content moved into the store, removed from source.
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toContain('billing');
    expect(ls(path.join(storeRoot, 'rasen', 'changes'))).toContain('add-thing');
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
    const source = makeSource();
    // Store already has a spec whose name collides case-insensitively.
    writeSpec(storeRoot, 'BILLING', '## Purpose\n\np\n\n## Requirements\n\n- r\n');

    await expect(
      adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir })
    ).rejects.toThrow(/collision/i);
    // Source untouched.
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
  });

  it('rejects a source that already declares a store pointer', async () => {
    const source = makeSource();
    fs.appendFileSync(path.join(source, 'rasen', 'config.yaml'), 'store: other\n');

    await expect(
      adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir })
    ).rejects.toThrow(/pointer/i);
  });

  it('dry-run changes nothing', async () => {
    const source = makeSource();
    const result = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual(['billing']);
    expect(readStorePointer(source).value).toBeUndefined();
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
  });

  it('dry-run leaves the tracked config byte-identical (mints no projectId)', async () => {
    const source = makeSource();
    const configPath = path.join(source, 'rasen', 'config.yaml');
    const before = fs.readFileSync(configPath, 'utf-8');

    const preview = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
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
      dryRun: true,
    });
    expect(second.projectId).toBe(projectId);
  });

  it('dry-run previews the real archive move count without moving anything', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');
    writeArchived(source, '2026-07-02-older');

    const preview = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      archive: 'move',
      globalDataDir,
      dryRun: true,
    });

    expect(preview.archiveMoves.map((m) => m.name).sort()).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    // Inert: the entries are still in the repo and the store archive is empty.
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([]);
    expect(readStorePointer(source).value).toBeUndefined();
  });

  it('dry-run previews --archive external without minting a home or writing config', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');

    const preview = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      archive: 'external',
      globalDataDir,
      dryRun: true,
    });

    expect(preview.archiveMoves.map((m) => m.name)).toEqual(['2026-07-01-old']);
    // No home directory was created and the destination flip never happened.
    const { resolveProjectHome } = await import('../../../src/core/project-home.js');
    const probed = await resolveProjectHome(source, { ensure: false, globalDataDir });
    expect(probed === null || !fs.existsSync(probed.archiveDir)).toBe(true);
    expect(readProjectConfig(source)?.archive?.destination).toBeUndefined();
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual(['2026-07-01-old']);
  });

  it('still moves the full archive on a real adopt after the dry-run preview', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');
    writeArchived(source, '2026-07-02-older');

    await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir, dryRun: true });
    const result = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });

    expect(result.archiveMoves.map((m) => m.name).sort()).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(path.join(storeRoot, 'rasen', 'changes', 'archive'))).toEqual([
      '2026-07-01-old',
      '2026-07-02-older',
    ]);
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).toEqual([]);
  });

  it('round-trips adopt -> eject restoring the same content', async () => {
    const source = makeSource();
    const adopt = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });

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
    // Store no longer holds the content.
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual([]);
  });

  it('eject refuses without a manifest unless --all', async () => {
    const source = makeSource();
    await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
    // Eject a project id the store has no manifest entry for.
    await expect(
      ejectProject({ projectId: 'ghost-id', storeId: 'team-store', globalDataDir })
      // The refusal now names BOTH ownership sources, because the record is
      // the authority and the manifest is only the legacy fallback.
    ).rejects.toThrow(/no ownership record/i);
  });

  it('relocates archives in-repo -> external and consolidates a split archive', async () => {
    const source = makeSource();
    writeArchived(source, '2026-07-01-old');

    const result = await relocateArchive({
      projectRoot: source,
      to: 'external',
      globalDataDir,
    });
    expect(result.destinationValue).toBe('external');
    expect(result.moves.map((m) => m.name)).toContain('2026-07-01-old');
    // Config records external.
    expect(readProjectConfig(source)?.archive?.destination).toBe('external');
    // The archived entry left the repo.
    expect(ls(path.join(source, 'rasen', 'changes', 'archive'))).not.toContain('2026-07-01-old');
  });

  it('rejects archive relocate --to prune', async () => {
    const source = makeSource();
    await expect(
      relocateArchive({ projectRoot: source, to: 'prune' as never, globalDataDir })
    ).rejects.toThrow(/prune/i);
  });

  it('home prune reports dangling entries and applies removal', async () => {
    // Register a project home, then delete its path so it becomes dangling.
    const ghost = makeSource('ghost-project');
    await adoptProject({ sourcePath: ghost, storeId: 'team-store', globalDataDir });
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
  it('resumes an interrupted adopt without a collision error and preserves the full manifest', async () => {
    const source = path.join(tempDir, 'resume-app');
    createOpenSpecRoot(source);
    writeSpec(source, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeSpec(source, 'auth', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeChange(source, 'add-thing');
    // Establish the project's stable id in the manifest key. Minted directly:
    // a dry-run adopt is inert and deliberately mints nothing.
    const projectId = await ensureProjectIdInConfig(source, { globalDataDir });

    // Simulate a crash AFTER the manifest write and AFTER 'billing' moved, but
    // before the rest: billing lives in the store, the manifest records the
    // FULL set, and auth + the change are still at the source with no pointer.
    await moveTreeVerified(
      path.join(source, 'rasen', 'specs', 'billing'),
      path.join(storeRoot, 'rasen', 'specs', 'billing')
    );
    await upsertAdoptionEntry(storeRoot, projectId, {
      specs: ['auth', 'billing'],
      changes: ['add-thing'],
      sourcePath: source,
      timestamp: new Date().toISOString(),
    });

    // Rerun: must NOT fail the collision precheck on 'billing' (already moved).
    const result = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
    expect(result.resumed).toBe(true);
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toEqual(['auth', 'billing']);
    expect(ls(path.join(source, 'rasen', 'specs'))).toEqual([]);
    expect(readStorePointer(source).value).toBe('team-store');
    // The manifest keeps the ALREADY-MOVED 'billing' (finding #2).
    const entry = await readAdoptionEntry(storeRoot, projectId);
    expect(entry?.specs.sort()).toEqual(['auth', 'billing']);
  });

  // --- Task 3.5: eject drift block + --force, eject dry-run ---
  it('eject fails closed on manifest drift and proceeds with --force', async () => {
    const source = makeSource();
    const adopt = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
    // Drift: remove a manifest-listed spec from the store.
    fs.rmSync(path.join(storeRoot, 'rasen', 'specs', 'billing'), { recursive: true, force: true });

    await expect(
      ejectProject({ projectId: adopt.projectId, storeId: 'team-store', globalDataDir })
    ).rejects.toThrow(/missing manifest-listed/i);

    const forced = await ejectProject({
      projectId: adopt.projectId,
      storeId: 'team-store',
      globalDataDir,
      force: true,
    });
    expect(forced.missing).toContain('billing');
    expect(forced.changes).toContain('add-thing');
  });

  it('eject dry-run previews without moving anything', async () => {
    const source = makeSource();
    const adopt = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
    const preview = await ejectProject({
      projectId: adopt.projectId,
      storeId: 'team-store',
      globalDataDir,
      dryRun: true,
    });
    expect(preview.specs).toEqual(['billing']);
    // Store still holds the content; source still a pointer.
    expect(ls(path.join(storeRoot, 'rasen', 'specs'))).toContain('billing');
    expect(readStorePointer(source).value).toBe('team-store');
  });

  it('eject warns on a destination collision rather than silently overwriting', async () => {
    const source = makeSource();
    const adopt = await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
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
    // Same-named archive dir in the repo AND already at the external home target.
    writeArchived(source, '2026-07-01-old');
    const home = await adoptHomeArchiveDir(source);
    fs.mkdirSync(path.join(home, '2026-07-01-old'), { recursive: true });
    fs.writeFileSync(path.join(home, '2026-07-01-old', 'keep.md'), 'existing\n');

    const result = await relocateArchive({ projectRoot: source, to: 'external', globalDataDir });
    const move = result.moves.find((m) => m.name === '2026-07-01-old');
    expect(move).toBeDefined();
    expect(path.basename(move!.target)).not.toBe('2026-07-01-old');
    // Both remain readable at the target.
    expect(fs.existsSync(path.join(home, '2026-07-01-old', 'keep.md'))).toBe(true);
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
    const source = makeSource();
    await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
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

  it('diagnoses a manifest referencing content missing from the store', async () => {
    const source = makeSource();
    await adoptProject({ sourcePath: source, storeId: 'team-store', globalDataDir });
    // Remove an adopted change from the store: manifest now over-claims.
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
