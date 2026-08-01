import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ArchiveCommand } from '../../src/core/archive.js';
import { promises as fs } from 'fs';
import * as nodeFs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'path';
import os from 'os';
import { isolatedGitEnv } from '../helpers/store-git.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}));

/**
 * Integration tests for the ephemera cleaner wiring, --keep-ephemera, and
 * --dry-run flags in the archive flow (tasks 3.4-3.6). These exercise the
 * FULL ArchiveCommand.execute path — the ephemera directory is at the
 * execution root (<planningRoot>/.rasen/changes/<c>/ephemera/) for an in-repo
 * run.
 */
describe('ArchiveCommand — ephemera cleaner integration', () => {
  let tempDir: string;
  let archiveCommand: ArchiveCommand;
  const originalConsoleLog = console.log;
  const originalExitCode = process.exitCode;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `rasen-arch-eph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tempDir, { recursive: true });
    process.chdir(tempDir);

    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'xdg-data');

    const openspecDir = path.join(tempDir, 'rasen');
    await fs.mkdir(path.join(openspecDir, 'changes'), { recursive: true });
    await fs.mkdir(path.join(openspecDir, 'specs'), { recursive: true });
    await fs.mkdir(path.join(openspecDir, 'changes', 'archive'), { recursive: true });

    console.log = vi.fn();
    process.exitCode = undefined;
    archiveCommand = new ArchiveCommand();
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
    process.exitCode = originalExitCode;
    vi.clearAllMocks();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /** Creates a change directory with minimal files + an ephemera directory. */
  async function makeChangeWithEphemera(
    changeName: string,
    ephemeraFiles: Record<string, string>
  ): Promise<{ changeDir: string; ephemeraDir: string }> {
    const changeDir = path.join(tempDir, 'rasen', 'changes', changeName);
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Done\n');

    const ephemeraDir = path.join(tempDir, '.rasen', 'changes', changeName, 'ephemera');
    await fs.mkdir(ephemeraDir, { recursive: true });
    for (const [name, content] of Object.entries(ephemeraFiles)) {
      await fs.writeFile(path.join(ephemeraDir, name), content);
    }

    return { changeDir, ephemeraDir };
  }

  async function fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------
  // Task 3.4: --dry-run reports planned actions without executing
  // -----------------------------------------------------------------

  describe('--dry-run', () => {
    it('reports pending deletes and spec syncs without changing disk', async () => {
      const changeName = 'dry-run-feature';
      const { changeDir, ephemeraDir } = await makeChangeWithEphemera(changeName, {
        'auto-run.json': '{"pipeline":"small-feature","completed":[]}',
        'custom.json': '{"important":true}',
      });

      // Hash the tree before dry-run.
      const beforeHash = await hashDirectory(ephemeraDir);
      const changeDirBefore = await hashDirectory(changeDir);

      const result = await archiveCommand.execute(changeName, {
        yes: true,
        dryRun: true,
        json: true,
      });

      // The result should be printed to stdout. Since console.log is mocked,
      // we verify the disk state is unchanged.
      expect(await fileExists(changeDir)).toBe(true);
      expect(await fileExists(path.join(ephemeraDir, 'auto-run.json'))).toBe(true);
      expect(await fileExists(path.join(ephemeraDir, 'custom.json'))).toBe(true);

      // Ephemera directory is byte-identical.
      expect(await hashDirectory(ephemeraDir)).toBe(beforeHash);
      // Change directory is byte-identical.
      expect(await hashDirectory(changeDir)).toBe(changeDirBefore);

      // No archive directory was created.
      const archiveEntry = path.join(tempDir, 'rasen', 'changes', 'archive');
      const archiveContents = await fs.readdir(archiveEntry);
      expect(archiveContents.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  // Task 3.5: --keep-ephemera preserves all ephemera
  // -----------------------------------------------------------------

  describe('--keep-ephemera', () => {
    it('preserves ephemera files and writes empty ephemeraDiscarded', async () => {
      const changeName = 'keep-eph-feature';
      const { ephemeraDir } = await makeChangeWithEphemera(changeName, {
        'auto-run.json': '{"pipeline":"small-feature","completed":[]}',
        'portfolio-run.json': '{"parent":"keep-eph-feature","children":[]}',
        'custom.json': '{"important":true}',
      });

      await archiveCommand.execute(changeName, {
        yes: true,
        keepEphemera: true,
        skipSpecs: true,
        noValidate: true,
      });

      // All ephemera files survive.
      expect(await fileExists(path.join(ephemeraDir, 'auto-run.json'))).toBe(true);
      expect(await fileExists(path.join(ephemeraDir, 'portfolio-run.json'))).toBe(true);
      expect(await fileExists(path.join(ephemeraDir, 'custom.json'))).toBe(true);

      // archive.json has empty ephemeraDiscarded.
      const archiveName = `${new Date().toISOString().slice(0, 10)}-${changeName}`;
      const archiveJsonPath = path.join(
        tempDir,
        'rasen',
        'changes',
        'archive',
        archiveName,
        'archive.json'
      );
      expect(await fileExists(archiveJsonPath)).toBe(true);
      const archiveJson = JSON.parse(await fs.readFile(archiveJsonPath, 'utf-8'));
      expect(archiveJson.ephemeraDiscarded).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  // Task 3.6: full archive (no flags) — ephemera cleaned, archive.json written
  // -----------------------------------------------------------------

  describe('full archive (no flags)', () => {
    it('cleans ephemera, writes archive.json, moves change directory', async () => {
      const changeName = 'full-archive-feature';
      const { ephemeraDir } = await makeChangeWithEphemera(changeName, {
        'auto-run.json': '{"pipeline":"small-feature","completed":[]}',
        'portfolio-run.json': '{"parent":"full-archive-feature","children":[]}',
        'custom.json': '{"important":true}',
        'trace.log': 'log line\n',
      });

      const originalChangeDir = path.join(tempDir, 'rasen', 'changes', changeName);

      await archiveCommand.execute(changeName, {
        yes: true,
        skipSpecs: true,
        noValidate: true,
      });

      // Whitelisted files are deleted from the ephemera directory.
      expect(await fileExists(path.join(ephemeraDir, 'auto-run.json'))).toBe(false);
      expect(await fileExists(path.join(ephemeraDir, 'portfolio-run.json'))).toBe(false);
      expect(await fileExists(path.join(ephemeraDir, 'trace.log'))).toBe(false);

      // Unknown files survive.
      expect(await fileExists(path.join(ephemeraDir, 'custom.json'))).toBe(true);

      // Change directory has moved to archive.
      expect(await fileExists(originalChangeDir)).toBe(false);

      // archive.json is written with the correct fields.
      const archiveName = `${new Date().toISOString().slice(0, 10)}-${changeName}`;
      const archivedDir = path.join(tempDir, 'rasen', 'changes', 'archive', archiveName);
      const archiveJsonPath = path.join(archivedDir, 'archive.json');
      expect(await fileExists(archiveJsonPath)).toBe(true);

      const archiveJson = JSON.parse(await fs.readFile(archiveJsonPath, 'utf-8'));
      expect(archiveJson.change).toBe(changeName);
      expect(archiveJson.ephemeraDiscarded.sort()).toEqual([
        'auto-run.json',
        'portfolio-run.json',
        'trace.log',
      ]);
      expect(archiveJson.codeCommit).toBeDefined(); // null for non-git, SHA for git
      expect(archiveJson.archivedAt).toBeDefined();
      // The planning-root commit hash is NOT a field.
      expect(archiveJson.planningCommit).toBeUndefined();
      expect(archiveJson.planningRootCommit).toBeUndefined();
    });

    it('cleans ephemera in a git repo and records the codeCommit', async () => {
      // Initialize git in the temp dir so codeCommit resolves to a real SHA.
      const gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
      execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@test.com'], {
        cwd: tempDir,
        stdio: 'ignore',
      });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: tempDir, env: gitEnv });
      execFileSync('git', ['commit', '-m', 'init'], {
        cwd: tempDir,
        env: gitEnv,
        stdio: 'ignore',
      });

      const changeName = 'git-archive-feature';
      const { ephemeraDir } = await makeChangeWithEphemera(changeName, {
        'auto-run.json': '{"pipeline":"small-feature","completed":[]}',
      });

      await archiveCommand.execute(changeName, {
        yes: true,
        skipSpecs: true,
        noValidate: true,
      });

      // Ephemera cleaned.
      expect(await fileExists(path.join(ephemeraDir, 'auto-run.json'))).toBe(false);

      // archive.json has a real codeCommit.
      const archiveName = `${new Date().toISOString().slice(0, 10)}-${changeName}`;
      const archiveJsonPath = path.join(
        tempDir,
        'rasen',
        'changes',
        'archive',
        archiveName,
        'archive.json'
      );
      const archiveJson = JSON.parse(await fs.readFile(archiveJsonPath, 'utf-8'));
      expect(archiveJson.codeCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(archiveJson.ephemeraDiscarded).toEqual(['auto-run.json']);
    });
  });
});

/** Recursively hashes a directory's contents for byte-identical comparison. */
async function hashDirectory(dir: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');

  async function walk(d: string, prefix: string): Promise<void> {
    let entries: nodeFs.Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(rel);
      hash.update('\0');
      if (entry.isDirectory()) {
        await walk(path.join(d, entry.name), rel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(path.join(d, entry.name));
        hash.update(content);
        hash.update('\0');
      }
    }
  }

  await walk(dir, '');
  return hash.digest('hex');
}
