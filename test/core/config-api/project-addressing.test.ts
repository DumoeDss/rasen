import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  resolveProjectSelector,
  resolveLaunchProjectRef,
} from '../../../src/core/config-api/project-addressing.js';
import {
  readProjectRegistryState,
  registerProject,
} from '../../../src/core/project-registry.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';

describe('project-addressing', () => {
  let globalDataDir: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-api-data-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-config-api-project-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = globalDataDir;
    process.env.XDG_CONFIG_HOME = globalDataDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(globalDataDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  describe('resolveProjectSelector', () => {
    it('returns null when there is no registry at all', async () => {
      await expect(resolveProjectSelector('anything')).resolves.toBeNull();
    });

    it('resolves by exact projectId', async () => {
      const { entry, canonicalPath } = await registerProject({
        projectRoot,
        projectId: 'proj-1',
        mode: 'in-repo',
      });
      const resolved = await resolveProjectSelector('proj-1');
      expect(resolved).toEqual({
        root: canonicalPath,
        ref: { projectId: entry.projectId, name: entry.name, root: canonicalPath },
      });
    });

    it('resolves by canonical root path', async () => {
      const { canonicalPath } = await registerProject({
        projectRoot,
        projectId: 'proj-2',
        mode: 'in-repo',
      });
      const resolved = await resolveProjectSelector(projectRoot);
      expect(resolved?.root).toBe(canonicalPath);
    });

    it('returns null for an unknown selector', async () => {
      await registerProject({ projectRoot, projectId: 'proj-3', mode: 'in-repo' });
      await expect(resolveProjectSelector('nonexistent-id')).resolves.toBeNull();
    });

    it('returns null for a path selector that does not exist on disk', async () => {
      await registerProject({ projectRoot, projectId: 'proj-4', mode: 'in-repo' });
      await expect(
        resolveProjectSelector(path.join(os.tmpdir(), 'rasen-does-not-exist-xyz'))
      ).resolves.toBeNull();
    });

    it('resolves a worktree root path to the owning project with no side effects (worktree-aware-spaces D3)', async () => {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-addr-wt-main-'));
      const gitExecEnv = { ...process.env, ...isolatedGitEnv(repoRoot) };
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      const worktreePath = path.join(path.dirname(repoRoot), `rasen-addr-wt-${randomUUID().slice(0, 8)}`);
      execFileSync('git', ['worktree', 'add', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

      const { entry, canonicalPath } = await registerProject({
        projectRoot: repoRoot,
        projectId: 'wt-owner',
        mode: 'in-repo',
      });

      const before = JSON.stringify(await readProjectRegistryState());

      const resolved = await resolveProjectSelector(worktreePath);
      const canonicalWorktree = FileSystemUtils.canonicalizeExistingPath(worktreePath);
      // The owning project's identity, answered from the worktree's own root.
      expect(resolved).toEqual({
        root: canonicalWorktree,
        ref: { projectId: entry.projectId, name: entry.name, root: canonicalWorktree },
      });
      expect(resolved?.ref.projectId).toBe('wt-owner');
      expect(canonicalWorktree).not.toBe(canonicalPath);
      // Non-mutating: no registry entry, identity, or directory created.
      expect(JSON.stringify(await readProjectRegistryState())).toBe(before);

      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
      fs.rmSync(repoRoot, { recursive: true, force: true });
    });
  });

  describe('resolveLaunchProjectRef', () => {
    it('returns null when there is no launch project', async () => {
      await expect(resolveLaunchProjectRef(null)).resolves.toBeNull();
    });

    it('prefers the registry entry when the project is registered', async () => {
      const { entry, canonicalPath } = await registerProject({
        projectRoot,
        projectId: 'proj-5',
        mode: 'in-repo',
      });
      const ref = await resolveLaunchProjectRef(projectRoot);
      expect(ref).toEqual({ projectId: entry.projectId, name: entry.name, root: canonicalPath });
    });

    it('falls back to the project config projectId when unregistered', async () => {
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\nprojectId: hand-set-id\n'
      );
      const ref = await resolveLaunchProjectRef(projectRoot);
      const canonical = FileSystemUtils.canonicalizeExistingPath(projectRoot);
      expect(ref).toEqual({ projectId: 'hand-set-id', name: expect.any(String), root: canonical });
    });

    it('falls back to an empty projectId when neither registry nor config has one', async () => {
      const ref = await resolveLaunchProjectRef(projectRoot);
      expect(ref?.projectId).toBe('');
      expect(ref?.root).toBe(FileSystemUtils.canonicalizeExistingPath(projectRoot));
    });
  });
});
