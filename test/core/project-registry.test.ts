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
  findAdoptableProjectIdentity,
  findDanglingProjectEntries,
  findProjectRegistryEntry,
  findWorktreeDuplicateEntries,
  gcProjectRegistry,
  getProjectHomeDir,
  getProjectRegistryPath,
  getProjectsDir,
  parseProjectRegistryState,
  readProjectRegistryState,
  registerProject,
  resolveRegistrationRoot,
  serializeProjectRegistryState,
  updateProjectRegistryState,
  writeProjectRegistryState,
  type ProjectRegistryState,
} from '../../src/core/project-registry.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
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

    it('unifies same-tree paths of one repo onto the single main-checkout entry (worktree-aware-spaces D1)', async () => {
      const repoRoot = makeProjectDir('monorepo');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.mkdirSync(path.join(repoRoot, 'packages', 'app'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'packages', 'app', 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      // Registration pierces any path inside the working tree to the MAIN
      // checkout's root (D1's resolveRegistrationRoot). A subdirectory and a
      // same-tree `cp -r` copy therefore both resolve to the ONE entry keyed at
      // the repo root — same identity, one space (no more path-keyed forks).
      const original = await registerProject(
        { projectRoot: path.join(repoRoot, 'packages', 'app'), projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      expect(original.canonicalPath).toBe(FileSystemUtils.canonicalizeExistingPath(repoRoot));

      const copyPath = path.join(repoRoot, 'packages', 'app-experiment');
      fs.cpSync(path.join(repoRoot, 'packages', 'app'), copyPath, { recursive: true });

      const copy = await registerProject(
        { projectRoot: copyPath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(copy.canonicalPath).toBe(original.canonicalPath);
      expect(copy.entry.home).toBe(original.entry.home);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toEqual([original.canonicalPath]);

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

    // D3: a freshly created shared home is named after the MAIN repo
    // regardless of whether the worktree or the main repo registers first.
    it('names a fresh shared home after the main repo even when the worktree registers first', async () => {
      const repoRoot = makeProjectDir('rasen-main-repo');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      // A worktree path whose basename would, under the old (path-basename)
      // derivation, wrongly become the shared home's permanent name.
      const worktreePath = path.join(path.dirname(repoRoot), `feature-branch-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const projectId = randomUUID();

      // Worktree registers FIRST (fresh projectId => case 2c, the base-name
      // derivation under test).
      const worktree = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      const expectedBaseHome = deriveHomeBaseName(repoRoot, projectId);
      expect(worktree.entry.home).toBe(expectedBaseHome);
      expect(worktree.entry.home.startsWith('feature-branch')).toBe(false);

      // The main repo registering afterward must share the SAME home (case 2a).
      const main = await registerProject(
        { projectRoot: repoRoot, projectId, mode: 'in-repo' },
        { globalDataDir }
      );
      expect(main.entry.home).toBe(worktree.entry.home);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    // Self-heal (D3): re-registering a worktree entry at its own path (the
    // touchProjectRegistry case-1 path-exact refresh) must never rename or
    // re-create the home directory.
    it('does not rename the home directory when a worktree entry self-heals', async () => {
      const repoRoot = makeProjectDir('rasen-selfheal-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const worktreePath = path.join(path.dirname(repoRoot), `selfheal-worktree-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const projectId = randomUUID();
      const first = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      // Re-register the SAME path (case 1, path-exact — what a self-heal
      // touch does) after the home directory already exists on disk.
      const refreshed = await registerProject(
        { projectRoot: worktreePath, projectId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(refreshed.entry.home).toBe(first.entry.home);
      expect(fs.existsSync(getProjectHomeDir(first.entry.home, { globalDataDir }))).toBe(true);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });
  });

  describe('worktree piercing (worktree-aware-spaces D1)', () => {
    /** Builds a committed git repo at `root`. */
    function initRepo(root: string, gitExecEnv: NodeJS.ProcessEnv): void {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: root, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: root, env: gitExecEnv, stdio: 'ignore' });
    }

    it('resolveRegistrationRoot pierces a worktree to the main checkout and is identity/noop elsewhere', async () => {
      const repoRoot = makeProjectDir('pierce-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      initRepo(repoRoot, gitExecEnv);
      const worktreePath = path.join(path.dirname(repoRoot), `pierce-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const canonicalMain = FileSystemUtils.canonicalizeExistingPath(repoRoot);
      // A linked worktree pierces to the main checkout.
      expect(await resolveRegistrationRoot(FileSystemUtils.canonicalizeExistingPath(worktreePath))).toBe(canonicalMain);
      // The main checkout pierces to itself.
      expect(await resolveRegistrationRoot(canonicalMain)).toBe(canonicalMain);
      // A non-git path is returned unchanged.
      const plain = makeProjectDir('pierce-plain');
      const canonicalPlain = FileSystemUtils.canonicalizeExistingPath(plain);
      expect(await resolveRegistrationRoot(canonicalPlain)).toBe(canonicalPlain);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(plain, { recursive: true, force: true });
    });

    it('registers only the main entry when a worktree registers (no worktree-keyed entry)', async () => {
      const repoRoot = makeProjectDir('wt-only-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      initRepo(repoRoot, gitExecEnv);
      const worktreePath = path.join(path.dirname(repoRoot), `wt-only-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const result = await registerProject({ projectRoot: worktreePath, projectId, mode: 'in-repo' }, { globalDataDir });

      const canonicalMain = FileSystemUtils.canonicalizeExistingPath(repoRoot);
      expect(result.canonicalPath).toBe(canonicalMain);
      expect(result.entry.name).toBe(deriveProjectDisplayName(canonicalMain));

      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toEqual([canonicalMain]);
      expect(state?.projects[FileSystemUtils.canonicalizeExistingPath(worktreePath)]).toBeUndefined();

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('falls back to the worktree root when the main checkout is gone', async () => {
      const repoRoot = makeProjectDir('fallback-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      initRepo(repoRoot, gitExecEnv);
      const worktreePath = path.join(path.dirname(repoRoot), `fallback-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      // The main checkout (with its shared .git) is deleted, breaking git
      // resolution from the worktree — registration must fall back to keying
      // the surviving worktree so the work is never homeless.
      fs.rmSync(repoRoot, { recursive: true, force: true });

      const projectId = randomUUID();
      const result = await registerProject({ projectRoot: worktreePath, projectId, mode: 'in-repo' }, { globalDataDir });

      expect(result.canonicalPath).toBe(FileSystemUtils.canonicalizeExistingPath(worktreePath));
      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[result.canonicalPath]).toBeDefined();

      fs.rmSync(worktreePath, { recursive: true, force: true });
    });

    it('prunes a legacy sibling worktree duplicate on the next registration write', async () => {
      const repoRoot = makeProjectDir('prune-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      initRepo(repoRoot, gitExecEnv);
      const worktreePath = path.join(path.dirname(repoRoot), `prune-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const canonicalWorktree = FileSystemUtils.canonicalizeExistingPath(worktreePath);

      // Seed a LEGACY worktree-keyed duplicate (as an older build would have
      // written), sharing the main entry's home, alongside the live worktree.
      await updateProjectRegistryState((current) => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [canonicalWorktree]: { ...main.entry, name: 'prune-wt', lastSeen: '2026-07-09T12:00:00.000Z' },
        },
      }), { globalDataDir });

      // Any registration write for the same identity prunes the live sibling.
      await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalWorktree]).toBeUndefined();
      expect(state?.projects[main.canonicalPath]).toBeDefined();
      // The shared home is untouched.
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('findProjectRegistryEntry resolves the main entry from a worktree path', async () => {
      const repoRoot = makeProjectDir('lookup-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      initRepo(repoRoot, gitExecEnv);
      const worktreePath = path.join(path.dirname(repoRoot), `lookup-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      const found = await findProjectRegistryEntry(worktreePath, { globalDataDir });
      expect(found?.canonicalPath).toBe(main.canonicalPath);
      expect(found?.entry.home).toBe(main.entry.home);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
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

  describe('findAdoptableProjectIdentity (adoptable-identity lookup)', () => {
    it("returns the registered entry's projectId for a registered canonical root", async () => {
      const projectRoot = makeProjectDir('adopt-registered');
      const projectId = randomUUID();
      await registerProject({ projectRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      await expect(findAdoptableProjectIdentity(projectRoot, { globalDataDir })).resolves.toEqual({
        adoptable: true,
        projectId,
      });

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('reports "unregistered" for a root the registry has no entry for', async () => {
      // Register an unrelated project so the registry file exists — this pins
      // "no entry for THIS root" separately from "no registry at all" below.
      await registerProject(
        { projectRoot: makeProjectDir('adopt-unregistered-other'), projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir }
      );
      const projectRoot = makeProjectDir('adopt-unregistered');

      await expect(findAdoptableProjectIdentity(projectRoot, { globalDataDir })).resolves.toEqual({
        adoptable: false,
        reason: 'unregistered',
      });

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('means "unregistered" and creates no registry file on a machine with no registry at all', async () => {
      const projectRoot = makeProjectDir('adopt-no-registry');

      await expect(findAdoptableProjectIdentity(projectRoot, { globalDataDir })).resolves.toEqual({
        adoptable: false,
        reason: 'unregistered',
      });
      expect(fs.existsSync(getProjectRegistryPath({ globalDataDir }))).toBe(false);

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it.runIf(process.platform === 'win32')('adopts through the claim-key fast path when the single entry key differs from the root only by case', async () => {
      const projectRoot = makeProjectDir('Adopt-Case-FastPath');
      const projectId = randomUUID();
      // Seed the registry key directly as a case-variant spelling (registration
      // itself canonicalizes, so it cannot produce this shape): one entry
      // whose key claims the same directory on a case-insensitive filesystem.
      // The lookup answers through the no-spawn claim-key fast path.
      await writeProjectRegistryState(
        {
          version: 1,
          projects: {
            [projectRoot.toLowerCase()]: {
              projectId,
              name: 'adopt-case-fast-path',
              mode: 'in-repo',
              home: 'adopt-case-home',
              lastSeen: '2026-08-16T12:00:00.000Z',
            },
          },
        },
        { globalDataDir }
      );

      await expect(findAdoptableProjectIdentity(projectRoot, { globalDataDir })).resolves.toEqual({
        adoptable: true,
        projectId,
      });

      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('resolves a linked-worktree run to the main checkout registered identity', async () => {
      const repoRoot = makeProjectDir('adopt-wt-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      const worktreePath = path.join(path.dirname(repoRoot), `adopt-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      await expect(findAdoptableProjectIdentity(worktreePath, { globalDataDir })).resolves.toEqual({
        adoptable: true,
        projectId,
      });

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('reports the fixed-metadata conflict rather than a representative id when the live aliases disagree', async () => {
      const repoRoot = makeProjectDir('adopt-conflict-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      const worktreePath = path.join(path.dirname(repoRoot), `adopt-conflict-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const canonicalWorktree = FileSystemUtils.canonicalizeExistingPath(worktreePath);

      // A second LIVE alias resolving to the same canonical root (a legacy
      // worktree-keyed entry) that disagrees on identity and home — exactly
      // the state registration refuses to pick a winner for. The lookup must
      // not offer either side's id for adoption.
      await updateProjectRegistryState((current) => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [canonicalWorktree]: {
            projectId: randomUUID(),
            name: 'adopt-conflict-wt',
            mode: 'in-repo',
            home: `${main.entry.home}-conflicting`,
            lastSeen: '2026-07-09T12:00:00.000Z',
          },
        },
      }), { globalDataDir });

      const lookup = await findAdoptableProjectIdentity(repoRoot, { globalDataDir });
      expect(lookup).toEqual({ adoptable: false, reason: 'fixedMetadataConflict' });

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
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

    it('keeps a home still referenced by a live entry when a dangling duplicate is removed', async () => {
      const repoRoot = makeProjectDir('gc-worktree-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

      // A registration from a worktree now pierces to the main entry (no
      // separate worktree entry is created), so a home-sharing DUPLICATE only
      // arises from a legacy registry. Seed one keyed at a now-deleted worktree
      // path, sharing the main entry's home — it is dangling (path gone), so gc
      // removes the entry but must KEEP the home (still referenced by `main`).
      const legacyWorktreePath = path.join(path.dirname(repoRoot), `gc-legacy-wt-${randomUUID().slice(0, 8)}`);
      await updateProjectRegistryState((current) => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [legacyWorktreePath]: { ...main.entry, lastSeen: '2026-07-09T12:00:00.000Z' },
        },
      }), { globalDataDir });

      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((removed) => removed.path)).toEqual([legacyWorktreePath]);
      // The home is still referenced by the main repo's live entry - keep it.
      expect(gcResult.removedHomes).toEqual([]);
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('reports worktree-duplicate entries read-only and --gc collapses them keeping the shared home', async () => {
      const repoRoot = makeProjectDir('dup-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const wtA = path.join(path.dirname(repoRoot), `dup-wtA-${randomUUID().slice(0, 8)}`);
      const wtB = path.join(path.dirname(repoRoot), `dup-wtB-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', wtA], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      execFileSync('git', ['worktree', 'add', wtB], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });
      const canonicalA = FileSystemUtils.canonicalizeExistingPath(wtA);
      const canonicalB = FileSystemUtils.canonicalizeExistingPath(wtB);

      // Seed two legacy worktree-keyed duplicates sharing the main entry's home.
      await updateProjectRegistryState((current) => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [canonicalA]: { ...main.entry, name: 'dup-wta', lastSeen: '2026-07-09T12:00:00.000Z' },
          [canonicalB]: { ...main.entry, name: 'dup-wtb', lastSeen: '2026-07-09T12:00:00.000Z' },
        },
      }), { globalDataDir });

      // Read-only report names both duplicates without mutating the registry.
      const before = fs.readFileSync(getProjectRegistryPath({ globalDataDir }), 'utf-8');
      const duplicates = await findWorktreeDuplicateEntries({ globalDataDir });
      expect(duplicates.map((d) => d.path).sort()).toEqual([canonicalA, canonicalB].sort());
      expect(duplicates.every((d) => d.mainRoot === main.canonicalPath)).toBe(true);
      expect(fs.readFileSync(getProjectRegistryPath({ globalDataDir }), 'utf-8')).toBe(before);

      // --gc collapses both, keeps the main entry and the shared home.
      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((r) => r.path).sort()).toEqual([canonicalA, canonicalB].sort());
      expect(gcResult.removedHomes).toEqual([]);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toEqual([main.canonicalPath]);
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      for (const wt of [wtA, wtB]) {
        execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      }
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('M10 normalization: findWorktreeDuplicateEntries detects a case-different UUID across worktree/main paths', async () => {
      // Trivial 3: the existing worktree-duplicate test seeds duplicates
      // with the SAME projectId (case-exact match). This test seeds the
      // worktree-keyed entry with an UPPERCASE projectId while the main
      // entry carries lowercase — the normalization at lines 467-469 must
      // recognize them as the same project and report the duplicate.
      // Without normalization, the case-difference would hide the duplicate.
      const repoRoot = makeProjectDir('norm-dup-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      const wt = path.join(path.dirname(repoRoot), `norm-dup-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', wt], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectIdLower = randomUUID();
      const projectIdUpper = projectIdLower.toUpperCase();
      const main = await registerProject(
        { projectRoot: repoRoot, projectId: projectIdLower, mode: 'in-repo' },
        { globalDataDir }
      );
      const canonicalWt = FileSystemUtils.canonicalizeExistingPath(wt);

      // Seed a legacy worktree-keyed entry with the UPPERCASE projectId,
      // sharing the main entry's home. (Different case, same identity.)
      await updateProjectRegistryState((current) => ({
        version: 1,
        projects: {
          ...(current?.projects ?? {}),
          [canonicalWt]: {
            ...main.entry,
            projectId: projectIdUpper,
            name: 'norm-dup-wt',
            lastSeen: '2026-07-09T12:00:00.000Z',
          },
        },
      }), { globalDataDir });

      const duplicates = await findWorktreeDuplicateEntries({ globalDataDir });
      expect(duplicates.map((d) => d.path)).toEqual([canonicalWt]);
      expect(duplicates[0].mainRoot).toBe(main.canonicalPath);

      // --gc collapses the case-different duplicate onto the main entry,
      // exercising the normalization at lines 558-559, and keeps the home.
      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((r) => r.path)).toEqual([canonicalWt]);
      expect(gcResult.removedHomes).toEqual([]);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(Object.keys(state?.projects ?? {})).toEqual([main.canonicalPath]);
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('M10 normalization: registerProject place() prunes a case-different sibling worktree duplicate', async () => {
      // Minor 1 regression: place()'s sibling-pruning loop must normalize
      // both sides. Seed a main entry with a lowercase projectId and a
      // legacy worktree-keyed entry with the UPPERCASE projectId (sharing
      // the home). A fresh registration for the main path with the lowercase
      // projectId must prune the case-different worktree sibling in the
      // same write — without normalization, the strict !== comparison would
      // leave the duplicate alive until gc.
      const repoRoot = makeProjectDir('norm-prune-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      const worktreePath = path.join(
        path.dirname(repoRoot),
        `norm-prune-wt-${randomUUID().slice(0, 8)}`
      );
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });

      const projectIdLower = randomUUID();
      const projectIdUpper = projectIdLower.toUpperCase();
      const main = await registerProject(
        { projectRoot: repoRoot, projectId: projectIdLower, mode: 'in-repo' },
        { globalDataDir }
      );
      const canonicalWorktree = FileSystemUtils.canonicalizeExistingPath(worktreePath);

      // Seed the case-different legacy sibling.
      await updateProjectRegistryState(
        (current) => ({
          version: 1,
          projects: {
            ...(current?.projects ?? {}),
            [canonicalWorktree]: {
              ...main.entry,
              projectId: projectIdUpper,
              name: 'norm-prune-wt',
              lastSeen: '2026-07-09T12:00:00.000Z',
            },
          },
        }),
        { globalDataDir }
      );

      // Re-register the main path; the pruning loop must collapse the
      // case-different worktree sibling in the same write.
      await registerProject(
        { projectRoot: repoRoot, projectId: projectIdLower, mode: 'in-repo' },
        { globalDataDir }
      );

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalWorktree]).toBeUndefined();
      expect(state?.projects[main.canonicalPath]).toBeDefined();
      expect(fs.existsSync(getProjectHomeDir(main.entry.home, { globalDataDir }))).toBe(true);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    it('rebinds a worktree-keyed entry onto the main root when the main is unregistered', async () => {
      const repoRoot = makeProjectDir('rebind-main');
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const wt = path.join(path.dirname(repoRoot), `rebind-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', wt], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const projectId = randomUUID();
      const canonicalWt = FileSystemUtils.canonicalizeExistingPath(wt);
      const canonicalMain = FileSystemUtils.canonicalizeExistingPath(repoRoot);
      const home = deriveHomeBaseName(canonicalMain, projectId);
      fs.mkdirSync(getProjectHomeDir(home, { globalDataDir }), { recursive: true });

      // Only the worktree-keyed entry exists; the main root exists on disk but
      // is unregistered — gc must rebind the entry onto the main root.
      await writeProjectRegistryState(
        {
          version: 1,
          projects: {
            [canonicalWt]: {
              projectId,
              name: 'rebind-wt',
              mode: 'in-repo',
              home,
              lastSeen: '2026-07-09T12:00:00.000Z',
            },
          },
        },
        { globalDataDir }
      );

      const gcResult = await gcProjectRegistry({ globalDataDir });
      expect(gcResult.removedEntries.map((r) => r.path)).toEqual([canonicalWt]);
      expect(gcResult.removedHomes).toEqual([]);

      const state = await readProjectRegistryState({ globalDataDir });
      expect(state?.projects[canonicalMain]?.home).toBe(home);
      expect(state?.projects[canonicalWt]).toBeUndefined();

      execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
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

  // ---------------------------------------------------------------------------
  // M10 — normalizeProjectIdentity at registry comparisons
  // ---------------------------------------------------------------------------

  describe('M10 — project identity normalization', () => {
    it('finds an existing uppercase-UUID entry when the same path re-registers with lowercase', async () => {
      const dir = makeProjectDir('upper-project');
      const upperId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';

      // First registration with the uppercase UUID.
      const first = await registerProject(
        { projectRoot: dir, projectId: upperId, mode: 'in-repo' },
        { globalDataDir }
      );

      // Second registration at the SAME path with the LOWERCASE form.
      // normalizeProjectIdentity makes these the same identity, so the
      // registry finds the existing entry (path-exact match) and does NOT
      // create a duplicate.
      const lowerId = upperId.toLowerCase();
      const second = await registerProject(
        { projectRoot: dir, projectId: lowerId, mode: 'in-repo' },
        { globalDataDir }
      );

      expect(second.canonicalPath).toBe(first.canonicalPath);
      // Same home — no duplicate was created.
      expect(second.entry.home).toBe(first.entry.home);
    });

    it('treats the same path with different-case projectIds as the same project (no clone-fork)', async () => {
      const dir = makeProjectDir('case-project');
      const upperId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';

      const first = await registerProject(
        { projectRoot: dir, projectId: upperId, mode: 'in-repo' },
        { globalDataDir }
      );

      // The registry retains the original string for display. Re-registering
      // with a different case at the same path is a path-exact match — the
      // entry stays as-is. What matters is that same-ID lookups elsewhere
      // (worktree share, moved repo) normalize both sides.
      const state = await readProjectRegistryState({ globalDataDir });
      expect(state).toBeDefined();
      expect(state!.projects[first.canonicalPath]?.projectId).toBe(upperId);
    });
  });

  describe('cache fields (project-install-manifest)', () => {
    it('round-trips the new cache fields through serialize/parse', () => {
      const state: ProjectRegistryState = {
        version: 1,
        projects: {
          '/repos/my-app': {
            projectId: 'abc-123',
            name: 'my-app',
            mode: 'in-repo',
            home: 'my-app-a1b2c3d4',
            lastSeen: '2026-07-09T12:00:00.000Z',
            tools: ['claude', 'codex'],
            installedVersion: '0.1.7',
            lastUpdated: '2026-07-28T12:00:00.000Z',
          },
        },
      };

      const serialized = serializeProjectRegistryState(state);
      expect(parseProjectRegistryState(serialized)).toEqual(state);
    });

    it('parses a legacy entry (without cache fields) under the new schema', () => {
      const legacyJson = JSON.stringify({
        version: 1,
        projects: {
          '/repos/old': {
            projectId: 'old-1',
            name: 'old',
            mode: 'in-repo',
            home: 'old-deadbeef',
            lastSeen: '2026-01-01T00:00:00.000Z',
          },
        },
      });
      const parsed = parseProjectRegistryState(legacyJson);
      expect(parsed.projects['/repos/old'].tools).toBeUndefined();
      expect(parsed.projects['/repos/old'].installedVersion).toBeUndefined();
      expect(parsed.projects['/repos/old'].lastUpdated).toBeUndefined();
    });

    it('.strict() still rejects genuinely unknown keys', () => {
      expect(() =>
        parseProjectRegistryState(
          JSON.stringify({
            version: 1,
            projects: {
              '/x': {
                projectId: 'a',
                name: 'x',
                mode: 'in-repo',
                home: 'x-1',
                lastSeen: '2026-01-01T00:00:00.000Z',
                color: 'red',
              },
            },
          })
        )
      ).toThrow(/Invalid project registry state/u);
    });

    it('registerProject with tools + installedVersion writes them on a fresh entry', async () => {
      const dir = makeProjectDir('cache-fresh');
      const { entry } = await registerProject(
        {
          projectRoot: dir,
          projectId: 'cache-fresh-1',
          mode: 'in-repo',
          tools: ['claude'],
          installedVersion: '0.1.7',
        },
        { globalDataDir }
      );
      expect(entry.tools).toEqual(['claude']);
      expect(entry.installedVersion).toBe('0.1.7');
    });

    it('registerProject on a path-exact entry WITHOUT cache fields preserves the existing values', async () => {
      const dir = makeProjectDir('cache-preserve');
      // First registration: supplies cache fields.
      const first = await registerProject(
        {
          projectRoot: dir,
          projectId: 'cache-preserve-1',
          mode: 'in-repo',
          tools: ['claude', 'codex'],
          installedVersion: '0.1.5',
        },
        { globalDataDir }
      );
      expect(first.entry.tools).toEqual(['claude', 'codex']);
      expect(first.entry.installedVersion).toBe('0.1.5');

      // Second registration: does NOT supply cache fields — should preserve.
      const second = await registerProject(
        { projectRoot: dir, projectId: 'cache-preserve-1', mode: 'in-repo' },
        { globalDataDir }
      );
      expect(second.entry.tools).toEqual(['claude', 'codex']);
      expect(second.entry.installedVersion).toBe('0.1.5');
    });
  });
});
