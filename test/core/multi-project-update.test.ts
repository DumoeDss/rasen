import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  enumerateBehindProjects,
  updateMultipleProjects,
  formatMultiProjectSummary,
  type BehindProject,
  type PerProjectResult,
} from '../../src/core/multi-project-update.js';
import {
  registerProject,
  writeProjectRegistryState,
  readProjectRegistryState,
  type ProjectRegistryState,
} from '../../src/core/project-registry.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { isolatedGitEnv } from '../helpers/store-git.js';

describe('multi-project-update', () => {
  let globalDataDir: string;
  let fixturesRoot: string;

  beforeEach(() => {
    globalDataDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-gdd-'))
    );
    fixturesRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-fix-'))
    );
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

  function writeConfig(projectRoot: string, yaml: string): void {
    const rasenDir = path.join(projectRoot, 'rasen');
    fs.mkdirSync(rasenDir, { recursive: true });
    fs.writeFileSync(path.join(rasenDir, 'config.yaml'), yaml);
  }

  async function registerWithCache(
    projectRoot: string,
    projectId: string,
    options: { tools?: string[]; installedVersion?: string } = {}
  ): Promise<void> {
    await registerProject(
      {
        projectRoot,
        projectId,
        mode: 'in-repo',
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.installedVersion ? { installedVersion: options.installedVersion } : {}),
      },
      { globalDataDir }
    );
  }

  describe('enumerateBehindProjects', () => {
    it('excludes the current project (path-exact)', async () => {
      const current = makeProjectDir('current');
      writeConfig(current, 'schema: spec-driven\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.6' });

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      expect(behind).toEqual([]);
    });

    it('excludes missing-dir entries', async () => {
      const current = makeProjectDir('current');
      const ghost = path.join(fixturesRoot, 'ghost-' + randomUUID().slice(0, 8));
      writeConfig(current, 'schema: spec-driven\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.7' });

      // Manually add a registry entry for a path that does not exist.
      const state = await readProjectRegistryState({ globalDataDir });
      const ghostCanonical = FileSystemUtils.canonicalizeExistingPath(current);
      // Replace with a non-existent path entry.
      await writeProjectRegistryState(
        {
          version: 1,
          projects: {
            ...state!.projects,
            [path.join(fixturesRoot, 'nonexistent-' + randomUUID().slice(0, 8))]: {
              projectId: 'ghost-1',
              name: 'ghost',
              mode: 'in-repo',
              home: 'ghost-dead',
              lastSeen: new Date().toISOString(),
              installedVersion: '0.1.0',
            },
          },
        },
        { globalDataDir }
      );

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      // ghost dir does not exist on disk, so it is excluded.
      expect(behind.find((p) => p.projectId === 'ghost-1')).toBeUndefined();
    });

    it('excludes pinned entries (config has update.pin: true)', async () => {
      const current = makeProjectDir('current');
      const pinned = makeProjectDir('pinned');
      writeConfig(current, 'schema: spec-driven\n');
      writeConfig(pinned, 'schema: spec-driven\nupdate:\n  pin: true\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.7' });
      await registerWithCache(pinned, 'pinned-1', { installedVersion: '0.1.0' });

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      expect(behind.find((p) => p.projectRoot === pinned)).toBeUndefined();
    });

    it('excludes entries whose cached version equals currentVersion', async () => {
      const current = makeProjectDir('current');
      const current2 = makeProjectDir('also-current');
      writeConfig(current, 'schema: spec-driven\n');
      writeConfig(current2, 'schema: spec-driven\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.7' });
      await registerWithCache(current2, 'curr-2', { installedVersion: '0.1.7' });

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      expect(behind.find((p) => p.projectRoot === current2)).toBeUndefined();
    });

    it('INCLUDES entries whose cached version is absent (unknown)', async () => {
      const current = makeProjectDir('current');
      const unknown = makeProjectDir('unknown');
      writeConfig(current, 'schema: spec-driven\n');
      writeConfig(unknown, 'schema: spec-driven\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.7' });
      // Register "unknown" without installedVersion (legacy entry shape).
      await registerProject(
        { projectRoot: unknown, projectId: 'unk-1', mode: 'in-repo' },
        { globalDataDir }
      );

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      const entry = behind.find((p) => p.projectRoot === unknown);
      expect(entry).toBeDefined();
      expect(entry?.cachedVersion).toBeUndefined();
    });

    it('includes behind entries (cached version differs from current)', async () => {
      const current = makeProjectDir('current');
      const behind1 = makeProjectDir('behind');
      writeConfig(current, 'schema: spec-driven\n');
      writeConfig(behind1, 'schema: spec-driven\n');
      await registerWithCache(current, 'curr-1', { installedVersion: '0.1.7' });
      await registerWithCache(behind1, 'behind-1', { installedVersion: '0.1.5' });

      const behind = await enumerateBehindProjects(current, '0.1.7', { globalDataDir });
      const entry = behind.find((p) => p.projectRoot === behind1);
      expect(entry).toBeDefined();
      expect(entry?.cachedVersion).toBe('0.1.5');
    });
  });

  describe('formatMultiProjectSummary', () => {
    it('returns an empty array for no results', () => {
      expect(formatMultiProjectSummary([])).toEqual([]);
    });

    it('formats each status type with project name and basename', () => {
      const results: PerProjectResult[] = [
        { projectRoot: '/a/b/my-proj', name: 'my-proj', status: 'updated' },
        { projectRoot: '/a/b/gone', name: 'gone', status: 'skipped-missing' },
        { projectRoot: '/a/b/pinned', name: 'pinned', status: 'skipped-pinned' },
        { projectRoot: '/a/b/cur', name: 'cur', status: 'skipped-current' },
        { projectRoot: '/a/b/bad', name: 'bad', status: 'failed', error: 'oops' },
      ];
      const lines = formatMultiProjectSummary(results);
      expect(lines.length).toBe(5);
      expect(lines[0]).toContain('my-proj');
      expect(lines[0]).toContain('updated');
      expect(lines[4]).toContain('bad');
      expect(lines[4]).toContain('oops');
    });
  });

  describe('enumerateBehindProjects pierced-root exclusion (M1)', () => {
    let repoRoot: string;
    let worktreePath: string;
    let gdd: string;
    let gitEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      gdd = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-pierce-gdd-'))
      );
      repoRoot = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-pierce-repo-'))
      );
      gitEnv = { ...process.env, ...isolatedGitEnv(gdd) };
      fs.mkdirSync(path.join(repoRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitEnv });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
      worktreePath = path.join(
        path.dirname(repoRoot),
        `rasen-mpu-wt-${randomUUID().slice(0, 8)}`
      );
      execFileSync('git', ['worktree', 'add', worktreePath], {
        cwd: repoRoot,
        env: gitEnv,
        stdio: 'ignore',
      });
    });

    afterEach(() => {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: repoRoot,
          env: gitEnv,
          stdio: 'ignore',
        });
      } catch {
        // best-effort
      }
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(worktreePath, { recursive: true, force: true });
      fs.rmSync(gdd, { recursive: true, force: true });
    });

    it('excludes the main checkout when running from a worktree (pierced-root)', async () => {
      // Register the MAIN checkout with a behind version.
      await registerProject(
        { projectRoot: repoRoot, projectId: 'main-1', mode: 'in-repo', installedVersion: '0.1.5' },
        { globalDataDir: gdd }
      );

      // Enumerate from the WORKTREE path — the main checkout should be
      // excluded via pierced-root, not offered as a self-update.
      const behind = await enumerateBehindProjects(worktreePath, '0.1.7', { globalDataDir: gdd });
      expect(behind.find((p) => p.projectRoot === repoRoot)).toBeUndefined();
    });
  });

  describe('updateMultipleProjects', () => {
    let fixturesRoot: string;
    let gdd: string;

    beforeEach(() => {
      fixturesRoot = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-exec-'))
      );
      gdd = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mpu-exec-gdd-'))
      );
    });

    afterEach(() => {
      fs.rmSync(fixturesRoot, { recursive: true, force: true });
      fs.rmSync(gdd, { recursive: true, force: true });
    });

    function makeProjectDir(name: string): string {
      const dir = path.join(fixturesRoot, `${name}-${randomUUID().slice(0, 8)}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }

    it('skips and summarizes a missing-dir candidate without aborting the batch', async () => {
      const missing = path.join(fixturesRoot, 'does-not-exist');
      const valid = makeProjectDir('valid');
      // The valid dir also has no rasen/ — it will fail, but the batch continues.
      const projects: BehindProject[] = [
        { projectRoot: missing, name: 'missing', pinned: false },
        { projectRoot: valid, name: 'valid', pinned: false },
      ];

      const results = await updateMultipleProjects(projects);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('skipped-missing');
      // Batch continued past the missing dir.
      expect(results[1].status).toBe('failed');
    });

    it('skips and summarizes a pinned candidate (defensive)', async () => {
      const pinnedDir = makeProjectDir('pinned');
      fs.mkdirSync(path.join(pinnedDir, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(pinnedDir, 'rasen', 'config.yaml'),
        'schema: spec-driven\nupdate:\n  pin: true\n'
      );

      const projects: BehindProject[] = [
        { projectRoot: pinnedDir, name: 'pinned', pinned: true },
      ];

      const results = await updateMultipleProjects(projects);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('skipped-pinned');
    });

    it('catches a per-project failure and continues with remaining candidates', async () => {
      // A dir that exists but has no rasen/ — execute() throws early.
      const failDir = makeProjectDir('will-fail');
      const projects: BehindProject[] = [
        { projectRoot: failDir, name: 'fail', pinned: false },
      ];

      const results = await updateMultipleProjects(projects);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('failed');
      expect(results[0].error).toBeDefined();
    });
  });
});
