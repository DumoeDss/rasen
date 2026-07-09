import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  PROJECT_REGISTRY_FILE_NAME,
  PROJECTS_DIR_NAME,
  deriveHomeBaseName,
  deriveProjectDisplayName,
  findDanglingProjectEntries,
  findProjectRegistryEntry,
  gcProjectRegistry,
  getProjectHomeDir,
  getProjectRegistryPath,
  getProjectsDir,
  parseProjectRegistryState,
  readProjectRegistryState,
  registerProject,
  serializeProjectRegistryState,
  updateProjectRegistryState,
  writeProjectRegistryState,
  type ProjectRegistryState,
} from '../../src/core/project-registry.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

describe('project-registry', () => {
  let globalDataDir: string;
  let fixturesRoot: string;

  beforeEach(() => {
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-registry-'));
    fixturesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-fixtures-'));
  });

  afterEach(() => {
    fs.rmSync(globalDataDir, { recursive: true, force: true });
    fs.rmSync(fixturesRoot, { recursive: true, force: true });
  });

  function makeProjectDir(name: string): string {
    const dir = path.join(fixturesRoot, `${name}-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  describe('path helpers', () => {
    it('derives projects dir and registry path under globalDataDir', () => {
      expect(getProjectsDir({ globalDataDir })).toBe(path.join(globalDataDir, PROJECTS_DIR_NAME));
      expect(getProjectRegistryPath({ globalDataDir })).toBe(
        path.join(globalDataDir, PROJECTS_DIR_NAME, PROJECT_REGISTRY_FILE_NAME)
      );
      expect(getProjectHomeDir('my-app-a1b2c3d4', { globalDataDir })).toBe(
        path.join(globalDataDir, PROJECTS_DIR_NAME, 'my-app-a1b2c3d4')
      );
    });
  });

  describe('schema round-trip', () => {
    it('parses and serializes a strict registry state', () => {
      const state: ProjectRegistryState = {
        version: 1,
        projects: {
          '/repos/my-app': {
            projectId: 'abc-123',
            name: 'my-app',
            mode: 'in-repo',
            home: 'my-app-a1b2c3d4',
            lastSeen: '2026-07-09T12:00:00.000Z',
          },
        },
      };

      const serialized = serializeProjectRegistryState(state);
      expect(parseProjectRegistryState(serialized)).toEqual(state);
    });

    it('rejects unknown fields and invalid mode', () => {
      expect(() =>
        parseProjectRegistryState(
          JSON.stringify({ version: 1, projects: {}, extra: true })
        )
      ).toThrow(/Invalid project registry state/u);

      expect(() =>
        parseProjectRegistryState(
          JSON.stringify({
            version: 1,
            projects: {
              '/x': {
                projectId: 'a',
                name: 'x',
                mode: 'weird',
                home: 'x-1',
                lastSeen: '2026-01-01T00:00:00.000Z',
              },
            },
          })
        )
      ).toThrow(/Invalid project registry state/u);
    });

    it('rejects malformed JSON with a clear diagnostic', () => {
      expect(() => parseProjectRegistryState('{not json')).toThrow(
        /Invalid project registry state/u
      );
    });
  });

  describe('registry IO', () => {
    it('returns null for a missing local registry', async () => {
      await expect(readProjectRegistryState({ globalDataDir })).resolves.toBeNull();
    });

    it('writes and reads the machine-local registry', async () => {
      const state: ProjectRegistryState = {
        version: 1,
        projects: {
          '/repos/my-app': {
            projectId: 'abc-123',
            name: 'my-app',
            mode: 'in-repo',
            home: 'my-app-a1b2c3d4',
            lastSeen: '2026-07-09T12:00:00.000Z',
          },
        },
      };

      await writeProjectRegistryState(state, { globalDataDir });
      expect(fs.existsSync(getProjectRegistryPath({ globalDataDir }))).toBe(true);
      await expect(readProjectRegistryState({ globalDataDir })).resolves.toEqual(state);
    });

    it('lands both entries from concurrent updateProjectRegistryState writers', async () => {
      await Promise.all([
        updateProjectRegistryState(async (current) => ({
          version: 1,
          projects: {
            ...(current?.projects ?? {}),
            '/repos/writer-a': {
              projectId: 'writer-a-id',
              name: 'writer-a',
              mode: 'in-repo',
              home: 'writer-a-home',
              lastSeen: '2026-07-09T12:00:00.000Z',
            },
          },
        }), { globalDataDir }),
        updateProjectRegistryState(async (current) => ({
          version: 1,
          projects: {
            ...(current?.projects ?? {}),
            '/repos/writer-b': {
              projectId: 'writer-b-id',
              name: 'writer-b',
              mode: 'in-repo',
              home: 'writer-b-home',
              lastSeen: '2026-07-09T12:00:00.000Z',
            },
          },
        }), { globalDataDir }),
      ]);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects['/repos/writer-a']).toBeDefined();
      expect(state?.projects['/repos/writer-b']).toBeDefined();
      // The file itself must still be valid, strict JSON.
      expect(() =>
        parseProjectRegistryState(fs.readFileSync(getProjectRegistryPath({ globalDataDir }), 'utf-8'))
      ).not.toThrow();
    });
  });

  describe('home naming', () => {
    it('derives a kebab-cased name and stable short hash', () => {
      const name = deriveProjectDisplayName('/repos/My Cool App');
      expect(name).toBe('my-cool-app');

      const home = deriveHomeBaseName('/repos/My Cool App', 'fixed-id');
      expect(home).toMatch(/^my-cool-app-[0-9a-f]{8}$/u);
      // Deterministic for the same projectId.
      expect(deriveHomeBaseName('/repos/My Cool App', 'fixed-id')).toBe(home);
    });

    it('falls back to "project" when the basename kebab-cases to empty', () => {
      expect(deriveProjectDisplayName('/repos/___')).toBe('project');
    });
  });

  describe('registerProject', () => {
    it('registers a fresh project and creates its home directory', async () => {
      const projectRoot = makeProjectDir('fresh');
      const projectId = randomUUID();

      const { entry, canonicalPath } = await registerProject(
        { projectRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(entry.projectId).toBe(projectId);
      expect(entry.mode).toBe('in-repo');
      expect(fs.existsSync(getProjectHomeDir(entry.home, { globalDataDir }))).toBe(true);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalPath]).toEqual(entry);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('is idempotent on re-registration of the same path', async () => {
      const projectRoot = makeProjectDir('idempotent');
      const projectId = randomUUID();

      const first = await registerProject(
        { projectRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const second = await registerProject(
        { projectRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(second.entry.home).toBe(first.entry.home);
      expect(second.entry.projectId).toBe(first.entry.projectId);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toHaveLength(1);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('rebinds a moved repo to its new path, reusing the home', async () => {
      const projectId = randomUUID();
      const originalRoot = makeProjectDir('move-src');
      const registered = await registerProject(
        { projectRoot: originalRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      const movedRoot = path.join(path.dirname(originalRoot), `moved-${randomUUID().slice(0, 8)}`);
      fs.renameSync(originalRoot, movedRoot);

      const afterMove = await registerProject(
        { projectRoot: movedRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(afterMove.entry.home).toBe(registered.entry.home);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[registered.canonicalPath]).toBeUndefined();
      expect(state?.projects[afterMove.canonicalPath]).toBeDefined();

      fs.rmSync(movedRoot, { recursive: true, force: true });
    });

    it('forks a second clone with a suffixed home when relationship is undeterminable', async () => {
      const projectId = randomUUID();
      // Same basename (so the derived home base name collides) under two
      // distinct parent directories (so the paths themselves differ).
      const parentA = path.join(fixturesRoot, `parent-a-${randomUUID().slice(0, 8)}`);
      const parentB = path.join(fixturesRoot, `parent-b-${randomUUID().slice(0, 8)}`);
      const cloneA = path.join(parentA, 'my-app');
      const cloneB = path.join(parentB, 'my-app');
      fs.mkdirSync(cloneA, { recursive: true });
      fs.mkdirSync(cloneB, { recursive: true });

      const registeredA = await registerProject(
        { projectRoot: cloneA, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const registeredB = await registerProject(
        { projectRoot: cloneB, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(registeredB.entry.home).not.toBe(registeredA.entry.home);
      expect(registeredB.entry.home).toBe(`${registeredA.entry.home}-2`);
      expect(fs.existsSync(getProjectHomeDir(registeredA.entry.home, { globalDataDir }))).toBe(true);
      expect(fs.existsSync(getProjectHomeDir(registeredB.entry.home, { globalDataDir }))).toBe(true);

      fs.rmSync(cloneA, { recursive: true, force: true });
      fs.rmSync(cloneB, { recursive: true, force: true });
    });

    it('forks (does not share) a same-tree copy that carries no separate .git (MINOR-2)', async () => {
      const repoRoot = makeProjectDir('monorepo');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.mkdirSync(path.join(repoRoot, 'packages', 'app'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'packages', 'app', 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const original = await registerProject(
        { projectRoot: path.join(repoRoot, 'packages', 'app'), projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      // A `cp -r` copy inside the SAME working tree - no separate .git, so
      // it shares both --git-common-dir AND --git-dir with the original
      // (both resolve to the one enclosing repo). Only the common-dir
      // matches a true worktree sibling; this must fork, not share.
      const copyPath = path.join(repoRoot, 'packages', 'app-experiment');
      fs.cpSync(path.join(repoRoot, 'packages', 'app'), copyPath, { recursive: true });

      const copy = await registerProject(
        { projectRoot: copyPath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(copy.entry.home).not.toBe(original.entry.home);
      expect(fs.existsSync(getProjectHomeDir(original.entry.home, { globalDataDir }))).toBe(true);
      expect(fs.existsSync(getProjectHomeDir(copy.entry.home, { globalDataDir }))).toBe(true);

      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('worktree-share detection wins over a dangling same-id entry from a deleted clone (MINOR-1)', async () => {
      const projectId = randomUUID();
      const parentA = path.join(fixturesRoot, `precedence-a-${randomUUID().slice(0, 8)}`);
      const parentB = path.join(fixturesRoot, `precedence-b-${randomUUID().slice(0, 8)}`);
      const cloneA = path.join(parentA, 'my-app');
      const cloneB = path.join(parentB, 'my-app');
      fs.mkdirSync(cloneB, { recursive: true });

      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      fs.mkdirSync(cloneA, { recursive: true });
      execFileSync('git', ['init'], { cwd: cloneA, stdio: 'ignore' });
      fs.writeFileSync(path.join(cloneA, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: cloneA, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: cloneA, env: gitExecEnv, stdio: 'ignore' });

      const registeredA = await registerProject(
        { projectRoot: cloneA, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const registeredB = await registerProject(
        { projectRoot: cloneB, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      expect(registeredB.entry.home).toBe(`${registeredA.entry.home}-2`);

      // Clone B is deleted but NOT GC'd - its entry (home -2) still
      // dangles in the registry alongside clone A's live entry.
      fs.rmSync(cloneB, { recursive: true, force: true });

      const worktreePath = path.join(parentA, `worktree-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: cloneA,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const worktree = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      // Must share clone A's home (a real worktree of it), not hijack
      // clone B's dangling home via the moved-repo rebind path.
      expect(worktree.entry.home).toBe(registeredA.entry.home);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: cloneA,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      fs.rmSync(cloneA, { recursive: true, force: true });
    });

    it('shares one home across Git worktrees of the same repository', async () => {
      const repoRoot = makeProjectDir('worktree-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const worktreePath = path.join(path.dirname(repoRoot), `worktree-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const projectId = randomUUID();
      const main = await registerProject(
        { projectRoot: repoRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const worktree = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(worktree.entry.home).toBe(main.entry.home);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });
  });

  describe('Windows path canonicalization', () => {
    it('registers the same entry regardless of path casing on a case-insensitive filesystem', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const projectRoot = makeProjectDir('Casing-Test');
      const projectId = randomUUID();
      const upper = await registerProject(
        { projectRoot: projectRoot.toUpperCase(), projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const lower = await registerProject(
        { projectRoot: projectRoot.toLowerCase(), projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(lower.canonicalPath).toBe(upper.canonicalPath);
      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toHaveLength(1);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });
  });

  describe('findProjectRegistryEntry', () => {
    it('finds a registered project by canonical path', async () => {
      const projectRoot = makeProjectDir('lookup');
      const projectId = randomUUID();
      const { entry } = await registerProject({ projectRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      const found = await findProjectRegistryEntry(projectRoot, { globalDataDir });
      expect(found?.entry).toEqual(entry);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('returns null for an unregistered project', async () => {
      const projectRoot = makeProjectDir('unregistered');
      const found = await findProjectRegistryEntry(projectRoot, { globalDataDir });
      expect(found).toBeNull();
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });
  });

  describe('findDanglingProjectEntries and gcProjectRegistry', () => {
    it('reports no dangling entries against an empty or healthy registry', async () => {
      await expect(findDanglingProjectEntries({ globalDataDir })).resolves.toEqual([]);

      const projectRoot = makeProjectDir('healthy');
      await registerProject({ projectRoot, projectId: randomUUID(), mode: 'in-repo' }, { globalDataDir });
      await expect(findDanglingProjectEntries({ globalDataDir })).resolves.toEqual([]);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('reports an entry as dangling once its path is deleted, and --gc removes it plus its orphaned home', async () => {
      const projectRoot = makeProjectDir('doomed');
      const { entry, canonicalPath } = await registerProject(
        { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );
      const homeDir = getProjectHomeDir(entry.home, { globalDataDir });
      expect(fs.existsSync(homeDir)).toBe(true);

      fs.rmSync(projectRoot, { recursive: true, force: true });

      const dangling = await findDanglingProjectEntries({ globalDataDir });
      expect(dangling).toHaveLength(1);
      expect(dangling[0].path).toBe(canonicalPath);
      expect(dangling[0].entry.home).toBe(entry.home);

      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((removed) => removed.path)).toEqual([canonicalPath]);
      expect(gcResult.removedHomes).toEqual([entry.home]);
      expect(fs.existsSync(homeDir)).toBe(false);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalPath]).toBeUndefined();
    });

    it('keeps a home still referenced by a live (worktree-shared) entry', async () => {
      const repoRoot = makeProjectDir('gc-worktree-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const worktreePath = path.join(path.dirname(repoRoot), `gc-worktree-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const worktree = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      expect(worktree.entry.home).toBe(main.entry.home);

      // Delete the worktree checkout only (simulating a dangling entry),
      // leaving the main repo (and thus the shared home) live.
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((removed) => removed.path)).toEqual([worktree.canonicalPath]);
      // The home is still referenced by the main repo's live entry - keep it.
      expect(gcResult.removedHomes).toEqual([]);
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('performs no writes when there is nothing to remove', async () => {
      const projectRoot = makeProjectDir('nothing-to-gc');
      await registerProject({ projectRoot, projectId: randomUUID(), mode: 'in-repo' }, { globalDataDir });

      const before = fs.readFileSync(getProjectRegistryPath({ globalDataDir }), 'utf-8');
      const gcResult = await gcProjectRegistry({ globalDataDir });
      const after = fs.readFileSync(getProjectRegistryPath({ globalDataDir }), 'utf-8');

      expect(gcResult.removedEntries).toEqual([]);
      expect(gcResult.removedHomes).toEqual([]);
      expect(after).toBe(before);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('creates no registry.json on a machine with no registry at all (TRIVIAL-2)', async () => {
      const gcResult = await gcProjectRegistry({ globalDataDir });

      expect(gcResult.removedEntries).toEqual([]);
      expect(gcResult.removedHomes).toEqual([]);
      expect(fs.existsSync(getProjectRegistryPath({ globalDataDir }))).toBe(false);
    });

    it('collects and deletes home directories with no registry entry at all (MINOR-4a)', async () => {
      const projectRoot = makeProjectDir('has-entry');
      const { entry } = await registerProject(
        { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );

      // Simulate a crashed prior GC: a home directory left behind that no
      // registry entry references at all (not even a dangling one).
      const orphanHome = 'orphan-home-left-behind';
      fs.mkdirSync(getProjectHomeDir(orphanHome, { globalDataDir }), { recursive: true });

      const gcResult = await gcProjectRegistry({ globalDataDir });

      expect(gcResult.removedHomes).toContain(orphanHome);
      expect(fs.existsSync(getProjectHomeDir(orphanHome, { globalDataDir }))).toBe(false);
      // The referenced home from the still-live entry is untouched.
      expect(fs.existsSync(getProjectHomeDir(entry.home, { globalDataDir }))).toBe(true);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('never leaves a home deleted while a concurrent registration re-claims its exact name (MAJOR-1 TOCTOU)', async () => {
      const projectId = randomUUID();
      const parentA = path.join(fixturesRoot, `toctou-a-${randomUUID().slice(0, 8)}`);
      const parentB = path.join(fixturesRoot, `toctou-b-${randomUUID().slice(0, 8)}`);
      const cloneA = path.join(parentA, 'my-app');
      fs.mkdirSync(cloneA, { recursive: true });

      const registered = await registerProject(
        { projectRoot: cloneA, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      const home = registered.entry.home;
      const homeDir = getProjectHomeDir(home, { globalDataDir });
      expect(fs.existsSync(homeDir)).toBe(true);

      // The old clone vanishes (dangling), and a new clone with the SAME
      // basename appears elsewhere - re-registration re-derives the
      // identical base home name (or, if it wins the race first, rebinds
      // onto it directly). Either way GC must never delete a home a
      // concurrent registration is holding or has just re-created.
      fs.rmSync(cloneA, { recursive: true, force: true });
      const cloneB = path.join(parentB, 'my-app');
      fs.mkdirSync(cloneB, { recursive: true });

      const [, freshRegistration] = await Promise.all([
        gcProjectRegistry({ globalDataDir }),
        registerProject({ projectRoot: cloneB, projectId, mode: 'in-repo' }, { globalDataDir }),
      ]);

      expect(freshRegistration.entry.home).toBe(home);
      expect(fs.existsSync(homeDir)).toBe(true);
      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[freshRegistration.canonicalPath]?.home).toBe(home);

      fs.rmSync(cloneB, { recursive: true, force: true });
    });
  });
});
