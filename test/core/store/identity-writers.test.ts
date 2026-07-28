import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getStoreMetadataPath,
  getStoreRegistryPath,
  parseStoreMetadataState,
  readStoreRegistryState,
  storeMetadataUid,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { commitStoreRegistration, registerStore } from '../../../src/core/store/registry.js';
import { resolveStoreBinding } from '../../../src/core/store/identity.js';
import { setupStore, listStores, doctorStores } from '../../../src/core/store/operations.js';
import { upgradeStoreIdentity } from '../../../src/core/store/upgrade-identity.js';
import { readStorePointer } from '../../../src/core/project-config.js';
import { ensureOpenSpecRoot } from '../../../src/core/workspace-root.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';

const UID_OTHER = '2c9f0d1a-4b7e-4a2f-9c31-77a5b0e6d4f1';

describe('store identity writers', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-identity-writers-'));
    dataDir = path.join(tempDir, 'machine-data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.XDG_DATA_HOME = dataDir;
    delete process.env.RASEN_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function makeLegacyStore(name: string, id: string): Promise<string> {
    const storeRoot = path.join(tempDir, name);
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, { version: 1, id });
    return storeRoot;
  }

  function writeProjectConfig(projectRoot: string, body: string): string {
    const dir = path.join(projectRoot, 'rasen');
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, body);
    return configPath;
  }

  // -------------------------------------------------------------------- 4.1

  it('mints a permanent identity when a NEW store is created', async () => {
    const result = await setupStore({
      id: 'fresh-store',
      path: path.join(tempDir, 'fresh-store'),
      initGit: false,
    });

    const metadata = parseStoreMetadataState(
      fs.readFileSync(getStoreMetadataPath(result.store.root), 'utf-8')
    );
    expect(metadata.version).toBe(2);
    expect(storeMetadataUid(metadata)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const listed = (await listStores()).stores.find((store) => store.id === 'fresh-store');
    expect(listed?.uid).toBe(storeMetadataUid(metadata));
  });

  it('warns when a newly created store is given an all-digit name', async () => {
    const result = await setupStore({
      id: '2026',
      path: path.join(tempDir, '2026'),
      initGit: false,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain('store_alias_numeric');
  });

  it('leaves an existing all-digit name quiet', async () => {
    const storeRoot = await makeLegacyStore('numeric', '2026');
    // No explicit globalDataDir: doctorStores reads the machine default, which
    // XDG_DATA_HOME points at the temp directory for this test.
    await registerStore({ id: '2026', localPath: storeRoot });
    const doctor = await doctorStores('2026');
    expect(doctor.stores[0]?.diagnostics.map((d) => d.code)).not.toContain('store_alias_numeric');
  });

  // -------------------------------------------------------------------- 4.2

  it('never mints an identity when registering an existing checkout', async () => {
    const storeRoot = await makeLegacyStore('existing', 'existing-store');
    await registerStore({ id: 'existing-store', localPath: storeRoot, globalDataDir: dataDir });

    const metadata = parseStoreMetadataState(
      fs.readFileSync(getStoreMetadataPath(storeRoot), 'utf-8')
    );
    expect(metadata.version).toBe(1);
    expect(storeMetadataUid(metadata)).toBeUndefined();
  });

  // --------------------------------------------------------------- 4.3, 5.1

  it('a permanent-identity mismatch writes nothing at all', async () => {
    const storeRoot = await makeLegacyStore('mismatch', 'mismatch-store');
    await registerStore({ id: 'mismatch-store', localPath: storeRoot, globalDataDir: dataDir });

    const registryPath = getStoreRegistryPath({ globalDataDir: dataDir });
    const registryBefore = fs.readFileSync(registryPath, 'utf-8');
    const metadataPath = getStoreMetadataPath(storeRoot);
    const metadataBefore = fs.readFileSync(metadataPath, 'utf-8');
    const metadataMtimeBefore = fs.statSync(metadataPath).mtimeMs;
    const treeBefore = snapshotDirectory(tempDir);

    await expect(
      commitStoreRegistration({
        id: 'mismatch-store',
        backend: { type: 'git', local_path: storeRoot },
        writeMetadataIfMissing: true,
        expectedUid: UID_OTHER,
        globalDataDir: dataDir,
      })
    ).rejects.toThrow(/store identity/i);

    expect(fs.readFileSync(registryPath, 'utf-8')).toBe(registryBefore);
    expect(fs.readFileSync(metadataPath, 'utf-8')).toBe(metadataBefore);
    expect(fs.statSync(metadataPath).mtimeMs).toBe(metadataMtimeBefore);
    expect(snapshotDirectory(tempDir)).toEqual(treeBefore);
  });

  it('a mismatch against a checkout with no metadata creates none', async () => {
    const storeRoot = path.join(tempDir, 'no-metadata');
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    const treeBefore = snapshotDirectory(tempDir);

    await expect(
      commitStoreRegistration({
        id: 'no-metadata',
        backend: { type: 'git', local_path: storeRoot },
        writeMetadataIfMissing: true,
        expectedUid: UID_OTHER,
        globalDataDir: dataDir,
      })
    ).rejects.toThrow(/store identity/i);

    expect(fs.existsSync(getStoreMetadataPath(storeRoot))).toBe(false);
    expect(snapshotDirectory(tempDir)).toEqual(treeBefore);
  });

  // --------------------------------------------------------------- 4.4, 5.10

  it('previews the upgrade without writing anything', async () => {
    const storeRoot = await makeLegacyStore('preview', 'preview-store');
    await registerStore({ id: 'preview-store', localPath: storeRoot, globalDataDir: dataDir });
    const projectRoot = path.join(tempDir, 'preview-project');
    writeProjectConfig(projectRoot, 'schema: spec-driven\nstore: preview-store\n');

    const treeBefore = snapshotDirectory(tempDir);
    const plan = await upgradeStoreIdentity({
      id: 'preview-store',
      projectRoot,
      globalDataDir: dataDir,
    });

    expect(plan.applied).toBe(false);
    expect(plan.steps.map((step) => step.target)).toEqual([
      'store-metadata',
      'registry',
      'project-pointer',
    ]);
    expect(plan.steps.every((step) => step.path.length > 0)).toBe(true);
    expect(snapshotDirectory(tempDir)).toEqual(treeBefore);
  });

  it('applies the plan the preview described, and is idempotent', async () => {
    const storeRoot = await makeLegacyStore('apply', 'apply-store');
    await registerStore({ id: 'apply-store', localPath: storeRoot, globalDataDir: dataDir });
    const projectRoot = path.join(tempDir, 'apply-project');
    const configPath = writeProjectConfig(
      projectRoot,
      '# keep this comment\nschema: spec-driven\nstore: apply-store\n'
    );

    const plan = await upgradeStoreIdentity({
      id: 'apply-store',
      projectRoot,
      globalDataDir: dataDir,
    });
    const applied = await upgradeStoreIdentity({
      id: 'apply-store',
      projectRoot,
      apply: true,
      globalDataDir: dataDir,
    });

    expect(applied.applied).toBe(true);
    expect(applied.repairNeeded).toEqual([]);
    expect(applied.filesToCommit.length).toBeGreaterThan(0);
    expect(plan.steps.map((step) => step.target)).toEqual(
      applied.steps.map((step) => step.target)
    );

    const metadata = parseStoreMetadataState(
      fs.readFileSync(getStoreMetadataPath(storeRoot), 'utf-8')
    );
    expect(metadata.version).toBe(2);
    const uid = storeMetadataUid(metadata);
    expect(uid).toBe(applied.store.uid);

    // The project's declaration now names the identity, and the rest of the
    // file (including comments) survived.
    const configText = fs.readFileSync(configPath, 'utf-8');
    expect(configText).toContain('# keep this comment');
    const pointer = readStorePointer(projectRoot);
    expect(pointer.shape).toBe('durable');
    expect(pointer.durable?.uid).toBe(uid);
    expect(pointer.durable?.id).toBe('apply-store');

    // The machine registry is now keyed by permanent identity.
    const registry = await readStoreRegistryState({ globalDataDir: dataDir });
    expect(registry?.version).toBe(2);
    expect(Object.keys(registry!.stores)).toEqual([uid]);

    const second = await upgradeStoreIdentity({
      id: 'apply-store',
      projectRoot,
      apply: true,
      globalDataDir: dataDir,
    });
    expect(second.store.uid).toBe(uid);
    expect(
      parseStoreMetadataState(fs.readFileSync(getStoreMetadataPath(storeRoot), 'utf-8'))
    ).toEqual(metadata);
  });

  // -------------------------------------------------------------------- 5.8

  it('writes no machine path into the store metadata or the project declaration', async () => {
    const storeRoot = await makeLegacyStore('shared', 'shared-store');
    await registerStore({ id: 'shared-store', localPath: storeRoot, globalDataDir: dataDir });
    const projectRoot = path.join(tempDir, 'shared-project');
    writeProjectConfig(projectRoot, 'schema: spec-driven\nstore: shared-store\n');

    await upgradeStoreIdentity({
      id: 'shared-store',
      projectRoot,
      apply: true,
      globalDataDir: dataDir,
    });

    const metadata = parseStoreMetadataState(
      fs.readFileSync(getStoreMetadataPath(storeRoot), 'utf-8')
    ) as Record<string, unknown>;
    for (const value of Object.values(metadata)) {
      if (typeof value !== 'string') continue;
      expect(path.isAbsolute(value)).toBe(false);
    }

    const declaration = readStorePointer(projectRoot).durable ?? {};
    for (const value of Object.values(declaration)) {
      if (typeof value !== 'string') continue;
      expect(path.isAbsolute(value)).toBe(false);
    }
  });

  // -------------------------------------------------------------------- 4.6

  it('renaming the display name keeps the identity and every identity-bearing declaration', async () => {
    const setup = await setupStore({
      id: 'before-rename',
      path: path.join(tempDir, 'renamed'),
      initGit: false,
    });
    const storeRoot = setup.store.root;
    const uid = storeMetadataUid(
      parseStoreMetadataState(fs.readFileSync(getStoreMetadataPath(storeRoot), 'utf-8'))
    );
    expect(uid).toBeDefined();

    // The user renames the store in its own (committed) metadata, then
    // re-registers the same checkout.
    await writeStoreMetadataState(storeRoot, { version: 2, uid: uid!, id: 'after-rename' });
    await registerStore({ id: 'after-rename', localPath: storeRoot, globalDataDir: dataDir });

    const registry = await readStoreRegistryState({ globalDataDir: dataDir });
    expect(registry?.version).toBe(2);
    expect(Object.keys(registry!.stores)).toEqual([uid]);
    expect(registry!.stores[uid!]?.id).toBe('after-rename');

    // A declaration naming the identity still resolves; one naming the OLD
    // display name honestly reports that the name no longer identifies it.
    const byIdentity = await resolveStoreBinding({
      declaration: { form: 'durable', uid: uid!, id: 'before-rename' },
      globalDataDir: dataDir,
    });
    expect(byIdentity.kind).toBe('resolved');

    const byOldAlias = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'before-rename' },
      globalDataDir: dataDir,
    });
    expect(byOldAlias.kind).toBe('unavailable');
    if (byOldAlias.kind !== 'unavailable') return;
    expect(byOldAlias.reason).toBe('not-registered');
  });

  // -------------------------------------------------------------------- 5.5

  it('keeps a fully legacy installation working end to end', async () => {
    const storeRoot = await makeLegacyStore('all-legacy', 'legacy-store');
    await registerStore({ id: 'legacy-store', localPath: storeRoot, globalDataDir: dataDir });
    const projectRoot = path.join(tempDir, 'legacy-project');
    writeProjectConfig(projectRoot, 'schema: spec-driven\nstore: legacy-store\n');

    const registry = await readStoreRegistryState({ globalDataDir: dataDir });
    expect(registry?.version).toBe(1);

    const resolution = await resolveStoreBinding({
      declaration: { form: 'alias', id: 'legacy-store' },
      projectRoot,
      globalDataDir: dataDir,
    });
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') return;
    expect(resolution.store.uid).toBeUndefined();
    expect(resolution.diagnostics.map((d) => d.code).sort()).toEqual([
      'store_metadata_legacy',
      'store_pointer_legacy',
    ]);
  });
});
