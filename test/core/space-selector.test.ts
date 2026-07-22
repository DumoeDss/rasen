import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseSpaceSelector,
  resolveSpaceSelector,
} from '../../src/core/config-api/project-addressing.js';
import { deriveSpaceFromCwd } from '../../src/core/root-selection.js';
import { registerProject } from '../../src/core/project-registry.js';
import { registerStore } from '../../src/core/store/registry.js';
import { getStoreMetadataPath } from '../../src/core/store/foundation.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';

const IS_WINDOWS = process.platform === 'win32';

/** A healthy planning root (specs/ + changes/), unregistered. */
function makePlanningRoot(base: string, name: string): string {
  const root = path.join(base, name);
  createOpenSpecRoot(root);
  return root;
}

/** A config-only pointer repo (no planning shape) declaring `store: <id>`. */
function makePointerRepo(base: string, name: string, storeId: string): string {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), `store: ${storeId}\n`);
  return root;
}

function writeProjectId(root: string, projectId: string): void {
  const configPath = path.join(root, 'rasen', 'config.yaml');
  fs.appendFileSync(configPath, `projectId: ${projectId}\n`);
}

describe('planning-space selector (planning-space-addressing design D1/D2/D5)', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-space-selector-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    // Point every default-globalDataDir reader (resolveSpaceSelector,
    // listRegisteredStores, the project registry) at one isolated home.
    delete process.env.XDG_DATA_HOME;
    process.env.RASEN_HOME = dataDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseSpaceSelector', () => {
    it('splits the project: and store: prefixes', () => {
      expect(parseSpaceSelector('project:abc')).toEqual({ ok: true, namespace: 'project', selector: 'abc' });
      expect(parseSpaceSelector('store:team')).toEqual({ ok: true, namespace: 'store', selector: 'team' });
    });

    it('rejects a bare (prefix-less) selector with 400 invalid_space', () => {
      const result = parseSpaceSelector('team');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('invalid_space');
      }
    });
  });

  describe('resolveSpaceSelector — project namespace', () => {
    it('resolves a project space by projectId', async () => {
      const root = makePlanningRoot(tempDir, 'proj-a');
      await registerProject({ projectRoot: root, projectId: 'proj-a-id', mode: 'in-repo' }, { globalDataDir: dataDir });

      const result = await resolveSpaceSelector('project:proj-a-id');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.space.type).toBe('project');
        expect(result.space.id).toBe('proj-a-id');
        expect(result.space.root).toBe(FileSystemUtils.canonicalizeExistingPath(root));
      }
    });

    it('resolves a project space by an absolute root path', async () => {
      const root = makePlanningRoot(tempDir, 'proj-b');
      await registerProject({ projectRoot: root, projectId: 'proj-b-id', mode: 'in-repo' }, { globalDataDir: dataDir });

      const result = await resolveSpaceSelector(`project:${root}`);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.space.id).toBe('proj-b-id');
    });

    it.runIf(IS_WINDOWS)('resolves a Windows root-path selector differing only by drive-letter case', async () => {
      const root = makePlanningRoot(tempDir, 'proj-case');
      await registerProject({ projectRoot: root, projectId: 'proj-case-id', mode: 'in-repo' }, { globalDataDir: dataDir });

      // Flip the drive-letter case and swap separators — canonical comparison
      // must still land on the same registry entry.
      const variant = (root.charAt(0).toLowerCase() === root.charAt(0)
        ? root.charAt(0).toUpperCase()
        : root.charAt(0).toLowerCase()) + root.slice(1).replace(/\\/g, '/');

      const result = await resolveSpaceSelector(`project:${variant}`);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.space.id).toBe('proj-case-id');
    });

    it('404s space_not_found for an unknown project selector, naming the namespace', async () => {
      const result = await resolveSpaceSelector('project:does-not-exist');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('space_not_found');
        expect(result.message).toContain('project namespace');
      }
    });
  });

  describe('resolveSpaceSelector — store namespace', () => {
    it('resolves a healthy registered store by id', async () => {
      const storeRoot = makePlanningRoot(tempDir, 'team-store');
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: dataDir });

      const result = await resolveSpaceSelector('store:team');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.space.type).toBe('store');
        expect(result.space.id).toBe('team');
        expect(result.space.name).toBe('team');
        expect(result.space.root).toBe(FileSystemUtils.canonicalizeExistingPath(storeRoot));
      }
    });

    it('404s space_not_found for an unknown store, naming the namespace', async () => {
      const result = await resolveSpaceSelector('store:ghost');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
        expect(result.code).toBe('space_not_found');
        expect(result.message).toContain('store namespace');
      }
    });

    it('409s space_unavailable when a registered store fails read-only health inspection', async () => {
      const storeRoot = makePlanningRoot(tempDir, 'broken-store');
      await registerStore({ id: 'broken', localPath: storeRoot, globalDataDir: dataDir });
      // Remove the identity metadata the registration wrote — the store is
      // registered but no longer inspectable.
      fs.rmSync(getStoreMetadataPath(storeRoot), { force: true });

      const result = await resolveSpaceSelector('store:broken');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.code).toBe('space_unavailable');
      }
    });
  });

  describe('resolveSpaceSelector — cross-namespace and prefix rules', () => {
    it('never guesses: a bare selector is 400 invalid_space', async () => {
      const result = await resolveSpaceSelector('team');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.code).toBe('invalid_space');
      }
    });

    it('disambiguates a shared id by prefix — store:elftia and project:elftia address different roots', async () => {
      const projectRoot = makePlanningRoot(tempDir, 'elftia-project');
      await registerProject({ projectRoot, projectId: 'elftia', mode: 'in-repo' }, { globalDataDir: dataDir });
      const storeRoot = makePlanningRoot(tempDir, 'elftia-store');
      await registerStore({ id: 'elftia', localPath: storeRoot, globalDataDir: dataDir });

      const asStore = await resolveSpaceSelector('store:elftia');
      const asProject = await resolveSpaceSelector('project:elftia');
      expect(asStore.ok && asProject.ok).toBe(true);
      if (asStore.ok && asProject.ok) {
        expect(asStore.space.type).toBe('store');
        expect(asProject.space.type).toBe('project');
        expect(asStore.space.root).toBe(FileSystemUtils.canonicalizeExistingPath(storeRoot));
        expect(asProject.space.root).toBe(FileSystemUtils.canonicalizeExistingPath(projectRoot));
        expect(asStore.space.root).not.toBe(asProject.space.root);
      }
    });
  });

  describe('deriveSpaceFromCwd', () => {
    it('derives a project space from a registered planning root (registry id wins)', async () => {
      const root = makePlanningRoot(tempDir, 'derive-registered');
      writeProjectId(root, 'config-side-id');
      await registerProject({ projectRoot: root, projectId: 'registry-id', mode: 'in-repo' }, { globalDataDir: dataDir });

      const space = await deriveSpaceFromCwd(root, { globalDataDir: dataDir });
      expect(space).not.toBeNull();
      expect(space?.type).toBe('project');
      expect(space?.id).toBe('registry-id');
      expect(space?.root).toBe(FileSystemUtils.canonicalizeExistingPath(root));
    });

    it('falls back to the config projectId for an unregistered planning root', async () => {
      const root = makePlanningRoot(tempDir, 'derive-config-id');
      writeProjectId(root, 'config-only-id');

      const space = await deriveSpaceFromCwd(root, { globalDataDir: dataDir });
      expect(space?.type).toBe('project');
      expect(space?.id).toBe('config-only-id');
    });

    it('yields no space for a planning root with no resolvable identity', async () => {
      const root = makePlanningRoot(tempDir, 'derive-no-id');
      const space = await deriveSpaceFromCwd(root, { globalDataDir: dataDir });
      expect(space).toBeNull();
    });

    it('derives a store space from a pointer repo whose store is registered', async () => {
      const storeRoot = makePlanningRoot(tempDir, 'pointer-target-store');
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: dataDir });
      const pointerRepo = makePointerRepo(tempDir, 'pointer-repo', 'team');

      const space = await deriveSpaceFromCwd(pointerRepo, { globalDataDir: dataDir });
      expect(space?.type).toBe('store');
      expect(space?.id).toBe('team');
      expect(space?.root).toBe(FileSystemUtils.canonicalizeExistingPath(storeRoot));
    });

    it('degrades to no space for a pointer repo naming an unregistered store', async () => {
      const pointerRepo = makePointerRepo(tempDir, 'orphan-pointer', 'nonexistent-store');
      const space = await deriveSpaceFromCwd(pointerRepo, { globalDataDir: dataDir });
      expect(space).toBeNull();
    });

    it('yields no space when the cwd is outside any Rasen root', async () => {
      const bare = path.join(tempDir, 'not-a-rasen-repo');
      fs.mkdirSync(bare, { recursive: true });
      const space = await deriveSpaceFromCwd(bare, { globalDataDir: dataDir });
      expect(space).toBeNull();
    });
  });
});
