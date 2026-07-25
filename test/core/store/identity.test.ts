import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  findRegistryEntryByUid,
  getStoreMetadataPath,
  getStoreRegistryPath,
  listStoreRegistryEntries,
  parseRegistryKey,
  parseStoreMetadataState,
  parseStoreRegistryState,
  readStoreRegistryState,
  registryKeyFor,
  serializeStoreMetadataState,
  serializeStoreRegistryState,
  storeMetadataUid,
  upgradeStoreRegistryToV2,
  writeStoreMetadataState,
  writeStoreRegistryState,
  type StoreRegistryState,
} from '../../../src/core/store/foundation.js';
import {
  isAllDigitAlias,
  isValidStoreUid,
  mintStoreUid,
  normalizeStoreUid,
  storeUidsMatch,
} from '../../../src/core/store/identity-types.js';
import {
  assertCredentialFreeRemote,
  redactRemote,
  remoteCarriesCredentials,
} from '../../../src/core/store/remote.js';
import {
  resolveStoreBinding,
  type StoreBindingResolution,
} from '../../../src/core/store/identity.js';
import { readStorePointer } from '../../../src/core/project-config.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { ensureOpenSpecRoot } from '../../../src/core/workspace-root.js';
import { snapshotDirectory } from '../../helpers/fs-snapshot.js';

const UID_A = '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7';
const UID_B = '2c9f0d1a-4b7e-4a2f-9c31-77a5b0e6d4f1';

describe('store identity', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-identity-'));
    dataDir = path.join(tempDir, 'machine-data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** A healthy store checkout carrying the metadata version under test. */
  async function makeStore(
    name: string,
    metadata: { id: string; uid?: string; remote?: string }
  ): Promise<string> {
    const storeRoot = path.join(tempDir, name);
    fs.mkdirSync(storeRoot, { recursive: true });
    await ensureOpenSpecRoot(storeRoot);
    await writeStoreMetadataState(
      storeRoot,
      metadata.uid
        ? {
            version: 2,
            uid: metadata.uid,
            id: metadata.id,
            ...(metadata.remote !== undefined ? { remote: metadata.remote } : {}),
          }
        : {
            version: 1,
            id: metadata.id,
            ...(metadata.remote !== undefined ? { remote: metadata.remote } : {}),
          }
    );
    return storeRoot;
  }

  async function register(id: string, storeRoot: string): Promise<void> {
    await registerStore({ id, localPath: storeRoot, globalDataDir: dataDir });
  }

  function writeProjectConfig(projectRoot: string, body: string): string {
    const dir = path.join(projectRoot, 'rasen');
    fs.mkdirSync(path.join(dir, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, body);
    return configPath;
  }

  // ---------------------------------------------------------------- 1.1–1.2

  describe('permanent identity helpers', () => {
    it('mints an RFC 4122 identity and accepts any textual form', () => {
      const minted = mintStoreUid();
      expect(isValidStoreUid(minted)).toBe(true);
      expect(isValidStoreUid(UID_A.toUpperCase())).toBe(true);
      expect(isValidStoreUid(`  ${UID_A}  `)).toBe(true);
    });

    it('rejects junk rather than treating it as an opaque identity', () => {
      expect(isValidStoreUid('not-a-uuid')).toBe(false);
      expect(isValidStoreUid('')).toBe(false);
      expect(isValidStoreUid(42)).toBe(false);
      expect(isValidStoreUid(undefined)).toBe(false);
    });

    it('compares identities after trim + lowercase', () => {
      expect(storeUidsMatch(UID_A, ` ${UID_A.toUpperCase()} `)).toBe(true);
      expect(storeUidsMatch(UID_A, UID_B)).toBe(false);
      expect(storeUidsMatch(undefined, UID_A)).toBe(false);
      expect(normalizeStoreUid(` ${UID_A.toUpperCase()} `)).toBe(UID_A);
    });

    it('flags an all-digit alias', () => {
      expect(isAllDigitAlias('2026')).toBe(true);
      expect(isAllDigitAlias('team-2026')).toBe(false);
    });
  });

  // -------------------------------------------------------------------- 1.3

  describe('store metadata schema', () => {
    it('round-trips v1 metadata unchanged', () => {
      const yaml = 'version: 1\nid: legacy-store\n';
      const parsed = parseStoreMetadataState(yaml);
      expect(parsed).toEqual({ version: 1, id: 'legacy-store' });
      expect(storeMetadataUid(parsed)).toBeUndefined();
      expect(serializeStoreMetadataState(parsed)).toBe(yaml);
    });

    it('round-trips v2 metadata carrying the permanent identity', () => {
      const yaml = `version: 2\nuid: ${UID_A}\nid: team-store\nremote: https://example.test/team.git\n`;
      const parsed = parseStoreMetadataState(yaml);
      expect(parsed).toEqual({
        version: 2,
        uid: UID_A,
        id: 'team-store',
        remote: 'https://example.test/team.git',
      });
      expect(storeMetadataUid(parsed)).toBe(UID_A);
      expect(serializeStoreMetadataState(parsed)).toBe(yaml);
    });

    it('reports a malformed identity instead of accepting it', () => {
      expect(() => parseStoreMetadataState('version: 2\nuid: nope\nid: team-store\n')).toThrow(
        /well-formed permanent store identity/
      );
    });

    it('rejects an unknown metadata key rather than tolerating it', () => {
      expect(() =>
        parseStoreMetadataState(`version: 2\nuid: ${UID_A}\nid: team\nextra: 1\n`)
      ).toThrow(/Invalid store metadata state/);
    });
  });

  // --------------------------------------------------------------- 1.4–1.5

  describe('registry schema and key grammar', () => {
    it('reads a v1 registry with alias keys unchanged', () => {
      const yaml =
        'version: 1\nstores:\n  team-store:\n    backend:\n      type: git\n      local_path: /tmp/team\n';
      const parsed = parseStoreRegistryState(yaml);
      expect(parsed.version).toBe(1);
      expect(listStoreRegistryEntries(parsed)).toEqual([
        {
          id: 'team-store',
          type: 'store',
          backend: { type: 'git', local_path: '/tmp/team' },
        },
      ]);
      expect(serializeStoreRegistryState(parsed)).toBe(yaml);
    });

    it('reads a v2 registry keyed by permanent identity', () => {
      const yaml = `version: 2\nstores:\n  ${UID_A}:\n    id: team-store\n    backend:\n      type: git\n      local_path: /tmp/team\n`;
      const parsed = parseStoreRegistryState(yaml);
      expect(parsed.version).toBe(2);
      expect(listStoreRegistryEntries(parsed)).toEqual([
        {
          id: 'team-store',
          type: 'store',
          uid: UID_A,
          backend: { type: 'git', local_path: '/tmp/team' },
        },
      ]);
      expect(findRegistryEntryByUid(parsed, UID_A.toUpperCase())?.id).toBe('team-store');
    });

    it('chooses the key grammar from the file version, never the key text', () => {
      expect(parseRegistryKey('team-store', 1)).toEqual({ type: 'store', id: 'team-store' });
      expect(parseRegistryKey(UID_A, 2)).toEqual({ type: 'store', uid: UID_A });
      expect(parseRegistryKey('project:elftia', 1)).toEqual({ type: 'project', id: 'elftia' });
      expect(parseRegistryKey('project:elftia', 2)).toEqual({ type: 'project', id: 'elftia' });
      expect(registryKeyFor('store', 'team-store')).toBe('team-store');
      expect(registryKeyFor('store', 'team-store', { version: 2, uid: UID_A })).toBe(UID_A);
      expect(registryKeyFor('project', 'elftia', { version: 2 })).toBe('project:elftia');
    });

    it('rejects a v2 store key that is not a permanent identity', () => {
      expect(() =>
        parseStoreRegistryState(
          'version: 2\nstores:\n  team-store:\n    id: team-store\n    backend:\n      type: git\n      local_path: /tmp/team\n'
        )
      ).toThrow(/version 2 store key must be a permanent store identity/);
    });

    it('rejects a v2 store entry with no display alias', () => {
      expect(() =>
        parseStoreRegistryState(
          `version: 2\nstores:\n  ${UID_A}:\n    backend:\n      type: git\n      local_path: /tmp/team\n`
        )
      ).toThrow(/must carry its display alias/);
    });

    it('keeps project entries alias-keyed in both versions', () => {
      const yaml = `version: 2\nstores:\n  project:elftia:\n    type: project\n    backend:\n      type: git\n      local_path: /tmp/elftia\n`;
      const parsed = parseStoreRegistryState(yaml);
      expect(listStoreRegistryEntries(parsed)).toEqual([
        {
          id: 'elftia',
          type: 'project',
          backend: { type: 'git', local_path: '/tmp/elftia' },
        },
      ]);
    });

    it('refuses the v2 rewrite and names the entries that block it', async () => {
      const legacyRoot = await makeStore('legacy', { id: 'legacy-store' });
      const state: StoreRegistryState = {
        version: 1,
        stores: {
          'legacy-store': { backend: { type: 'git', local_path: legacyRoot } },
        },
      };
      const plan = await upgradeStoreRegistryToV2(state);
      expect(plan.upgraded).toBe(false);
      expect(plan.blockedBy).toEqual(['legacy-store']);
      expect(plan.state.version).toBe(1);
    });

    it('re-keys by permanent identity once every store entry has one', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store', uid: UID_A });
      const plan = await upgradeStoreRegistryToV2({
        version: 1,
        stores: {
          'team-store': { backend: { type: 'git', local_path: storeRoot } },
          'project:elftia': {
            type: 'project',
            backend: { type: 'git', local_path: path.join(tempDir, 'elftia') },
          },
        },
      });
      expect(plan.upgraded).toBe(true);
      expect(plan.state.version).toBe(2);
      expect(Object.keys(plan.state.stores).sort()).toEqual(
        [UID_A, 'project:elftia'].sort()
      );
      expect(plan.state.stores[UID_A]).toEqual({
        id: 'team-store',
        backend: { type: 'git', local_path: storeRoot },
      });
    });
  });

  // -------------------------------------------------------------------- 1.6

  describe('project store declaration', () => {
    it('reads the legacy single-name form', () => {
      const projectRoot = path.join(tempDir, 'legacy-pointer');
      const configPath = writeProjectConfig(projectRoot, 'schema: spec-driven\nstore: team-store\n');
      expect(readStorePointer(projectRoot)).toEqual({
        shape: 'alias',
        value: 'team-store',
        filePath: configPath,
      });
    });

    it('reads the durable object form', () => {
      const projectRoot = path.join(tempDir, 'durable-pointer');
      const configPath = writeProjectConfig(
        projectRoot,
        `schema: spec-driven\nstore:\n  uid: ${UID_A}\n  id: team-store\n  remote: https://example.test/team.git\n`
      );
      expect(readStorePointer(projectRoot)).toEqual({
        shape: 'durable',
        value: 'team-store',
        durable: {
          uid: UID_A,
          id: 'team-store',
          remote: 'https://example.test/team.git',
        },
        filePath: configPath,
      });
    });

    it('REPORTS a declaration with no usable identity instead of dropping it', () => {
      const projectRoot = path.join(tempDir, 'bad-pointer');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nstore:\n  id: team-store\n');
      const pointer = readStorePointer(projectRoot);
      expect(pointer.shape).toBe('malformed');
      expect(pointer.malformed).toBe('invalid_object');
    });

    it('REPORTS a non-string, non-object declaration', () => {
      const projectRoot = path.join(tempDir, 'numeric-pointer');
      writeProjectConfig(projectRoot, 'schema: spec-driven\nstore: 12\n');
      expect(readStorePointer(projectRoot).malformed).toBe('non_string');
    });

    it('reports no declaration as absent, not malformed', () => {
      const projectRoot = path.join(tempDir, 'no-pointer');
      writeProjectConfig(projectRoot, 'schema: spec-driven\n');
      expect(readStorePointer(projectRoot).shape).toBe('absent');
    });
  });

  // -------------------------------------------------------------------- 1.7

  describe('remote credentials', () => {
    it('rejects an embedded password or token', () => {
      expect(remoteCarriesCredentials('https://user:secret@example.test/team.git')).toBe(true);
      expect(remoteCarriesCredentials('https://ghp_token123@example.test/team.git')).toBe(true);
      expect(() => assertCredentialFreeRemote('https://user:secret@example.test/team.git')).toThrow(
        /embeds a credential/
      );
    });

    it('allows the ordinary SSH forms', () => {
      expect(remoteCarriesCredentials('git@github.com:acme/team.git')).toBe(false);
      expect(remoteCarriesCredentials('ssh://git@github.com/acme/team.git')).toBe(false);
      expect(remoteCarriesCredentials('https://example.test/team.git')).toBe(false);
      expect(() => assertCredentialFreeRemote('git@github.com:acme/team.git')).not.toThrow();
    });

    it('redacts a credential-bearing remote identically everywhere', () => {
      expect(redactRemote('https://user:secret@example.test/acme/team.git')).toBe(
        'https://<redacted>@example.test/acme/team.git'
      );
      expect(redactRemote('https://user:secret@example.test/acme/team.git')).not.toContain('secret');
      expect(redactRemote('git@github.com:acme/team.git')).toBe('git@github.com:acme/team.git');
    });

    it('never echoes the rejected value back in full', () => {
      let message = '';
      try {
        assertCredentialFreeRemote('https://user:hunter2@example.test/team.git');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain('hunter2');
      expect(message).toContain('<redacted>');
    });

    it('refuses to write a credential-bearing remote into store metadata', async () => {
      const storeRoot = path.join(tempDir, 'credential-store');
      fs.mkdirSync(storeRoot, { recursive: true });
      await ensureOpenSpecRoot(storeRoot);
      await expect(
        writeStoreMetadataState(storeRoot, {
          version: 2,
          uid: UID_A,
          id: 'team-store',
          remote: 'https://user:secret@example.test/team.git',
        })
      ).rejects.toThrow(/embeds a credential/);
      expect(fs.existsSync(getStoreMetadataPath(storeRoot))).toBe(false);
    });
  });

  // ------------------------------------------------------------------- 2.x

  describe('resolveStoreBinding', () => {
    it('resolves absent for a project that declares no store', async () => {
      const resolution = await resolveStoreBinding({
        declaration: { form: 'absent' },
        globalDataDir: dataDir,
      });
      expect(resolution).toEqual({ kind: 'absent' });
    });

    it('resolves by permanent identity and says so', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store', uid: UID_A });
      await register('team-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('resolved');
      if (resolution.kind !== 'resolved') return;
      expect(resolution.resolvedBy).toBe('uid');
      expect(resolution.store.uid).toBe(UID_A);
      expect(resolution.store.id).toBe('team-store');
      expect(resolution.diagnostics).toEqual([]);
    });

    it('reports alias drift as a warning without blocking', async () => {
      const storeRoot = await makeStore('platform', { id: 'platform-store', uid: UID_A });
      await register('platform-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('resolved');
      if (resolution.kind !== 'resolved') return;
      const drift = resolution.diagnostics.find((d) => d.code === 'store_pointer_alias_drift');
      expect(drift?.severity).toBe('warning');
      expect(drift?.message).toContain('team-store');
      expect(drift?.message).toContain('platform-store');
    });

    it('reports remote divergence as informational', async () => {
      const storeRoot = await makeStore('remote-store', {
        id: 'remote-store',
        uid: UID_A,
        remote: 'https://example.test/canonical.git',
      });
      await register('remote-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: {
          form: 'durable',
          uid: UID_A,
          id: 'remote-store',
          remote: 'https://example.test/mirror.git',
        },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('resolved');
      if (resolution.kind !== 'resolved') return;
      const note = resolution.diagnostics.find(
        (d) => d.code === 'store_pointer_remote_divergence'
      );
      expect(note?.severity).toBe('info');
      expect(note?.message).toContain('canonical.git');
      expect(note?.message).toContain('mirror.git');
    });

    it('resolves a legacy single-name declaration and offers the upgrade', async () => {
      const storeRoot = await makeStore('legacy', { id: 'legacy-store' });
      await register('legacy-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'alias', id: 'legacy-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('resolved');
      if (resolution.kind !== 'resolved') return;
      expect(resolution.resolvedBy).toBe('alias');
      expect(resolution.store.uid).toBeUndefined();
      const codes = resolution.diagnostics.map((d) => d.code).sort();
      expect(codes).toEqual(['store_metadata_legacy', 'store_pointer_legacy']);
      const legacy = resolution.diagnostics.find((d) => d.code === 'store_metadata_legacy');
      expect(legacy?.fix).toContain('rasen store upgrade-identity');
    });

    it('reports zero alias matches as not available on this machine', async () => {
      const resolution = await resolveStoreBinding({
        declaration: { form: 'alias', id: 'nowhere' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('not-registered');
      expect(resolution.diagnostics[0]?.code).toBe('store_bootstrap_required');
      expect(resolution.repair[0]).toContain('rasen store register');
    });

    it('names the declared remote in the repair when the store is not here', async () => {
      const resolution = await resolveStoreBinding({
        declaration: {
          form: 'durable',
          uid: UID_A,
          id: 'team-store',
          remote: 'https://example.test/team.git',
        },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('not-registered');
      expect(resolution.repair[0]).toContain('https://example.test/team.git');
    });

    it('reports several alias matches as ambiguous and picks none', async () => {
      const firstRoot = await makeStore('first', { id: 'shared', uid: UID_A });
      const secondRoot = await makeStore('second', { id: 'shared', uid: UID_B });
      await register('shared', firstRoot);
      await register('shared', secondRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'alias', id: 'shared' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('alias-ambiguous');
      expect(resolution.candidates).toHaveLength(2);
      expect(resolution.candidates?.map((c) => c.uid).sort()).toEqual([UID_A, UID_B].sort());
      expect(resolution.diagnostics[0]?.message).toContain(firstRoot);
      expect(resolution.diagnostics[0]?.message).toContain(secondRoot);
      expect(resolution.repair[0]).toContain('--uid');
    });

    it('fails closed when the registered checkout carries a different identity', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store', uid: UID_B });
      await register('team-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      // With no entry carrying UID_A the honest answer is "not here"; the
      // mismatch reason is reserved for a checkout that IS the named entry.
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('not-registered');
    });

    it('reports a uid mismatch when the named entry is not that store', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store', uid: UID_A });
      await register('team-store', storeRoot);
      // The checkout is re-pointed at a different store after registration.
      await writeStoreMetadataState(storeRoot, { version: 2, uid: UID_B, id: 'team-store' });

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('uid-mismatch');
      expect(resolution.diagnostics[0]?.code).toBe('store_uid_mismatch');
      expect(resolution.diagnostics[0]?.message).toContain(UID_A);
      expect(resolution.diagnostics[0]?.message).toContain(UID_B);
    });

    it('reports missing metadata distinctly', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store' });
      await register('team-store', storeRoot);
      fs.rmSync(getStoreMetadataPath(storeRoot));

      const resolution = await resolveStoreBinding({
        declaration: { form: 'alias', id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('metadata-missing');
    });

    it('reports an unhealthy store root distinctly', async () => {
      const storeRoot = await makeStore('team', { id: 'team-store' });
      await register('team-store', storeRoot);
      fs.rmSync(path.join(storeRoot, 'rasen'), { recursive: true, force: true });

      const resolution = await resolveStoreBinding({
        declaration: { form: 'alias', id: 'team-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('root-unhealthy');
    });

    it('reports an unreadable declaration distinctly', async () => {
      const resolution = await resolveStoreBinding({
        declaration: {
          form: 'malformed',
          problem: 'the config file could not be read as YAML',
          filePath: path.join(tempDir, 'project', 'rasen', 'config.yaml'),
        },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('unavailable');
      if (resolution.kind !== 'unavailable') return;
      expect(resolution.reason).toBe('pointer-malformed');
      expect(resolution.diagnostics[0]?.code).toBe('invalid_store_pointer');
    });

    it('never resolves a store root against its own declaration', async () => {
      const storeRoot = await makeStore('self', { id: 'self-store', uid: UID_A });
      await register('self-store', storeRoot);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'self-store' },
        projectRoot: storeRoot,
        globalDataDir: dataDir,
      });

      expect(resolution).toEqual({ kind: 'absent' });
    });

    it('performs zero writes on every path', async () => {
      const okRoot = await makeStore('ok', { id: 'ok-store', uid: UID_A });
      const legacyRoot = await makeStore('legacy', { id: 'legacy-store' });
      await register('ok-store', okRoot);
      await register('legacy-store', legacyRoot);

      const before = snapshotDirectory(tempDir);
      const declarations = [
        { form: 'absent' as const },
        { form: 'durable' as const, uid: UID_A, id: 'ok-store' },
        { form: 'durable' as const, uid: UID_B, id: 'ghost' },
        { form: 'alias' as const, id: 'legacy-store' },
        { form: 'alias' as const, id: 'nowhere' },
        { form: 'malformed' as const, problem: 'unreadable', filePath: null },
      ];
      const results: StoreBindingResolution[] = [];
      for (const declaration of declarations) {
        results.push(await resolveStoreBinding({ declaration, globalDataDir: dataDir }));
      }

      expect(results).toHaveLength(declarations.length);
      expect(snapshotDirectory(tempDir)).toEqual(before);
    });
  });

  // -------------------------------------------------------------------- 5.9

  describe('path-form independence', () => {
    it('matches a registered root that differs only in separator or case', async () => {
      const storeRoot = await makeStore('winpath', { id: 'win-store', uid: UID_A });
      await register('win-store', storeRoot);

      // Rewrite the registry with a path in the other separator form; on
      // Windows this also flips the drive-letter case.
      const registryPath = getStoreRegistryPath({ globalDataDir: dataDir });
      const state = await readStoreRegistryState({ globalDataDir: dataDir });
      expect(state).not.toBeNull();
      const rewritten: StoreRegistryState = {
        version: state!.version,
        stores: Object.fromEntries(
          Object.entries(state!.stores).map(([key, entry]) => [
            key,
            {
              ...entry,
              backend: {
                ...entry.backend,
                local_path:
                  path.sep === '\\'
                    ? entry.backend.local_path.replace(/^([a-zA-Z]):/, (_m, drive: string) =>
                        `${drive.toLowerCase()}:`
                      )
                    : entry.backend.local_path,
              },
            },
          ])
        ),
      };
      await writeStoreRegistryState(rewritten, { globalDataDir: dataDir });
      expect(fs.existsSync(registryPath)).toBe(true);

      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'win-store' },
        globalDataDir: dataDir,
      });

      expect(resolution.kind).toBe('resolved');
      if (resolution.kind !== 'resolved') return;
      expect(resolution.store.uid).toBe(UID_A);
    });

    it('does not report a mismatch for a self-declaration whose root differs only in path form', async () => {
      const storeRoot = await makeStore('selfwin', { id: 'selfwin-store', uid: UID_A });
      await register('selfwin-store', storeRoot);

      const alternateForm = storeRoot.split(path.sep).join(path.posix.sep);
      const resolution = await resolveStoreBinding({
        declaration: { form: 'durable', uid: UID_A, id: 'selfwin-store' },
        projectRoot: alternateForm,
        globalDataDir: dataDir,
      });

      expect(resolution).toEqual({ kind: 'absent' });
    });
  });
});
