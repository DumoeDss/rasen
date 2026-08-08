import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import { storeAddProject } from '../../../src/core/store/operations.js';
import {
  adoptProject,
  ejectProject,
  migrateStoreMembership,
  readProjectOwnership,
  resolveEjectDestination,
} from '../../../src/core/store/migration-ops.js';
import {
  getStoreProjectRecordPath,
  readStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { readStoreMembership } from '../../../src/core/store/membership-layout.js';
import type { StoreProjectCatalogV2 } from '../../../src/core/store/planning-catalogs.js';
import {
  getAdoptionsManifestPath,
  readAdoptionsManifest,
  upsertAdoptionEntry,
} from '../../../src/core/store/migration.js';
import {
  readProjectConfig,
  readStorePointer,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { createOpenSpecRoot, writeSpec } from '../../helpers/rasen-fixtures.js';
import {
  propertyReceivers,
  sourceFiles,
  withoutComments,
} from '../../helpers/source-guards.js';
import { StoreError } from '../../../src/core/store/errors.js';

const PROJECT_A = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';

function writeChange(root: string, name: string): void {
  const dir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), 'x\n');
}

function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

describe('membership across add-project, adopt, eject, and the migration', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-membership-ops-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
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

  function makeProject(name = 'my-app'): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    writeSpec(root, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    writeChange(root, 'add-thing');
    return root;
  }

  const TARGET_LINE = 'line-0.2';

  /**
   * Declares planning layout v2 on the fixture store, with the one target-line
   * catalog `--archive move` requires there. Opt-in per test: `add-project`,
   * the destination rules and `store migrate-membership` are all exercised
   * against a legacy flat store, which is still a supported state.
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

  /** A project's layout v2 partition address, spelled out rather than computed. */
  function partition(projectId: string, ...segments: string[]): string {
    return path.join(storeRoot, 'rasen', 'projects', projectId, ...segments);
  }

  /** The project's catalog in a layout v2 store, or null when it is not one. */
  async function catalogOf(projectId: string): Promise<StoreProjectCatalogV2 | null> {
    const read = await readStoreMembership(storeRoot, projectId, 'team-store');
    return read.entry?.layout === 2 ? read.entry.catalog : null;
  }

  async function otherStore(id: string): Promise<string> {
    const root = path.join(tempDir, id);
    createOpenSpecRoot(root);
    await registerStore({ id, localPath: root, globalDataDir });
    return root;
  }

  describe('store add-project', () => {
    it('writes the store record and the project hint, and nothing else in the project', async () => {
      const projectRoot = makeProject();
      const specsBefore = snapshot(path.join(projectRoot, 'rasen', 'specs'));
      const changesBefore = snapshot(path.join(projectRoot, 'rasen', 'changes'));

      const result = await storeAddProject({ projectPath: projectRoot, targetStoreId: 'team-store' });

      const projectId = result.membership.projectId as string;
      expect(projectId).toBeTruthy();
      expect((await readStoreProjectRecord(storeRoot, projectId)).record).toMatchObject({
        projectId,
        // add-project adds the project to the ROSTER; it never makes the
        // project plan anywhere.
        roles: { planning: false, knowledge: true },
      });
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([{ id: 'team-store' }]);
      expect(readProjectConfig(storeRoot)?.references).toContainEqual({
        id: path.basename(projectRoot),
        type: 'project',
      });
      // The project's own config never gains a referenced-store entry.
      expect(readProjectConfig(projectRoot)?.references).toBeUndefined();

      expect(snapshot(path.join(projectRoot, 'rasen', 'specs'))).toEqual(specsBefore);
      expect(snapshot(path.join(projectRoot, 'rasen', 'changes'))).toEqual(changesBefore);
    });

    it('leaves the planning store byte-identical without the opt-in', async () => {
      const projectRoot = makeProject();
      const otherRoot = await otherStore('other-store');
      updateProjectConfigKey(projectRoot, 'store', 'other-store');
      const pointerBefore = readStorePointer(projectRoot);
      const storeSnapshotBefore = snapshot(otherRoot);

      const result = await storeAddProject({ projectPath: projectRoot, targetStoreId: 'team-store' });

      expect(readStorePointer(projectRoot)).toEqual(pointerBefore);
      expect(snapshot(otherRoot)).toEqual(storeSnapshotBefore);
      expect(result.planningBinding.requested).toBe(false);
      expect(result.planningBinding.changed).toBe(false);
    });

    it('binds a project that had no planning store, reporting it separately', async () => {
      const projectRoot = makeProject();

      const result = await storeAddProject({
        projectPath: projectRoot,
        targetStoreId: 'team-store',
        setPrimary: true,
      });

      expect(result.planningBinding).toMatchObject({
        requested: true,
        changed: true,
        refused: false,
        boundTo: 'team-store',
      });
      expect(readProjectConfig(projectRoot)?.store).toBe('team-store');
      // The membership is a distinct fact in the same result.
      expect(result.membership.roles).toEqual({ planning: true, knowledge: true });
    });

    it('refuses to overwrite a different planning store, leaving membership standing', async () => {
      const projectRoot = makeProject();
      await otherStore('other-store');
      updateProjectConfigKey(projectRoot, 'store', 'other-store');

      const result = await storeAddProject({
        projectPath: projectRoot,
        targetStoreId: 'team-store',
        setPrimary: true,
      });

      expect(result.planningBinding).toMatchObject({
        requested: true,
        refused: true,
        changed: false,
        boundTo: 'other-store',
        requestedStore: 'team-store',
      });
      expect(result.planningBinding.rebindCommand).toBeTruthy();
      // The pointer is untouched...
      expect(readProjectConfig(projectRoot)?.store).toBe('other-store');
      // ...and the membership this invocation established still stands.
      const projectId = result.membership.projectId as string;
      expect((await readStoreProjectRecord(storeRoot, projectId)).record).not.toBeNull();
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([{ id: 'team-store' }]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'project_planning_binding_refused'
      );
    });

    it('is a no-op when the project already plans in the target store', async () => {
      const projectRoot = makeProject();
      updateProjectConfigKey(projectRoot, 'store', 'team-store');
      const configBefore = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

      const result = await storeAddProject({
        projectPath: projectRoot,
        targetStoreId: 'team-store',
        setPrimary: true,
      });

      expect(result.planningBinding).toMatchObject({ alreadyBound: true, changed: false, refused: false });
      // The pointer line is unchanged (the hint append is the only edit).
      expect(fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8')).toContain(
        configBefore.trim().split('\n').find((line) => line.startsWith('store:')) as string
      );
    });

    it('never infers the opt-in from any other option', async () => {
      const projectRoot = makeProject();

      await storeAddProject({
        projectPath: projectRoot,
        targetStoreId: 'team-store',
        id: path.basename(projectRoot),
      });

      expect(readProjectConfig(projectRoot)?.store).toBeUndefined();
    });

    it('previews both repositories and writes nothing', async () => {
      const projectRoot = makeProject();
      const before = snapshot(tempDir);

      const result = await storeAddProject({
        projectPath: projectRoot,
        targetStoreId: 'team-store',
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.membership.storeWrites.length).toBeGreaterThan(0);
      expect(result.membership.projectWrites.length).toBeGreaterThan(0);
      expect(snapshot(tempDir)).toEqual(before);
    });

    it('re-running changes no file', async () => {
      const projectRoot = makeProject();
      await storeAddProject({ projectPath: projectRoot, targetStoreId: 'team-store' });
      const before = snapshot(tempDir);

      const second = await storeAddProject({ projectPath: projectRoot, targetStoreId: 'team-store' });

      expect(second.membership.recordWritten).toBe(false);
      expect(second.membership.hintWritten).toBe(false);
      expect(second.target.referenceAlreadyPresent).toBe(true);
      expect(snapshot(tempDir)).toEqual(before);
    });
  });

  describe('store adopt', () => {
    it('records ownership in the project catalog with no source path', async () => {
      await declareLayoutV2();
      const projectRoot = makeProject();

      const result = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });

      const catalog = await catalogOf(result.projectId);
      // Adopt proves PLANNING membership and nothing else (design D2). It runs
      // add-project's registration and reference work, and roles OR-widen on
      // write, so inheriting add-project's `knowledge: true` durably recorded
      // a role nobody established — in a Git-committed file child D will read.
      expect(catalog?.roles).toEqual({ planning: true, knowledge: false });
      // Ownership is the bound binding plus the partition itself. Layout v2
      // records no adopted spec or change name list at all (spec store-adopt,
      // "The partition is the ownership record").
      expect(catalog?.planningBinding.state).toBe('bound');
      expect(
        catalog?.planningBinding.state === 'bound' ? catalog.planningBinding.boundAt : undefined
      ).toBeTruthy();
      expect(fs.readdirSync(partition(result.projectId, 'specs')).sort()).toEqual(['billing']);
      expect(fs.readdirSync(partition(result.projectId, 'changes')).sort()).toEqual(['add-thing']);

      const serialized = fs.readFileSync(
        getStoreProjectRecordPath(storeRoot, result.projectId),
        'utf-8'
      );
      expect(serialized).not.toContain('sourcePath');
      expect(serialized).not.toContain(projectRoot);
      expect(serialized).not.toContain('adoption');

      // The legacy manifest is no longer written at all.
      expect(fs.existsSync(getAdoptionsManifestPath(storeRoot))).toBe(false);
      // And the project carries a locator for the store its planning moved to.
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([{ id: 'team-store' }]);
    });

    it('resumes an interrupted adopt from the bound catalog', async () => {
      await declareLayoutV2();
      const projectRoot = makeProject();
      const first = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });
      const firstBinding = (await catalogOf(first.projectId))?.planningBinding;
      const boundAt = firstBinding?.state === 'bound' ? firstBinding.boundAt : undefined;
      expect(boundAt).toBeTruthy();

      // Re-create planning shape at the source, as an interrupted run leaves it.
      writeChange(projectRoot, 'second-change');
      const resumed = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });

      expect(resumed.resumed).toBe(true);
      // What the project owns is readable from its partition alone.
      expect(fs.readdirSync(partition(resumed.projectId, 'changes')).sort()).toEqual([
        'add-thing',
        'second-change',
      ]);
      // The binding the first run recorded is preserved, not re-stamped: the
      // catalog is the resume MARKER, so a resume that rewrote it would erase
      // the fact it resumed from (spec store-adopt, "Manifest written before
      // source deletion").
      expect(await catalogOf(resumed.projectId)).toMatchObject({
        planningBinding: { state: 'bound', boundAt },
      });
    });

    it('reads ownership from the legacy manifest while one still exists', async () => {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['legacy-spec'],
        changes: [],
        sourcePath: '/machine-a/elftia',
        timestamp: '2026-07-25T10:00:00Z',
      });

      const ownership = await readProjectOwnership(storeRoot, PROJECT_A);
      expect(ownership).toMatchObject({
        specs: ['legacy-spec'],
        adoptedAt: '2026-07-25T10:00:00Z',
        source: 'legacy-manifest',
      });
      // The recorded path is never carried through.
      expect(Object.values(ownership ?? {})).not.toContain('/machine-a/elftia');
    });
  });

  describe('store eject destination (design D7)', () => {
    it('prefers an explicit --into over every other candidate', async () => {
      const destination = path.join(tempDir, 'explicit');
      fs.mkdirSync(destination, { recursive: true });

      const resolved = await resolveEjectDestination({
        projectId: PROJECT_A,
        explicit: destination,
      });

      expect(resolved.destinationPath).toBe(path.resolve(destination));
    });

    it('uses the current checkout when its project identity matches', async () => {
      const projectRoot = makeProject('current');
      updateProjectConfigKey(projectRoot, 'projectId', PROJECT_A);

      const resolved = await resolveEjectDestination({
        projectId: PROJECT_A,
        currentDirectory: projectRoot,
      });

      expect(fs.realpathSync(resolved.destinationPath)).toBe(fs.realpathSync(projectRoot));
    });

    it('uses the single live registered checkout when run from elsewhere', async () => {
      const projectRoot = makeProject('registered');
      updateProjectConfigKey(projectRoot, 'projectId', PROJECT_A);
      await registerProject(
        { projectRoot, projectId: PROJECT_A, mode: 'in-repo' },
        { globalDataDir }
      );

      const resolved = await resolveEjectDestination({
        projectId: PROJECT_A,
        currentDirectory: tempDir,
        pathOptions: { globalDataDir },
      });

      expect(fs.realpathSync(resolved.destinationPath)).toBe(fs.realpathSync(projectRoot));
    });

    it('fails naming --into and listing candidates when several checkouts exist', async () => {
      const first = makeProject('clone-one');
      const second = makeProject('clone-two');
      for (const root of [first, second]) {
        updateProjectConfigKey(root, 'projectId', PROJECT_A);
        await registerProject(
          { projectRoot: root, projectId: PROJECT_A, mode: 'in-repo' },
          { globalDataDir }
        );
      }

      await expect(
        resolveEjectDestination({
          projectId: PROJECT_A,
          currentDirectory: tempDir,
          pathOptions: { globalDataDir },
        })
      ).rejects.toThrow(/--into/);

      const error = await resolveEjectDestination({
        projectId: PROJECT_A,
        currentDirectory: tempDir,
        pathOptions: { globalDataDir },
      }).catch((caught: unknown) => caught as StoreError);
      expect(error.message).toContain('clone-one');
      expect(error.message).toContain('clone-two');
    });

    it('fails rather than guessing when no checkout is registered', async () => {
      await expect(
        resolveEjectDestination({
          projectId: PROJECT_A,
          currentDirectory: tempDir,
          pathOptions: { globalDataDir },
        })
      ).rejects.toThrow(/--into/);
    });

    it('never follows a legacy recorded source path', async () => {
      await declareLayoutV2();
      const projectRoot = makeProject('adopted');
      const result = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });

      // Plant a legacy manifest pointing at a directory from another machine.
      const foreign = path.join(tempDir, 'another-machine', 'elftia');
      fs.mkdirSync(foreign, { recursive: true });
      await upsertAdoptionEntry(storeRoot, result.projectId, {
        specs: ['billing'],
        changes: ['add-thing'],
        sourcePath: foreign,
        timestamp: '2026-07-25T10:00:00Z',
      });

      const ejected = await ejectProject({
        projectId: result.projectId,
        storeId: 'team-store',
        globalDataDir,
        // Run from a directory that is neither the checkout nor the store.
        currentDirectory: tempDir,
        dryRun: true,
      });

      // The registered checkout wins; the recorded foreign path has no effect.
      expect(fs.realpathSync(ejected.destinationPath)).toBe(fs.realpathSync(projectRoot));
      expect(ejected.destinationPath).not.toContain('another-machine');
    });

    it('matches a checkout that differs only in separator form', async () => {
      const projectRoot = makeProject('separators');
      updateProjectConfigKey(projectRoot, 'projectId', PROJECT_A);
      const posixish = projectRoot.split(path.sep).join('/');

      const resolved = await resolveEjectDestination({
        projectId: PROJECT_A,
        currentDirectory: posixish,
      });

      expect(fs.realpathSync(resolved.destinationPath)).toBe(fs.realpathSync(projectRoot));
    });

    it('releases the planning binding and restores the project', async () => {
      await declareLayoutV2();
      const projectRoot = makeProject('round-trip');
      const adopted = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });

      await ejectProject({
        projectId: adopted.projectId,
        storeId: 'team-store',
        globalDataDir,
        destinationPath: projectRoot,
      });

      const catalog = await catalogOf(adopted.projectId);
      // Eject ends where the project PLANS, not the roster it belongs to, so
      // in layout v2 the catalog survives with its binding released rather
      // than being deleted (spec store-eject, "Manifest-driven eject": the
      // catalog "records an unbound planning binding with its roles
      // preserved"). The original guard still holds in the new shape: adopt
      // asserted PLANNING and nothing else, so no `knowledge: true` leaked in
      // from the composed `add-project` call.
      expect(catalog?.planningBinding).toEqual({ state: 'unbound' });
      expect(catalog?.roles).toEqual({ planning: true, knowledge: false });
      expect(fs.existsSync(path.join(projectRoot, 'rasen', 'specs', 'billing'))).toBe(true);
      // The partition it owned is gone with it.
      expect(fs.existsSync(partition(adopted.projectId))).toBe(false);
    });

    it('keeps a knowledge role that eject did not end', async () => {
      await declareLayoutV2();
      const projectRoot = makeProject('knowledge-survivor');
      // `add-project` establishes knowledge membership; adopt then adds
      // planning. Ejecting ends planning only — dropping the knowledge role
      // the user established separately would invent a change nobody asked
      // for, in the opposite direction to asserting one.
      await storeAddProject({ projectPath: projectRoot, targetStoreId: 'team-store' });
      const adopted = await adoptProject({
        sourcePath: projectRoot,
        storeId: 'team-store',
        globalDataDir,
        targetLine: TARGET_LINE,
      });

      await ejectProject({
        projectId: adopted.projectId,
        storeId: 'team-store',
        globalDataDir,
        destinationPath: projectRoot,
      });

      const catalog = await catalogOf(adopted.projectId);
      // Layout v2 preserves roles VERBATIM and releases the binding instead
      // (spec store-eject), so what ends here is the binding — and the
      // knowledge role the user established separately still stands.
      expect(catalog?.planningBinding).toEqual({ state: 'unbound' });
      expect(catalog?.roles).toEqual({ planning: true, knowledge: true });
    });
  });

  describe('store migrate-membership (design D8)', () => {
    async function seedLegacy(): Promise<string> {
      const projectRoot = makeProject('legacy-app');
      updateProjectConfigKey(projectRoot, 'projectId', PROJECT_A);
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['billing'],
        changes: ['add-thing'],
        sourcePath: path.join(tempDir, 'machine-a', 'legacy-app'),
        timestamp: '2026-07-25T10:00:00Z',
      });
      return projectRoot;
    }

    it('previews the conversion and writes nothing', async () => {
      await seedLegacy();
      const before = snapshot(tempDir);

      const result = await migrateStoreMembership({ storeId: 'team-store', globalDataDir });

      expect(result.applied).toBe(false);
      expect(result.converted.map((entry) => entry.projectId)).toEqual([PROJECT_A]);
      expect(result.legacyManifestRemoved).toBe(true);
      expect(result.storeWrites).toContain(getAdoptionsManifestPath(storeRoot));
      expect(snapshot(tempDir)).toEqual(before);
    });

    it('writes the records, drops the source path, and removes the legacy file', async () => {
      await seedLegacy();

      const result = await migrateStoreMembership({
        storeId: 'team-store',
        apply: true,
        globalDataDir,
      });

      expect(result.applied).toBe(true);
      const read = await readStoreProjectRecord(storeRoot, PROJECT_A);
      expect(read.record).toMatchObject({
        projectId: PROJECT_A,
        roles: { planning: true, knowledge: false },
        adoption: { specs: ['billing'], changes: ['add-thing'], adoptedAt: '2026-07-25T10:00:00Z' },
      });
      const serialized = fs.readFileSync(getStoreProjectRecordPath(storeRoot, PROJECT_A), 'utf-8');
      expect(serialized).not.toContain('sourcePath');
      expect(serialized).not.toContain('machine-a');
      expect(fs.existsSync(getAdoptionsManifestPath(storeRoot))).toBe(false);
    });

    it('is safe to run a second time', async () => {
      await seedLegacy();
      await migrateStoreMembership({ storeId: 'team-store', apply: true, globalDataDir });
      const before = snapshot(tempDir);

      const second = await migrateStoreMembership({
        storeId: 'team-store',
        apply: true,
        globalDataDir,
      });

      expect(second.converted).toEqual([]);
      expect(snapshot(tempDir)).toEqual(before);
    });

    it('leaves an unresolvable legacy reference alone and keeps the legacy data', async () => {
      await seedLegacy();
      updateProjectConfigKey(storeRoot, 'references', ['project:never-registered']);

      const result = await migrateStoreMembership({
        storeId: 'team-store',
        apply: true,
        globalDataDir,
      });

      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0]?.unresolved).toContain('never-registered');
      // The legacy file survives: it is the only remaining record of that member.
      expect(result.legacyManifestRemoved).toBe(false);
      expect(fs.existsSync(getAdoptionsManifestPath(storeRoot))).toBe(true);
      expect((await readAdoptionsManifest(storeRoot))?.adoptions[PROJECT_A]).toBeDefined();
    });

    it('keeps the legacy file when a record cannot be written', async () => {
      await seedLegacy();
      // A projectId that cannot safely name a file blocks its own conversion.
      await upsertAdoptionEntry(storeRoot, '(unassigned)', {
        specs: [],
        changes: [],
        timestamp: '2026-07-25T10:00:00Z',
      });

      const result = await migrateStoreMembership({
        storeId: 'team-store',
        apply: true,
        globalDataDir,
      });

      expect(result.unresolved.some((entry) => entry.projectId === '(unassigned)')).toBe(true);
      expect(result.legacyManifestRemoved).toBe(false);
      expect(fs.existsSync(getAdoptionsManifestPath(storeRoot))).toBe(true);
    });
  });

  /**
   * The forbidden destination sources, asserted over the SOURCE rather than
   * only through behavior. A behavioral test proves the rule holds for the
   * cases it exercises; these prove there is no code left that could reach for
   * a recorded path, a remote, or an arbitrary candidate at all.
   */
  describe('the forbidden eject inputs are unreachable', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');

    /**
     * Reads of a recorded source path, PROPERTY-first: every `.sourcePath`
     * read in scope is found whatever the receiver, and this allowlist names
     * the `<file>::<receiver>` pairs that are legitimate.
     *
     * It used to enumerate six receiver NAMES (`entry`, `adoption`,
     * `manifest`, `legacy`, `existing*`, `ownership`) and so missed
     * `record.sourcePath`, `data.sourcePath`, `prev.sourcePath` and
     * `const { sourcePath } = entry` — with `StoreProjectRecord` the shape a
     * future reader most naturally binds to a variable called `record`, the
     * likeliest next offender sat squarely in the miss set. It also never saw
     * `input.sourcePath`, which is why that pair had to be justified when the
     * guard was inverted.
     */
    const RECORDED_PATH_ALLOWLIST: Record<string, string> = {
      'src/core/store/membership.ts::adoption':
        'reports shared_metadata_contains_local_path; the value never reaches behavior',
      'src/core/store/migration-ops.ts::input':
        "adopt's caller-supplied source directory — a runtime argument of this invocation, never a path read back out of Git-shared data",
    };

    /**
     * The scope, DERIVED from the source: the store subsystem, plus any file
     * naming the legacy adoption vocabulary, plus anything the OLD
     * receiver-name pattern matched — so the inverted guard is a provable
     * superset of the one it replaces. A `.sourcePath` on a workflow
     * definition elsewhere in `src/` is a different property of a different
     * thing and needs no justification here.
     */
    const ADOPTION_VOCABULARY =
      /\bAdoptionEntry\b|adoptions\.yaml|\breadAdoptionsManifest\b|\bupsertAdoptionEntry\b|\bgetAdoptionsManifestPath\b/u;
    const LEGACY_RECORDED_PATH_SHAPE =
      /(?:^|[^\w$])(?:entry|adoption|manifest|legacy|existing[\w$]*|ownership)\s*\??\.\s*sourcePath\b/u;

    /** `<file>::<receiver>` for every recorded-path read in scope. */
    function recordedPathReads(): string[] {
      const reads: string[] = [];
      for (const file of sourceFiles(repoRoot)) {
        const source = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
        const code = withoutComments(source);
        const inScope =
          file.startsWith('src/core/store/') ||
          ADOPTION_VOCABULARY.test(code) ||
          LEGACY_RECORDED_PATH_SHAPE.test(code);
        if (!inScope) continue;
        for (const receiver of propertyReceivers(source, 'sourcePath')) {
          reads.push(`${file}::${receiver}`);
        }
      }
      return reads;
    }

    it('reads a recorded source path nowhere except to report it', () => {
      const reads = recordedPathReads();
      const offenders = reads.filter((read) => RECORDED_PATH_ALLOWLIST[read] === undefined);
      expect(
        offenders,
        'A path recorded at adoption time belongs to the machine that ran it. Reading it for behavior is the defect eject stopped having. Justify a new read in RECORDED_PATH_ALLOWLIST.'
      ).toEqual([]);

      // The allowlist cannot rot into pairs that no longer read it — a stale
      // entry is how the next real read hides behind an old justification.
      expect(Object.keys(RECORDED_PATH_ALLOWLIST).filter((pair) => !reads.includes(pair))).toEqual(
        []
      );
    });

    it('catches the recorded-path spellings a receiver-name match missed', () => {
      for (const [spelling, receiver] of [
        ['const p = entry.sourcePath;', 'entry'],
        ['const p = adoption?.sourcePath;', 'adoption'],
        ['const p = record.sourcePath;', 'record'],
        ['const p = data.sourcePath;', 'data'],
        ['const p = prev.sourcePath;', 'prev'],
        ['const { sourcePath } = entry;', 'entry'],
        ['const p = readAdoptionsManifest(root).sourcePath;', 'readAdoptionsManifest()'],
      ] as const) {
        expect(propertyReceivers(spelling, 'sourcePath'), spelling).toContain(receiver);
      }
    });

    it('leaves the legacy manifest writer with no production caller', () => {
      const callers = sourceFiles(repoRoot).filter(
        (file) =>
          file !== 'src/core/store/migration.ts' &&
          /\bupsertAdoptionEntry\b/u.test(
            withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf-8'))
          )
      );
      expect(callers, 'sourcePath is no longer written, so nothing writes the legacy entry').toEqual(
        []
      );
    });

    it('never infers a destination from a remote or a display name', () => {
      const source = withoutComments(
        fs.readFileSync(path.join(repoRoot, 'src', 'core', 'store', 'migration-ops.ts'), 'utf-8')
      );
      // Sliced at the function's own boundary — the next top-level `export`.
      // Section-marker comments are not usable here: `withoutComments` strips
      // them, and a segment that ran past the end of the function would assert
      // about somebody else's code.
      const start = source.indexOf('export async function resolveEjectDestination');
      const next = source.indexOf('\nexport ', start + 1);
      const resolver = source.slice(start, next === -1 ? source.length : next);
      expect(start).toBeGreaterThan(-1);
      expect(resolver).toContain('resolveEjectDestination');
      expect(resolver).not.toContain('migrateStoreMembership');
      expect(resolver).not.toMatch(/\bremote\b/u);
      // The registry is filtered by project IDENTITY, never by a display name.
      expect(resolver).toMatch(/entry\.projectId !== input\.projectId/u);
      // The single-candidate branch is the ONLY one that returns a candidate.
      expect(resolver.match(/candidates\[0\]/gu) ?? []).toHaveLength(1);
      expect(resolver).toMatch(/candidates\.length === 1/u);
    });
  });
});
