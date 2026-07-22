import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { resolveProjectHome, touchProjectRegistry } from '../../src/core/project-home.js';
import { readProjectConfig } from '../../src/core/project-config.js';
import {
  getProjectRegistryPath,
  readProjectRegistryState,
  registerProject,
  writeProjectRegistryState,
} from '../../src/core/project-registry.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

describe('project-home', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-home-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-home-gdd-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('ensure mode mints identity, registers, and creates the home directory end-to-end', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });

    expect(home).not.toBeNull();
    expect(home!.mode).toBe('in-repo');
    expect(path.isAbsolute(home!.homeDir)).toBe(true);
    expect(fs.existsSync(home!.homeDir)).toBe(true);

    // Config gained a projectId.
    const config = readProjectConfig(projectRoot);
    expect(config?.projectId).toBe(home!.projectId);

    // Registry entry exists.
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
    const state = await readProjectRegistryState({ globalDataDir });
    expect(state?.projects[canonicalPath]?.projectId).toBe(home!.projectId);

    // workDir / archiveDir are absolute and platform-joined under homeDir.
    const workDir = home!.workDir('my-change');
    expect(workDir.startsWith(home!.homeDir)).toBe(true);
    expect(workDir.endsWith(path.join('changes', 'my-change', 'work'))).toBe(true);
    expect(home!.archiveDir).toBe(path.join(home!.homeDir, 'archive'));

    // changes/ and archive/ are NOT pre-created by the resolver.
    expect(fs.existsSync(path.join(home!.homeDir, 'changes'))).toBe(false);
    expect(fs.existsSync(home!.archiveDir)).toBe(false);
  });

  it('archivedWorkDir is distinct from workDir for a same-base-name pair', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });

    const liveWorkDir = home!.workDir('foo');
    const archivedWorkDir = home!.archivedWorkDir('2026-07-06-foo');

    expect(archivedWorkDir).not.toBe(liveWorkDir);
    expect(archivedWorkDir.startsWith(home!.homeDir)).toBe(true);
    expect(archivedWorkDir).toBe(
      path.join(home!.homeDir, 'changes', 'archive', '2026-07-06-foo', 'work')
    );
    // Both live inside homeDir -> both survive registry GC (verified separately
    // in project-registry.test.ts: GC only removes unreferenced top-level dirs).
    expect(liveWorkDir.startsWith(home!.homeDir)).toBe(true);
  });

  it('ensure mode is idempotent (re-init preserves projectId, entry, home)', async () => {
    const first = await resolveProjectHome(projectRoot, { globalDataDir });
    const second = await resolveProjectHome(projectRoot, { globalDataDir });

    expect(second!.projectId).toBe(first!.projectId);
    expect(second!.homeDir).toBe(first!.homeDir);
  });

  it('probe mode creates nothing for an unregistered project', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: false });

    expect(home).toBeNull();
    const config = readProjectConfig(projectRoot);
    expect(config?.projectId).toBeUndefined();
    const state = await readProjectRegistryState({ globalDataDir });
    expect(state).toBeNull();
    expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
  });

  it('probe mode reports an already-registered project without mutating anything', async () => {
    const ensured = await resolveProjectHome(projectRoot, { globalDataDir });
    const probed = await resolveProjectHome(projectRoot, { globalDataDir, ensure: false });

    expect(probed).not.toBeNull();
    expect(probed!.projectId).toBe(ensured!.projectId);
    expect(probed!.homeDir).toBe(ensured!.homeDir);
  });

  it('fails with an actionable message when the config file cannot be written', async () => {
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    fs.chmodSync(configPath, 0o444);

    try {
      await expect(resolveProjectHome(projectRoot, { globalDataDir })).rejects.toThrow(
        /projectId|permission|EACCES|EPERM/iu
      );
    } finally {
      fs.chmodSync(configPath, 0o644);
    }
  });
});

describe('touchProjectRegistry (self-healing)', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-self-heal-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-self-heal-gdd-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('does nothing when the config has no projectId', async () => {
    await touchProjectRegistry(projectRoot, { globalDataDir });

    expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
  });

  it('refreshes lastSeen when the entry is current but stale (> 24h)', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);

    // Backdate lastSeen by 25 hours.
    const staleState = await readProjectRegistryState({ globalDataDir });
    const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeProjectRegistryState(
      {
        version: 1,
        projects: {
          ...staleState!.projects,
          [canonicalPath]: { ...staleState!.projects[canonicalPath], lastSeen: staleTimestamp },
        },
      },
      { globalDataDir }
    );

    await touchProjectRegistry(projectRoot, { globalDataDir });

    const refreshed = await readProjectRegistryState({ globalDataDir });
    const entry = refreshed!.projects[canonicalPath];
    expect(entry.lastSeen).not.toBe(staleTimestamp);
    expect(entry.home).toBe(path.basename(home!.homeDir)); // home never changes on refresh
    expect(Date.now() - Date.parse(entry.lastSeen)).toBeLessThan(60_000);
  });

  it('rebinds a moved project to its new path, reusing the home', async () => {
    const original = await resolveProjectHome(projectRoot, { globalDataDir });
    const movedRoot = path.join(path.dirname(projectRoot), `rasen-self-heal-moved-${Date.now()}`);
    fs.renameSync(projectRoot, movedRoot);

    await touchProjectRegistry(movedRoot, { globalDataDir });

    const state = await readProjectRegistryState({ globalDataDir });
    const movedCanonical = FileSystemUtils.canonicalizeExistingPath(movedRoot);
    expect(state?.projects[movedCanonical]?.home).toBe(path.basename(original!.homeDir));

    fs.rmSync(movedRoot, { recursive: true, force: true });
  });

  it('does not rewrite the registry when the entry is current and recently seen', async () => {
    await resolveProjectHome(projectRoot, { globalDataDir });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    const beforeContent = fs.readFileSync(registryPath, 'utf-8');
    const beforeMtime = fs.statSync(registryPath).mtimeMs;

    await touchProjectRegistry(projectRoot, { globalDataDir });

    const afterContent = fs.readFileSync(registryPath, 'utf-8');
    const afterMtime = fs.statSync(registryPath).mtimeMs;
    expect(afterContent).toBe(beforeContent);
    expect(afterMtime).toBe(beforeMtime);
  });

  it('survives a corrupt registry without breaking the command', async () => {
    await resolveProjectHome(projectRoot, { globalDataDir });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    fs.writeFileSync(registryPath, '{not valid json');

    await expect(touchProjectRegistry(projectRoot, { globalDataDir })).resolves.toBeUndefined();
  });
});

describe('worktree piercing for probe and self-heal (worktree-aware-spaces D1)', () => {
  let repoRoot: string;
  let worktreePath: string;
  let globalDataDir: string;
  let gitExecEnv: NodeJS.ProcessEnv;
  const projectId = randomUUID();

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-home-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-home-gdd-'));
    gitExecEnv = { ...process.env, ...isolatedGitEnv(globalDataDir) };
    // A committed rasen/config.yaml carrying the shared projectId, so the
    // linked worktree inherits the same identity (branch-local but committed).
    fs.mkdirSync(path.join(repoRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\n`
    );
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
    worktreePath = path.join(path.dirname(repoRoot), `rasen-wt-home-wt-${randomUUID().slice(0, 8)}`);
    execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
    } catch {
      // best-effort cleanup
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(worktreePath, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('probe (ensure:false) from a worktree resolves the main checkout entry', async () => {
    const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

    const probed = await resolveProjectHome(worktreePath, { globalDataDir, ensure: false });
    expect(probed).not.toBeNull();
    expect(probed!.projectId).toBe(projectId);
    expect(path.basename(probed!.homeDir)).toBe(main.entry.home);
  });

  it('self-heal from a worktree refreshes the main entry, never a worktree-keyed one', async () => {
    const main = await registerProject({ projectRoot: repoRoot, projectId, mode: 'in-repo' }, { globalDataDir });

    await touchProjectRegistry(worktreePath, { globalDataDir });

    const state = await readProjectRegistryState({ globalDataDir });
    expect(Object.keys(state?.projects ?? {})).toEqual([main.canonicalPath]);
    expect(state?.projects[FileSystemUtils.canonicalizeExistingPath(worktreePath)]).toBeUndefined();
  });
});
