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
} from '../../../src/core/store/migration-ops.js';
import { readStorePointer, readProjectConfig } from '../../../src/core/project-config.js';
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migration-ops-'));
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
    ).rejects.toThrow(/manifest/i);
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
    // Establish the project's stable id in the manifest key.
    const first = await adoptProject({
      sourcePath: source,
      storeId: 'team-store',
      globalDataDir,
      dryRun: true,
    });
    const projectId = first.projectId;

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
});
