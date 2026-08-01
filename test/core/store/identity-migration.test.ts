import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  listStoreRegistryEntries,
  readOptionalStoreMetadataState,
  readStoreRegistryState,
  storeMetadataUid,
  writeStoreMetadataState,
  writeStoreRegistryState,
  type StoreMetadataState,
  type StoreRegistryState,
} from '../../../src/core/store/foundation.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { ensureOpenSpecRoot } from '../../../src/core/workspace-root.js';
import {
  readProjectConfig,
} from '../../../src/core/project-config.js';
import {
  _resetConfigDiagnosticDedup,
  type ConfigDiagnosticReporter,
} from '../../../src/core/config-diagnostics.js';
import {
  migrateAllStoreIdentities,
  formatStoreIdentityMigrationSummary,
} from '../../../src/core/store/identity-migration.js';
import { registerProject } from '../../../src/core/project-registry.js';

describe('migrateAllStoreIdentities', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    _resetConfigDiagnosticDedup();
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-id-migration-'))
    );
    dataDir = path.join(tempDir, 'machine-data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    _resetConfigDiagnosticDedup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Creates a store checkout with version-1 (identityless) metadata. */
  async function makeIdentitylessStore(name: string): Promise<string> {
    const storeRoot = path.join(tempDir, name);
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, {
      version: 1,
      id: name,
    });
    return storeRoot;
  }

  /** Creates a store checkout with version-2 (identified) metadata. */
  async function makeIdentifiedStore(name: string, uid: string): Promise<string> {
    const storeRoot = path.join(tempDir, name);
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid,
      id: name,
    });
    return storeRoot;
  }

  async function register(id: string, storeRoot: string): Promise<void> {
    await registerStore({ id, localPath: storeRoot, globalDataDir: dataDir });
  }

  function writeProjectConfig(projectRoot: string, body: string): void {
    const dir = path.join(projectRoot, 'rasen');
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.yaml'), body);
  }

  // -------------------------------------------------------------------------
  // HARD ACCEPTANCE TEST
  // -------------------------------------------------------------------------

  it('migrates all identityless stores, backfills hints, and silences the warning', async () => {
    // 2 identityless stores + 1 identified store.
    const storeA = await makeIdentitylessStore('store-a');
    const storeB = await makeIdentitylessStore('store-b');
    const uidC = '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7';
    const storeC = await makeIdentifiedStore('store-c', uidC);

    await register('store-a', storeA);
    await register('store-b', storeB);
    await register('store-c', storeC);

    // A registered project with identityless storeMemberships entries.
    const projectRoot = path.join(tempDir, 'project');
    writeProjectConfig(
      projectRoot,
      [
        'schema: spec-driven',
        'storeMemberships:',
        '  - id: store-a',
        '  - id: store-b',
        '',
      ].join('\n')
    );
    await registerProject(
      {
        projectRoot,
        projectId: 'test-project',
        mode: 'in-repo',
      },
      { globalDataDir: dataDir }
    );

    // Before migration: warning fires.
    const warningsBefore: string[] = [];
    const reporterBefore: ConfigDiagnosticReporter = (d) => {
      if (d.key === 'storeMembershipsWithoutIdentity') warningsBefore.push(d.fallback);
    };
    readProjectConfig(projectRoot, { reporter: reporterBefore });
    expect(warningsBefore.length).toBeGreaterThan(0);

    // Run the migration.
    _resetConfigDiagnosticDedup();
    const result = await migrateAllStoreIdentities({
      apply: true,
      globalDataDir: dataDir,
    });

    // Both stores gained uids in their .rasen-store/store.yaml.
    const metaA = await readOptionalStoreMetadataState(storeA);
    const metaB = await readOptionalStoreMetadataState(storeB);
    expect(storeMetadataUid(metaA)).toBeDefined();
    expect(storeMetadataUid(metaB)).toBeDefined();
    expect(metaA?.version).toBe(2);
    expect(metaB?.version).toBe(2);

    // The identified store is unchanged.
    const metaC = await readOptionalStoreMetadataState(storeC);
    expect(storeMetadataUid(metaC)).toBe(uidC);

    // Project storeMemberships entries now carry uids.
    _resetConfigDiagnosticDedup();
    const config = readProjectConfig(projectRoot);
    expect(config?.storeMemberships).toBeDefined();
    expect(config?.storeMemberships).toHaveLength(2);
    for (const hint of config!.storeMemberships!) {
      expect(hint.uid).toBeDefined();
    }

    // HARD GATE: warning does NOT fire after migration.
    const warningsAfter: string[] = [];
    const reporterAfter: ConfigDiagnosticReporter = (d) => {
      if (d.key === 'storeMembershipsWithoutIdentity') warningsAfter.push(d.fallback);
    };
    _resetConfigDiagnosticDedup();
    readProjectConfig(projectRoot, { reporter: reporterAfter });
    expect(warningsAfter).toEqual([]);

    // Registry is re-keyed to v2.
    expect(result.registryRekeyed).toBe(true);
    expect(result.registryBlockedBy).toEqual([]);
    const registry = await readStoreRegistryState({ globalDataDir: dataDir });
    expect(registry?.version).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Unresolvable store
  // -------------------------------------------------------------------------

  it('skips a store whose path does not exist and reports it as blocking', async () => {
    const storeA = await makeIdentitylessStore('store-a');
    await register('store-a', storeA);

    // Write a ghost store entry directly into the registry (registerStore
    // validates that the path exists, so we bypass it for this test).
    const ghostPath = path.join(tempDir, 'ghost-store');
    const registry = await readStoreRegistryState({ globalDataDir: dataDir });
    expect(registry).not.toBeNull();
    await writeStoreRegistryState(
      {
        version: registry!.version,
        stores: {
          ...registry!.stores,
          'ghost-store': {
            backend: { type: 'git', local_path: ghostPath },
          },
        },
      },
      { globalDataDir: dataDir }
    );

    const result = await migrateAllStoreIdentities({
      apply: true,
      globalDataDir: dataDir,
    });

    // store-a was upgraded.
    const storeAResult = result.stores.find((s) => s.id === 'store-a');
    expect(storeAResult?.status).toBe('upgraded');

    // ghost-store was skipped.
    const ghostResult = result.stores.find((s) => s.id === 'ghost-store');
    expect(ghostResult?.status).toBe('skipped');
    expect(ghostResult?.reason).toContain('path missing');

    // Re-key is blocked by ghost-store.
    expect(result.registryRekeyed).toBe(false);
    expect(result.registryBlockedBy).toContain('ghost-store');
  });

  // -------------------------------------------------------------------------
  // already-had-identity store hints backfilled (Major-1 regression)
  // -------------------------------------------------------------------------

  it('backfills hints for stores that already have an identity', async () => {
    // An already-identified store — metadata carries a uid.
    const uidExisting = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const identifiedStore = await makeIdentifiedStore('identified-store', uidExisting);
    await register('identified-store', identifiedStore);

    // A project whose storeMemberships hint names the store by alias only
    // (identityless) — the warning fires today.
    const projectRoot = path.join(tempDir, 'project');
    writeProjectConfig(
      projectRoot,
      [
        'schema: spec-driven',
        'storeMemberships:',
        '  - id: identified-store',
        '',
      ].join('\n')
    );
    await registerProject(
      { projectRoot, projectId: 'test-project', mode: 'in-repo' },
      { globalDataDir: dataDir }
    );

    // Before migration: warning fires.
    const warningsBefore: string[] = [];
    const reporterBefore: ConfigDiagnosticReporter = (d) => {
      if (d.key === 'storeMembershipsWithoutIdentity') warningsBefore.push(d.fallback);
    };
    readProjectConfig(projectRoot, { reporter: reporterBefore });
    expect(warningsBefore.length).toBeGreaterThan(0);

    _resetConfigDiagnosticDedup();
    const result = await migrateAllStoreIdentities({
      apply: true,
      globalDataDir: dataDir,
    });

    // The store was 'already-had-identity' (not upgraded).
    const storeResult = result.stores.find((s) => s.id === 'identified-store');
    expect(storeResult?.status).toBe('already-had-identity');

    // The project's hint now carries the uid.
    const config = readProjectConfig(projectRoot);
    expect(config?.storeMemberships).toEqual([
      { uid: uidExisting, id: 'identified-store' },
    ]);

    // HARD GATE: warning does NOT fire after migration.
    const warningsAfter: string[] = [];
    const reporterAfter: ConfigDiagnosticReporter = (d) => {
      if (d.key === 'storeMembershipsWithoutIdentity') warningsAfter.push(d.fallback);
    };
    _resetConfigDiagnosticDedup();
    readProjectConfig(projectRoot, { reporter: reporterAfter });
    expect(warningsAfter).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Preview mode
  // -------------------------------------------------------------------------

  it('previews without writing when apply is false', async () => {
    const storeA = await makeIdentitylessStore('store-a');
    await register('store-a', storeA);

    const result = await migrateAllStoreIdentities({
      apply: false,
      globalDataDir: dataDir,
    });

    expect(result.applied).toBe(false);
    const storeResult = result.stores.find((s) => s.id === 'store-a');
    expect(storeResult?.status).toBe('upgraded');
    expect(storeResult?.filesToCommit).toEqual([]);

    // Nothing was actually written.
    const meta = await readOptionalStoreMetadataState(storeA);
    expect(storeMetadataUid(meta)).toBeUndefined();
    expect(meta?.version).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Idempotent
  // -------------------------------------------------------------------------

  it('is idempotent: second run reports all as already-had-identity', async () => {
    const storeA = await makeIdentitylessStore('store-a');
    await register('store-a', storeA);

    // First run.
    await migrateAllStoreIdentities({ apply: true, globalDataDir: dataDir });

    // Second run.
    const result = await migrateAllStoreIdentities({ apply: true, globalDataDir: dataDir });
    const storeResult = result.stores.find((s) => s.id === 'store-a');
    expect(storeResult?.status).toBe('already-had-identity');
  });

  // -------------------------------------------------------------------------
  // Empty registry
  // -------------------------------------------------------------------------

  it('returns empty result when no registry exists', async () => {
    const result = await migrateAllStoreIdentities({
      apply: true,
      globalDataDir: dataDir,
    });

    expect(result.stores).toEqual([]);
    expect(result.registryRekeyed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Dogfood fixture
  // -------------------------------------------------------------------------

  it('upgrades a store with readable metadata at a real path (no special-casing)', async () => {
    // Simulates a dogfood fixture: a real checkout with readable metadata.
    const fixtureRoot = await makeIdentitylessStore('dogfood-fixture');
    await register('dogfood-fixture', fixtureRoot);

    const result = await migrateAllStoreIdentities({
      apply: true,
      globalDataDir: dataDir,
    });

    const fixtureResult = result.stores.find((s) => s.id === 'dogfood-fixture');
    expect(fixtureResult?.status).toBe('upgraded');
    expect(fixtureResult?.uid).toBeDefined();

    const meta = await readOptionalStoreMetadataState(fixtureRoot);
    expect(storeMetadataUid(meta)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Summary formatting (locale-sensitive — pin RASEN_LANG=en)
  // -------------------------------------------------------------------------

  describe('summary formatting', () => {
    let savedLang: string | undefined;

    beforeEach(() => {
      savedLang = process.env.RASEN_LANG;
      process.env.RASEN_LANG = 'en';
    });

    afterEach(() => {
      if (savedLang === undefined) delete process.env.RASEN_LANG;
      else process.env.RASEN_LANG = savedLang;
    });

    it('formats a human-readable summary', () => {
      const result = {
        applied: true,
        stores: [
          { id: 'store-a', root: '/tmp/a', uid: 'uid-a', status: 'upgraded' as const, filesToCommit: ['.rasen-store/store.yaml'] },
          { id: 'store-b', root: '/tmp/b', uid: 'uid-b', status: 'already-had-identity' as const, filesToCommit: [] },
          { id: 'ghost', root: '/tmp/ghost', uid: '', status: 'skipped' as const, reason: 'path missing', filesToCommit: [] },
        ],
        projects: [],
        registryRekeyed: false,
        registryBlockedBy: ['ghost'],
        suggestedCommits: [],
      };

      const lines = formatStoreIdentityMigrationSummary(result);
      expect(lines.join('\n')).toContain('Upgraded 1 store(s)');
      expect(lines.join('\n')).toContain('store-a');
      expect(lines.join('\n')).toContain('already carry a permanent identity');
      expect(lines.join('\n')).toContain('Skipped 1 store(s)');
      expect(lines.join('\n')).toContain('ghost (path missing)');
      expect(lines.join('\n')).toContain('Registry re-key blocked by: ghost');
    });

    it('summary is a single line when nothing needed migration', () => {
      const lines = formatStoreIdentityMigrationSummary({
        applied: true,
        stores: [
          { id: 'store-a', root: '/tmp/a', uid: 'uid-a', status: 'already-had-identity' as const, filesToCommit: [] },
        ],
        projects: [],
        registryRekeyed: true,
        registryBlockedBy: [],
        suggestedCommits: [],
      });

      expect(lines).toEqual(['All registered stores carry a permanent identity.']);
    });
  });
});
