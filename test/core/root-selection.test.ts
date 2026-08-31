import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { randomUUID } from 'node:crypto';

import {
  emitStoreRootBanner,
  resolveOpenSpecRoot,
  resolveRootForCommand,
  RootSelectionError,
  toRootOutput,
  withStoreFlag,
} from '../../src/core/root-selection.js';
import {
  writeStoreMetadataState,
  writeStoreRegistryState,
} from '../../src/core/store/foundation.js';
import { getGlobalDataDir } from '../../src/core/global-config.js';
import {
  readProjectRegistryState,
  getProjectHomeDir,
  registerProject,
  updateProjectRegistryState,
} from '../../src/core/project-registry.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { writeLastWarnedVersionPair } from '../../src/core/version-guard-state.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

describe('resolveOpenSpecRoot', () => {
  let tempDir: string;
  let globalDataDir: string;
  let savedXdgDataHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-root-selection-'))
    );
    globalDataDir = path.join(tempDir, 'global-data');
    // Backstop: store calls below thread `globalDataDir`, but if a future
    // edit forgets one, the path resolver falls back to XDG_DATA_HOME and
    // then to the real ~/.local/share/openspec. Pin XDG at the temp dir so
    // a missed arg can never pollute the developer's home registry.
    savedXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'xdg');
  });

  afterEach(() => {
    if (savedXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = savedXdgDataHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function mkdir(relativePath: string): string {
    const dir = path.join(tempDir, relativePath);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function createOpenSpecRoot(rootDir: string): void {
    fs.mkdirSync(path.join(rootDir, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  }

  async function registerStore(
    id: string,
    options: {
      healthyRoot?: boolean;
      metadataId?: string | null;
      type?: 'store' | 'project';
      dirName?: string;
    } = {}
  ): Promise<string> {
    const type = options.type ?? 'store';
    const storeRoot = mkdir(`stores/${options.dirName ?? id}`);
    if (options.healthyRoot !== false) {
      createOpenSpecRoot(storeRoot);
    }
    if (options.metadataId !== null) {
      await writeStoreMetadataState(storeRoot, {
        version: 1,
        id: options.metadataId ?? id,
      });
    }

    const existing = fs.existsSync(path.join(globalDataDir, 'stores', 'registry.yaml'));
    const { readStoreRegistryState, registryKeyFor } = await import(
      '../../src/core/store/foundation.js'
    );
    const registryStores = existing
      ? (await readStoreRegistryState({ globalDataDir }))?.stores ?? {}
      : {};

    await writeStoreRegistryState(
      {
        version: 1,
        stores: {
          ...registryStores,
          [registryKeyFor(type, id)]: {
            ...(type === 'project' ? { type } : {}),
            backend: { type: 'git', local_path: storeRoot },
          },
        },
      },
      { globalDataDir }
    );

    return storeRoot;
  }

  async function makeStoreV2Project(
    storeId: string,
    projectId: string
  ): Promise<{ storeRoot: string; storeUid: string }> {
    const storeUid = randomUUID();
    const storeRoot = await registerStore(storeId);
    await writeStoreRegistryState(
      {
        version: 2,
        stores: {
          [storeUid]: {
            id: storeId,
            backend: { type: 'git', local_path: storeRoot },
          },
        },
      },
      { globalDataDir }
    );
    await writeStoreMetadataState(storeRoot, {
      version: 2,
      uid: storeUid,
      id: storeId,
      layoutVersion: 2,
    });
    const catalogPath = path.join(
      storeRoot,
      '.rasen-store',
      'projects',
      `${projectId}.yaml`
    );
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    fs.writeFileSync(
      catalogPath,
      `version: 2\nprojectId: ${projectId}\nid: ${projectId}\nroles:\n  planning: true\n  knowledge: false\nplanningBinding:\n  state: bound\n  boundAt: 2026-08-06T00:00:00.000Z\n`
    );
    return { storeRoot, storeUid };
  }

  async function expectRootSelectionError(
    promise: Promise<unknown>,
    code: string
  ): Promise<RootSelectionError> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RootSelectionError);
    const error = caught as RootSelectionError;
    expect(error.diagnostic.code).toBe(code);
    return error;
  }

  it('resolves a selected store to its healthy Rasen root', async () => {
    const storeRoot = await registerStore('team-context');

    const root = await resolveOpenSpecRoot({ store: 'team-context', globalDataDir });

    expect(root.source).toBe('store');
    expect(root.storeId).toBe('team-context');
    expect(root.path).toBe(storeRoot);
    expect(root.changesDir).toBe(path.join(storeRoot, 'rasen', 'changes'));
    expect(root.specsDir).toBe(path.join(storeRoot, 'rasen', 'specs'));
    expect(root.archiveDir).toBe(path.join(storeRoot, 'rasen', 'changes', 'archive'));
    expect(root.defaultSchema).toBe('spec-driven');
  });

  it('keeps the validated planning description on a nearest standalone root', async () => {
    const projectRoot = mkdir('standalone-project');
    createOpenSpecRoot(projectRoot);

    const root = await resolveOpenSpecRoot({
      startPath: projectRoot,
      globalDataDir,
      reporter: false,
    });

    expect(root).toMatchObject({
      path: projectRoot,
      source: 'nearest',
      changesDir: path.join(projectRoot, 'rasen', 'changes'),
      specsDir: path.join(projectRoot, 'rasen', 'specs'),
      archiveDir: path.join(projectRoot, 'rasen', 'changes', 'archive'),
      planningScope: {
        kind: 'standalone',
        paths: {
          'active-changes': path.join(projectRoot, 'rasen', 'changes'),
          'archive-line': path.join(projectRoot, 'rasen', 'changes', 'archive'),
          specs: path.join(projectRoot, 'rasen', 'specs'),
        },
      },
    });
    expect(toRootOutput(root)).toMatchObject({
      path: projectRoot,
      source: 'nearest',
      scope: {
        kind: 'standalone',
        paths: {
          'active-changes': path.join(projectRoot, 'rasen', 'changes'),
          'archive-line': path.join(projectRoot, 'rasen', 'changes', 'archive'),
          specs: path.join(projectRoot, 'rasen', 'specs'),
        },
      },
    });
  });

  it('rejects an unknown store id and lists registered ids', async () => {
    await registerStore('team-context');

    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'team-contxt', globalDataDir }),
      'unknown_store'
    );
    expect(error.message).toContain("'team-contxt'");
    expect(error.message).toContain('team-context');
  });

  it('rejects --store when no stores are registered without suggesting --store-path', async () => {
    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'team-context', globalDataDir }),
      'no_registered_stores'
    );
    expect(error.message).not.toContain('--store-path');
    expect(error.diagnostic.fix).not.toContain('--store-path');
  });

  it('rejects an invalid Store name before registry lookup', async () => {
    // No registry exists at all; format validation must win.
    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'Bad/Id', globalDataDir }),
      'invalid_store_id'
    );
    expect(error.message).toContain('Store name');
  });

  it('rejects an unhealthy store root without repairing it', async () => {
    const storeRoot = await registerStore('team-context', { healthyRoot: false });

    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'team-context', globalDataDir }),
      'unhealthy_store_root'
    );
    expect(error.diagnostic.fix).toContain('store doctor');
    // No scaffolding or repair happened.
    expect(fs.existsSync(path.join(storeRoot, 'rasen'))).toBe(false);
  });

  it('rejects a store whose metadata id does not match the registry id', async () => {
    await registerStore('team-context', { metadataId: 'other-context' });

    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'team-context', globalDataDir }),
      'store_identity_mismatch'
    );
    expect(error.message).toContain('other-context');
    expect(error.diagnostic.fix).toContain('store doctor');
  });

  it('rejects a store with missing identity metadata before root-health checks', async () => {
    // Root is also unhealthy; the identity failure must win.
    await registerStore('team-context', { healthyRoot: false, metadataId: null });

    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ store: 'team-context', globalDataDir }),
      'store_identity_mismatch'
    );
    expect(error.diagnostic.fix).toContain('store doctor');
  });

  it('rejects --store-path deliberately with register guidance', async () => {
    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ storePath: '/somewhere', globalDataDir }),
      'store_path_not_supported'
    );
    expect(error.message).toContain('store register');
    expect(error.message).toContain('--store <id>');
  });

  it('resolves the nearest openspec root without --store', async () => {
    const repoRoot = mkdir('app-repo');
    createOpenSpecRoot(repoRoot);
    const nested = mkdir('app-repo/src/deep');

    const root = await resolveOpenSpecRoot({ startPath: nested, globalDataDir });

    expect(root.source).toBe('nearest');
    expect(root.path).toBe(repoRoot);
  });

  it('ignores leftover workspace view state when a nearest root exists', async () => {
    const workspaceDir = mkdir('workspace');
    fs.mkdirSync(path.join(workspaceDir, '.rasen-workspace'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, '.rasen-workspace', 'view.yaml'),
      'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
    );
    const repoRoot = mkdir('workspace/app-repo');
    createOpenSpecRoot(repoRoot);
    const nested = mkdir('workspace/app-repo/src');

    const root = await resolveOpenSpecRoot({ startPath: nested, globalDataDir });

    expect(root.source).toBe('nearest');
    expect(root.path).toBe(repoRoot);
    expect(root.changesDir).toBe(path.join(repoRoot, 'rasen', 'changes'));
    expect(root.defaultSchema).toBe('spec-driven');
  });

  it('treats workspace state alone as no root at all', async () => {
    const workspaceDir = mkdir('workspace-only');
    fs.mkdirSync(path.join(workspaceDir, '.rasen-workspace'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, '.rasen-workspace', 'view.yaml'),
      'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
    );

    const root = await resolveOpenSpecRoot({ startPath: workspaceDir, globalDataDir });

    expect(root.source).toBe('implicit');
    expect(root.path).toBe(workspaceDir);
  });

  it('fails with a store-selection hint when no root exists but stores are registered', async () => {
    await registerStore('team-context');
    const appRepo = mkdir('plain-app');

    const error = await expectRootSelectionError(
      resolveOpenSpecRoot({ startPath: appRepo, globalDataDir }),
      'no_root_with_registered_stores'
    );
    expect(error.message).toContain('team-context');
    expect(error.message).toContain('--store <id>');
    expect(error.message).toContain('rasen init');
    // No scaffolding happened.
    expect(fs.existsSync(path.join(appRepo, 'rasen'))).toBe(false);
  });

  it('allows an implicit root only when requested', async () => {
    const appRepo = mkdir('implicit-app');

    const implicitRoot = await resolveOpenSpecRoot({ startPath: appRepo, globalDataDir });
    expect(implicitRoot.source).toBe('implicit');
    expect(implicitRoot.path).toBe(appRepo);

    await expectRootSelectionError(
      resolveOpenSpecRoot({ startPath: appRepo, globalDataDir, allowImplicitRoot: false }),
      'no_openspec_root'
    );
  });

  it('prefers the selected store over a nearby root and leftover workspace state', async () => {
    const storeRoot = await registerStore('team-context');
    const repoRoot = mkdir('local-repo');
    createOpenSpecRoot(repoRoot);
    fs.mkdirSync(path.join(repoRoot, '.rasen-workspace'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.rasen-workspace', 'view.yaml'),
      'version: 1\nname: platform\ncontext: null\nlinks: {}\n'
    );

    const root = await resolveOpenSpecRoot({
      store: 'team-context',
      startPath: repoRoot,
      globalDataDir,
    });

    expect(root.source).toBe('store');
    expect(root.path).toBe(storeRoot);
  });

  describe('declared store fallback (3.2)', () => {
    function createPointerDir(relativePath: string, configBody: string): string {
      const dir = mkdir(relativePath);
      fs.mkdirSync(path.join(dir, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'rasen', 'config.yaml'), configBody);
      return dir;
    }

    it('resolves a config-only pointer to the declared store', async () => {
      const storeRoot = await registerStore('team-context');
      const pointerDir = createPointerDir('app-repo', 'store: team-context\n');

      const root = await resolveOpenSpecRoot({ startPath: pointerDir, globalDataDir });

      expect(root.source).toBe('declared');
      expect(root.storeId).toBe('team-context');
      expect(root.path).toBe(storeRoot);
      // The pointer dir is untouched.
      expect(fs.existsSync(path.join(pointerDir, 'rasen', 'specs'))).toBe(false);
      expect(fs.existsSync(path.join(pointerDir, 'rasen', 'changes'))).toBe(false);
    });

    it('lets explicit --store beat the pointer with source store', async () => {
      await registerStore('team-context');
      const otherRoot = await registerStore('other-context');
      const pointerDir = createPointerDir('app-repo', 'store: team-context\n');

      const root = await resolveOpenSpecRoot({
        startPath: pointerDir,
        store: 'other-context',
        globalDataDir,
      });

      expect(root.source).toBe('store');
      expect(root.path).toBe(otherRoot);
    });

    it('never overrides a real root and reports inheritance once for a registered store', async () => {
      await registerStore('team-context');
      const repo = mkdir('real-repo');
      createOpenSpecRoot(repo);
      fs.writeFileSync(
        path.join(repo, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: team-context\n'
      );

      const warnings: string[] = [];
      const original = console.error;
      console.error = (message: string) => warnings.push(String(message));
      try {
        const root = await resolveOpenSpecRoot({ startPath: repo, globalDataDir });
        expect(root.source).toBe('nearest');
        expect(root.path).toBe(repo);
        expect(root.storeId).toBeUndefined();
      } finally {
        console.error = original;
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("declares store 'team-context'");
      expect(warnings[0]).toContain('configuration inherits from that store');
      expect(warnings[0]).not.toContain('the declaration is ignored');
    });

    it('stops the command when the declared store cannot be used on this machine', async () => {
      const repo = mkdir('real-repo-unregistered');
      createOpenSpecRoot(repo);
      fs.writeFileSync(
        path.join(repo, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: not-registered\n'
      );

      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: repo, globalDataDir }),
        'no_registered_stores'
      );
      expect(error.message).toContain("Unknown store 'not-registered'");
      expect(error.message).toContain('no network access and no writes');
      // The fix field carries the pasteable whole-gap repair (design D1):
      // `rasen bootstrap`, sourced from `primaryRepair(binding)`. The rich
      // human guidance (--id, config-edit) stays in the message body.
      expect(error.diagnostic.fix).toBe('rasen bootstrap');
      expect(error.message).toContain('rasen store register');
    });

    it('reports rather than fails on the read-only diagnostic path', async () => {
      const repo = mkdir('real-repo-unregistered-doctor');
      createOpenSpecRoot(repo);
      fs.writeFileSync(
        path.join(repo, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: not-registered\n'
      );

      const warnings: string[] = [];
      const original = console.error;
      console.error = (message: string) => warnings.push(String(message));
      try {
        const root = await resolveOpenSpecRoot({
          startPath: repo,
          globalDataDir,
          allowUnavailableStore: true,
        });
        // The local root still wins; the notice reports why the declaration
        // cannot be used, with its repair command.
        expect(root.source).toBe('nearest');
        expect(root.path).toBe(repo);
      } finally {
        console.error = original;
      }

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("declares store 'not-registered'");
      expect(warnings[0]).toContain('cannot be used on this machine');
      expect(warnings[0]).toContain('Next: ');
      expect(warnings[0]).not.toContain('configuration inherits from that store');
    });

    it('stays silent for a registered store root that itself declares a store pointer (no-transitivity)', async () => {
      // A root that IS a registered store, with local planning shape, that also
      // declares a `store:` pointer. resolveConfigStoreLayer returns null for it
      // (rule 3 — a store root never inherits), so the notice must NOT claim
      // inheritance; it stays silent (matching the resolver — design D5).
      const storeRoot = await registerStore('team-context');
      fs.writeFileSync(
        path.join(storeRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: team-context\n'
      );

      const warnings: string[] = [];
      const original = console.error;
      console.error = (message: string) => warnings.push(String(message));
      let root;
      try {
        root = await resolveOpenSpecRoot({ startPath: storeRoot, globalDataDir });
      } finally {
        console.error = original;
      }

      expect(root.source).toBe('nearest');
      expect(root.path).toBe(storeRoot);
      // No inheriting notice (nor any other root-selection notice) is emitted.
      expect(warnings).toEqual([]);

      // The resolver agrees: a store's own root gets no inherited store layer.
      const { resolveConfigStoreLayer } = await import('../../src/core/effective-config.js');
      expect(await resolveConfigStoreLayer(storeRoot, { globalDataDir })).toEqual({
        kind: 'absent',
      });
    });

    it('keeps config-only directories without a pointer as plain roots', async () => {
      await registerStore('team-context');
      const dir = createPointerDir('plain-config-only', 'schema: spec-driven\n');

      const warnings: string[] = [];
      const original = console.error;
      console.error = (message: string) => warnings.push(String(message));
      try {
        const root = await resolveOpenSpecRoot({ startPath: dir, globalDataDir });
        expect(root.source).toBe('nearest');
        expect(root.path).toBe(dir);
      } finally {
        console.error = original;
      }
      expect(warnings).toEqual([]);
    });

    it('errors on malformed pointers instead of falling through to local writes', async () => {
      const nonString = createPointerDir('bad-type', 'store: [a, b]\n');
      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: nonString, globalDataDir }),
        'invalid_store_pointer'
      );
      expect(error.message).toContain(path.join(nonString, 'rasen', 'config.yaml'));
      expect(error.message).toContain('the store key must be a single store id string');
      expect(fs.existsSync(path.join(nonString, 'rasen', 'changes'))).toBe(false);

      const unparseable = createPointerDir('bad-yaml', 'store: [unclosed');
      const yamlError = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: unparseable, globalDataDir }),
        'invalid_store_pointer'
      );
      // The unparseable case names the real problem, not a phantom key.
      expect(yamlError.message).toContain('could not be read as YAML');
      expect(yamlError.diagnostic.fix).toContain('Fix the YAML syntax');

      // A config that parses to a non-mapping scalar has no pointer at
      // all: plain root, no error (readProjectConfig owns that warning).
      const scalar = createPointerDir('scalar-config', 'just a string');
      const scalarRoot = await resolveOpenSpecRoot({ startPath: scalar, globalDataDir });
      expect(scalarRoot.source).toBe('nearest');
    });

    it('treats empty and comments-only configs as plain roots, not malformed pointers', async () => {
      // The documented conversion path comments the line out; that must
      // not strand every command behind invalid_store_pointer.
      const empty = createPointerDir('empty-config', '');
      const emptyRoot = await resolveOpenSpecRoot({ startPath: empty, globalDataDir });
      expect(emptyRoot.source).toBe('nearest');
      expect(emptyRoot.path).toBe(empty);

      const commented = createPointerDir('commented-config', '# store: team-context\n');
      const commentedRoot = await resolveOpenSpecRoot({ startPath: commented, globalDataDir });
      expect(commentedRoot.source).toBe('nearest');
      expect(commentedRoot.path).toBe(commented);
    });

    it('prefixes every taxonomy error with the declaration origin, fix unprefixed', async () => {
      const cases: Array<[string, string, () => Promise<unknown>]> = [];

      const unknownDir = createPointerDir('unknown-pointer', 'store: ghost-context\n');
      await registerStore('team-context');
      cases.push([
        'unknown_store',
        path.join(unknownDir, 'rasen', 'config.yaml'),
        () => resolveOpenSpecRoot({ startPath: unknownDir, globalDataDir }),
      ]);

      const invalidDir = createPointerDir('invalid-pointer', 'store: "Bad/Id"\n');
      cases.push([
        'invalid_store_id',
        path.join(invalidDir, 'rasen', 'config.yaml'),
        () => resolveOpenSpecRoot({ startPath: invalidDir, globalDataDir }),
      ]);

      await registerStore('hollow-context', { healthyRoot: false });
      const unhealthyDir = createPointerDir('unhealthy-pointer', 'store: hollow-context\n');
      cases.push([
        'unhealthy_store_root',
        path.join(unhealthyDir, 'rasen', 'config.yaml'),
        () => resolveOpenSpecRoot({ startPath: unhealthyDir, globalDataDir }),
      ]);

      await registerStore('mismatched-context', { metadataId: 'someone-else' });
      const mismatchDir = createPointerDir('mismatch-pointer', 'store: mismatched-context\n');
      cases.push([
        'store_identity_mismatch',
        path.join(mismatchDir, 'rasen', 'config.yaml'),
        () => resolveOpenSpecRoot({ startPath: mismatchDir, globalDataDir }),
      ]);

      for (const [code, origin, run] of cases) {
        const error = await expectRootSelectionError(run(), code);
        expect(error.message).toContain(`Declared in ${origin}: `);
        expect(error.diagnostic.fix).not.toContain('Declared in');
      }
    });

    it('prefixes no_registered_stores when nothing is registered', async () => {
      const pointerDir = createPointerDir('lonely-pointer', 'store: team-context\n');

      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: pointerDir, globalDataDir }),
        'no_registered_stores'
      );
      expect(error.message).toContain('Declared in ');
    });

    it('resolves one hop only - a store with its own pointer is the destination', async () => {
      const storeRoot = await registerStore('team-context');
      fs.writeFileSync(
        path.join(storeRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nstore: somewhere-else\n'
      );
      const pointerDir = createPointerDir('app-repo', 'store: team-context\n');

      const warnings: string[] = [];
      const original = console.error;
      console.error = (message: string) => warnings.push(String(message));
      try {
        const root = await resolveOpenSpecRoot({ startPath: pointerDir, globalDataDir });
        expect(root.path).toBe(storeRoot);
        expect(root.storeId).toBe('team-context');
      } finally {
        console.error = original;
      }
    });

    it('names a .yml origin when that file was read', async () => {
      const dir = mkdir('yml-pointer');
      fs.mkdirSync(path.join(dir, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'rasen', 'config.yml'), 'store: ghost\n');

      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: dir, globalDataDir }),
        'no_registered_stores'
      );
      expect(error.message).toContain(path.join(dir, 'rasen', 'config.yml'));
    });
  });

  it('skips openspec/ directories that are neither planning-shaped nor configured (the ~/openspec layout)', async () => {
    // The recommended store layout: $HOME/rasen/<store>. $HOME must
    // NOT become a nearest root for everything under the home tree.
    await registerStore('team-context');
    const fakeHome = path.join(tempDir, 'fake-home');
    fs.mkdirSync(path.join(fakeHome, 'rasen', 'team-context'), { recursive: true });
    const scratch = path.join(fakeHome, 'projects', 'scratch');
    fs.mkdirSync(scratch, { recursive: true });

    // No qualifying root anywhere: the registered-store hint fires (the
    // exact guidance the phantom $HOME root used to shadow). The
    // isolated globalDataDir keeps this off the machine's real registry.
    await expect(
      resolveOpenSpecRoot({ startPath: scratch, globalDataDir })
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({ code: 'no_root_with_registered_stores' }),
    });
  });

  describe('resolveRootForCommand self-heal DI (MINOR-5)', () => {
    it('threads globalDataDir to the self-heal touch, not the XDG-default registry', async () => {
      const storeRoot = await registerStore('team-context');
      const projectId = randomUUID();
      fs.writeFileSync(
        path.join(storeRoot, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );

      const root = await resolveRootForCommand(
        { store: 'team-context' },
        { json: true, globalDataDir }
      );

      expect(root?.path).toBe(storeRoot);

      const canonicalPath = FileSystemUtils.canonicalizeExistingPath(storeRoot);
      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalPath]).toBeUndefined();

      // Must not have leaked into the XDG-default registry either - the
      // whole point of DI is that a missed thread can never reach it.
      const xdgGlobalDataDir = getGlobalDataDir({ env: process.env });
      expect(xdgGlobalDataDir).not.toBe(globalDataDir);
      const xdgState = await readProjectRegistryState({ globalDataDir: xdgGlobalDataDir });
      expect(xdgState?.projects[canonicalPath]).toBeUndefined();
    });
  });

  describe('--project selection (store-project-namespace)', () => {
    it('resolves a project that exists only in the machine project registry', async () => {
      const projectRoot = mkdir('machine-projects/machine-only');
      createOpenSpecRoot(projectRoot);
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprojectId: machine-only\n'
      );
      await registerProject(
        { projectRoot, projectId: 'machine-only', mode: 'in-repo' },
        { globalDataDir }
      );

      const root = await resolveOpenSpecRoot({
        project: 'machine-only',
        startPath: mkdir('unrelated-cwd'),
        globalDataDir,
      });

      expect(root.path).toBe(fs.realpathSync.native(projectRoot));
      expect(root.storeId).toBe('machine-only');
      expect(root.storeType).toBe('project');
      expect(root.planningScope?.kind).toBe('standalone');
    });

    it('resolves a project root with full parity to a store root', async () => {
      const projectRoot = await registerStore('elftia', { type: 'project' });

      const root = await resolveOpenSpecRoot({ project: 'elftia', globalDataDir });

      expect(root.source).toBe('store');
      expect(root.storeId).toBe('elftia');
      expect(root.storeType).toBe('project');
      expect(root.path).toBe(projectRoot);
      expect(root.changesDir).toBe(path.join(projectRoot, 'rasen', 'changes'));
      expect(root.specsDir).toBe(path.join(projectRoot, 'rasen', 'specs'));
      expect(root.archiveDir).toBe(path.join(projectRoot, 'rasen', 'changes', 'archive'));
      expect(root.defaultSchema).toBe('spec-driven');
    });

    it('lets a store and a project of the same id coexist and resolve independently', async () => {
      const storeRoot = await registerStore('elftia', { type: 'store', dirName: 'elftia-store' });
      const projectRoot = await registerStore('elftia', {
        type: 'project',
        dirName: 'elftia-project',
      });
      expect(storeRoot).not.toBe(projectRoot);

      const store = await resolveOpenSpecRoot({ store: 'elftia', globalDataDir });
      const project = await resolveOpenSpecRoot({ project: 'elftia', globalDataDir });

      expect(store.path).toBe(storeRoot);
      expect(store.storeType).toBe('store');
      expect(project.path).toBe(projectRoot);
      expect(project.storeType).toBe('project');
    });

    it('rejects an unknown project id and lists registered project ids', async () => {
      await registerStore('elftia', { type: 'project' });

      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ project: 'other-project', globalDataDir }),
        'unknown_project'
      );
      expect(error.message).toContain("'other-project'");
      expect(error.message).toContain('elftia');
    });

    it('uses --store and --project as orthogonal Store v2 dimensions', async () => {
      const { storeRoot } = await makeStoreV2Project('team', 'elftia');

      const root = await resolveOpenSpecRoot({
        store: 'team',
        project: 'elftia',
        startPath: storeRoot,
        globalDataDir,
      });

      expect(root.planningScope?.kind).toBe('store-project');
      expect(root.projectHome).toBe(
        path.join(storeRoot, 'rasen', 'projects', 'elftia')
      );
      expect(root.changesDir).toBe(
        path.join(storeRoot, 'rasen', 'projects', 'elftia', 'changes')
      );
    });

    it('resolves both flags in resolveRootForCommand JSON mode without a diagnostic payload', async () => {
      const { storeRoot } = await makeStoreV2Project('team', 'elftia');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const root = await resolveRootForCommand(
          { store: 'team', project: 'elftia' },
          { json: true, globalDataDir }
        );
        expect(root?.path).toBe(storeRoot);
        expect(root?.planningScope?.kind).toBe('store-project');
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });

    it('backward-compat golden test: a pre-split registry file resolves via --store and is never rewritten (8.1)', async () => {
      const storeRoot = mkdir('stores/elftia');
      createOpenSpecRoot(storeRoot);
      await writeStoreMetadataState(storeRoot, { version: 1, id: 'elftia' });

      const registryPath = path.join(globalDataDir, 'stores', 'registry.yaml');
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      const legacyContent = `version: 1\nstores:\n  elftia:\n    backend:\n      type: git\n      local_path: ${storeRoot}\n`;
      fs.writeFileSync(registryPath, legacyContent);

      const root = await resolveOpenSpecRoot({ store: 'elftia', globalDataDir });

      expect(root.path).toBe(storeRoot);
      expect(root.storeId).toBe('elftia');
      expect(root.storeType).toBe('store');
      // Resolution is read-only: the pre-split registry file on disk is
      // byte-identical after resolving through it.
      expect(fs.readFileSync(registryPath, 'utf-8')).toBe(legacyContent);
    });

    describe('root hints (emitStoreRootBanner / withStoreFlag)', () => {
      it('renders --project in the banner and follow-up hints for a project-selected root', async () => {
        await registerStore('elftia', { type: 'project' });
        const root = await resolveOpenSpecRoot({ project: 'elftia', globalDataDir });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          emitStoreRootBanner(root);
          expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('project elftia')
          );
        } finally {
          errorSpy.mockRestore();
        }

        expect(withStoreFlag(root, 'rasen list')).toBe('rasen list --project elftia');
      });

      it('keeps the store banner/hint wording unchanged for a store-selected root', async () => {
        await registerStore('elftia', { type: 'store' });
        const root = await resolveOpenSpecRoot({ store: 'elftia', globalDataDir });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          emitStoreRootBanner(root);
          expect(errorSpy).toHaveBeenCalledWith('Using Rasen root: elftia (' + root.path + ')');
        } finally {
          errorSpy.mockRestore();
        }

        expect(withStoreFlag(root, 'rasen list')).toBe('rasen list --store elftia');
      });
    });
  });

  describe('ambient bound-project routing never fails open to the flat Store root', () => {
    function writeMemberCheckout(
      dirName: string,
      storeId: string,
      projectId: string,
      options: { localPlanning?: boolean } = {}
    ): string {
      const checkout = mkdir(dirName);
      if (options.localPlanning) {
        createOpenSpecRoot(checkout);
      } else {
        fs.mkdirSync(path.join(checkout, 'rasen'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(checkout, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\nstore: ${storeId}\n`
      );
      return checkout;
    }

    function unbindProject(storeRoot: string, projectId: string): void {
      fs.writeFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
        `version: 2\nprojectId: ${projectId}\nid: ${projectId}\nroles:\n  planning: false\n  knowledge: true\nplanningBinding:\n  state: unbound\n`
      );
    }

    it('surfaces the catalog diagnostic instead of reading the Store root-level changes', async () => {
      const { storeRoot } = await makeStoreV2Project('team', 'elftia');
      fs.mkdirSync(
        path.join(storeRoot, 'rasen', 'projects', 'elftia', 'changes', 'partition-change'),
        { recursive: true }
      );
      // The flat Store root also carries content; it must never answer for the
      // project, least of all after a diagnostic.
      fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'store-root-decoy'), {
        recursive: true,
      });
      const checkout = writeMemberCheckout('member-checkout', 'team', 'elftia');

      const healthy = await resolveOpenSpecRoot({
        startPath: checkout,
        globalDataDir,
        reporter: false,
      });
      expect(healthy.planningScope?.kind).toBe('store-project');
      expect(healthy.changesDir).toBe(
        path.join(storeRoot, 'rasen', 'projects', 'elftia', 'changes')
      );

      fs.writeFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', 'elftia.yaml'),
        'version: 2\nprojectId: [unclosed\n'
      );

      const error = await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: checkout, globalDataDir, reporter: false }),
        'invalid_project_catalog'
      );
      expect(error.diagnostic.target).toContain('elftia.yaml');
    });

    it('reports the unbound planning relationship for a pointer checkout with no local planning', async () => {
      const { storeRoot } = await makeStoreV2Project('team', 'elftia');
      unbindProject(storeRoot, 'elftia');
      fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'store-root-decoy'), {
        recursive: true,
      });
      const checkout = writeMemberCheckout('unbound-checkout', 'team', 'elftia');

      await expectRootSelectionError(
        resolveOpenSpecRoot({ startPath: checkout, globalDataDir, reporter: false }),
        'project_not_in_store'
      );
    });

    it('keeps configuration inheritance resolving to the local planning tree', async () => {
      const { storeRoot } = await makeStoreV2Project('team', 'elftia');
      unbindProject(storeRoot, 'elftia');
      const checkout = writeMemberCheckout('inheriting-checkout', 'team', 'elftia', {
        localPlanning: true,
      });

      const root = await resolveOpenSpecRoot({
        startPath: checkout,
        globalDataDir,
        reporter: false,
      });

      expect(root.path).toBe(checkout);
      expect(root.changesDir).toBe(path.join(checkout, 'rasen', 'changes'));
      expect(root.storeId).toBeUndefined();
    });
  });

  describe('ambient skill-version-mismatch warning (delivery-reliability-version-guard)', () => {
    const STALE_VERSION = '0.0.1-stale';

    async function currentCliVersion(): Promise<string> {
      const { version } = await import('../../package.json');
      return version as string;
    }

    function writeStaleSkill(rootDir: string, version: string): void {
      const skillDir = path.join(rootDir, '.claude', 'skills', 'rasen-explore');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: rasen-explore\nmetadata:\n  generatedBy: "${version}"\n---\n\nContent\n`
      );
    }

    it('warns once on a mismatched project, then stays silent on a second command (debounce)', async () => {
      const projectRoot = await registerStore('stale-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      // Mint the machine-local home so the debounce marker can be consulted.
      const { resolveProjectHome } = await import('../../src/core/project-home.js');
      await resolveProjectHome(projectRoot, { globalDataDir });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await resolveRootForCommand(
          { project: 'stale-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain(STALE_VERSION);

        warnSpy.mockClear();
        await resolveRootForCommand(
          { project: 'stale-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('uses the canonical main home for a worktree command without touching legacy state', async () => {
      const repoRoot = mkdir('version-guard-worktree-main');
      createOpenSpecRoot(repoRoot);
      const projectId = randomUUID();
      fs.writeFileSync(
        path.join(repoRoot, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );
      writeStaleSkill(repoRoot, STALE_VERSION);
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'initial'], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      const worktreeRoot = path.join(tempDir, 'version-guard-worktree-linked');
      execFileSync('git', ['worktree', 'add', worktreeRoot], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      const main = await registerProject(
        { projectRoot: repoRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const legacyHome = 'version-guard-legacy-worktree-home';
      await updateProjectRegistryState(
        current => ({
          version: 1,
          projects: {
            ...current!.projects,
            [FileSystemUtils.canonicalizeExistingPath(worktreeRoot)]: {
              ...main.entry,
              name: 'legacy-worktree-cache',
              home: legacyHome,
            },
          },
        }),
        { globalDataDir }
      );
      const mainHomeDir = getProjectHomeDir(main.entry.home, { globalDataDir });
      const legacyHomeDir = getProjectHomeDir(legacyHome, { globalDataDir });
      fs.mkdirSync(legacyHomeDir, { recursive: true });
      writeLastWarnedVersionPair(mainHomeDir, {
        stampVersion: STALE_VERSION,
        cliVersion: await currentCliVersion(),
      });
      const registryPath = path.join(globalDataDir, 'projects', 'registry.json');
      const registryBefore = fs.readFileSync(registryPath);
      const configBefore = fs.readFileSync(path.join(worktreeRoot, 'rasen', 'config.yaml'));
      const mainInventoryBefore = fs.readdirSync(mainHomeDir).sort();
      const legacyInventoryBefore = fs.readdirSync(legacyHomeDir).sort();
      const previousCwd = process.cwd();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        process.chdir(worktreeRoot);
        const resolved = await resolveRootForCommand({}, { globalDataDir, reporter: false });
        expect(resolved?.path).toBe(FileSystemUtils.canonicalizeExistingPath(worktreeRoot));
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
        warnSpy.mockRestore();
      }

      expect(fs.readFileSync(registryPath)).toEqual(registryBefore);
      expect(fs.readFileSync(path.join(worktreeRoot, 'rasen', 'config.yaml'))).toEqual(configBefore);
      expect(fs.readdirSync(mainHomeDir).sort()).toEqual(mainInventoryBefore);
      expect(fs.readdirSync(legacyHomeDir).sort()).toEqual(legacyInventoryBefore);
    });

    it('renders the mismatch warning in the resolved CLI locale (locale-diagnostic-reporter)', async () => {
      const projectRoot = await registerStore('locale-stale-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      const { resolveProjectHome } = await import('../../src/core/project-home.js');
      await resolveProjectHome(projectRoot, { globalDataDir });

      const savedRasenLang = process.env.RASEN_LANG;
      process.env.RASEN_LANG = 'ja';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await resolveRootForCommand(
          { project: 'locale-stale-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = warnSpy.mock.calls[0]?.[0] as string;
        expect(message).toContain(STALE_VERSION);
        // Japanese catalog entry, not the English fallback string.
        expect(message).not.toContain('the running CLI is');
        expect(message).toContain('実行中の CLI');
      } finally {
        warnSpy.mockRestore();
        if (savedRasenLang === undefined) {
          delete process.env.RASEN_LANG;
        } else {
          process.env.RASEN_LANG = savedRasenLang;
        }
      }
    });

    it('does not warn when the installed stamp matches the running CLI', async () => {
      const projectRoot = await registerStore('current-project', { type: 'project' });
      writeStaleSkill(projectRoot, await currentCliVersion());
      const { resolveProjectHome } = await import('../../src/core/project-home.js');
      await resolveProjectHome(projectRoot, { globalDataDir });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await resolveRootForCommand(
          { project: 'current-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('suppresses the warning under --json output', async () => {
      const projectRoot = await registerStore('json-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      const { resolveProjectHome } = await import('../../src/core/project-home.js');
      await resolveProjectHome(projectRoot, { globalDataDir });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const root = await resolveRootForCommand(
          { project: 'json-project' },
          { globalDataDir, json: true }
        );
        expect(root).not.toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('warns every time when the project has no machine-local home registered', async () => {
      const projectRoot = await registerStore('unregistered-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      // Deliberately no resolveProjectHome call: this project has no machine home.

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await resolveRootForCommand(
          { project: 'unregistered-project' },
          { globalDataDir, reporter: false }
        );
        await resolveRootForCommand(
          { project: 'unregistered-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).toHaveBeenCalledTimes(2);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('re-arms once the stamp version advances, even with a registered home', async () => {
      const projectRoot = await registerStore('rearm-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      const { resolveProjectHome } = await import('../../src/core/project-home.js');
      await resolveProjectHome(projectRoot, { globalDataDir });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await resolveRootForCommand(
          { project: 'rearm-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);

        warnSpy.mockClear();
        // Simulate `rasen update` re-stamping the skill with the current CLI version.
        writeStaleSkill(projectRoot, await currentCliVersion());
        await resolveRootForCommand(
          { project: 'rearm-project' },
          { globalDataDir, reporter: false }
        );
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('never fails or slows the command when the underlying lookup throws', async () => {
      const projectRoot = await registerStore('throwing-project', { type: 'project' });
      writeStaleSkill(projectRoot, STALE_VERSION);
      // A projectId is required for resolveProjectHome's ensure:false probe
      // to consult the (about-to-be-corrupted) machine-local project
      // registry at all; without one it degrades to "no home" before ever
      // reading that file, which would not exercise this failure mode.
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${randomUUID()}\n`
      );

      // Corrupts the machine-local project registry (not the store registry
      // used for --project selection above) so resolveProjectHome's read
      // throws inside checkSkillVersionGuard's try block — a realistic
      // failure mode, not a mocked one.
      const registryPath = path.join(globalDataDir, 'projects', 'registry.json');
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, '{not valid json');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const root = await resolveRootForCommand(
          { project: 'throwing-project' },
          { globalDataDir, reporter: false }
        );
        expect(root).not.toBeNull();
        expect(root?.path).toBe(projectRoot);
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
