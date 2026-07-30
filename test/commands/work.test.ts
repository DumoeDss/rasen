import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';
import { registerProject, getProjectHomeDir } from '../../src/core/project-registry.js';
import { getGlobalDataDir } from '../../src/core/global-config.js';

/**
 * `rasen work migrate` CLI surface — INVERTED direction (design
 * `file-placement-collapse-archive` D6): scans machine-home work directories
 * for legacy state and moves it to terminal file-placement locations.
 *
 * dry-run moves nothing, --json without --yes is a preview, --yes executes,
 * --change scopes, and exit codes are honest about failure vs. success.
 */
describe('rasen work migrate', () => {
  let tempDir: string;
  let projectRoot: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-work-migrate-')));
    projectRoot = path.join(tempDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    createOpenSpecRoot(projectRoot);
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function gdd(): string {
    return getGlobalDataDir({ env });
  }

  /** Creates an in-repo change directory (needed for discoverChangeDirs + routing). */
  function makeChange(name: string): string {
    const dir = path.join(projectRoot, 'rasen', 'changes', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  /**
   * Registers the project's machine identity and creates a machine-home work
   * directory for `changeName`. Returns the work dir path (the SOURCE of
   * legacy files in the inverted model) and the in-repo change dir (a
   * routing target).
   */
  async function setupWorkDir(
    changeName: string,
    options: { register?: boolean } = {}
  ): Promise<{ workDir: string; changeDir: string }> {
    const changeDir = makeChange(changeName);

    if (options.register !== false) {
      const { entry } = await registerProject(
        { projectRoot, projectId: randomUUID(), mode: 'in-repo' },
        { globalDataDir: gdd() }
      );
      const homeDir = getProjectHomeDir(entry.home, { globalDataDir: gdd() });
      const workDir = path.join(homeDir, 'changes', changeName, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      return { workDir, changeDir };
    }

    return { workDir: '', changeDir };
  }

  it('--dry-run previews without moving files', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.executed).toBe(false);
    expect(payload.dryRun).toBe(true);
    expect(payload.summary.totalCandidates).toBe(1);
    // auto-run.json is classified as run-state → would move to ephemera.
    expect(payload.changes[0].moved).toEqual(['auto-run.json']);
  });

  it('--json without --yes previews without moving files', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'ship-log.md'), '# ship\n');

    const result = await runCLI(['work', 'migrate', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workDir, 'ship-log.md'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.executed).toBe(false);
    expect(payload.summary.totalCandidates).toBe(1);
  });

  it('--json --yes executes and moves the file', async () => {
    const { workDir, changeDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    // File is gone from the machine-home work directory.
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(false);
    const payload = parseJson(result);
    expect(payload.executed).toBe(true);
    expect(payload.summary.moved).toBe(1);
    // File landed in the execution root's ephemera area.
    const ephemeraPath = path.join(projectRoot, '.rasen', 'changes', 'foo', 'ephemera', 'auto-run.json');
    expect(fs.existsSync(ephemeraPath)).toBe(true);
  });

  it('a second --yes run reports nothing to migrate (idempotent)', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const first = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(first.exitCode).toBe(0);

    const second = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(second.exitCode).toBe(0);
    const payload = parseJson(second);
    expect(payload.summary.totalCandidates).toBe(0);
  });

  it('--change scopes migration to a single change', async () => {
    const foo = await setupWorkDir('foo');
    const bar = await setupWorkDir('bar');
    fs.writeFileSync(path.join(foo.workDir, 'auto-run.json'), '{}');
    fs.writeFileSync(path.join(bar.workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes', '--change', 'foo'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(foo.workDir, 'auto-run.json'))).toBe(false);
    expect(fs.existsSync(path.join(bar.workDir, 'auto-run.json'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.changes).toHaveLength(1);
    expect(payload.changes[0].change).toBe('foo');
  });

  it('--change matching nothing exits non-zero with a diagnostic', async () => {
    makeChange('foo');

    const result = await runCLI(['work', 'migrate', '--json', '--yes', '--change', 'does-not-exist'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(1);
    const payload = parseJson(result);
    expect(payload.status?.[0]?.code).toBe('work_migrate_change_not_found');
  });

  it('human mode --dry-run prints the preview and exits 0', async () => {
    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Work migration (preview)');
    expect(result.stdout).toContain('auto-run.json');
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
  });

  it('M1: --dry-run on an unregistered project never mints identity (config.yaml and registry untouched)', async () => {
    // Create an in-repo change dir but do NOT register the project.
    const dir = makeChange('foo');
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    const configBefore = fs.readFileSync(configPath, 'utf-8');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    // No machine home → no work directories scanned → 0 candidates.
    expect(payload.summary.totalCandidates).toBe(0);
    // No work directory was resolved (workDir is null for each change).
    expect(payload.changes[0].workDir).toBeNull();
    // Identity was never minted: config and data dir are untouched.
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(configBefore);
    expect(fs.existsSync(path.join(tempDir, 'data', 'rasen', 'projects'))).toBe(false);
  });

  it('M2: the inverted migrator does not depend on git (corrupted index does not block migration)', async () => {
    // The OLD migrator classified files as tracked/untracked via git
    // ls-files, so a corrupted index caused a hard failure. The inverted
    // migrator scans machine-home only — git state is irrelevant. Verify a
    // corrupted git index does NOT block migration.
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    const gitExecEnv = { ...process.env, ...isolatedGitEnv(projectRoot) };
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, env: gitExecEnv, stdio: 'ignore' });
    // Corrupt the index: rev-parse still confirms a repo, but ls-files fails.
    fs.writeFileSync(path.join(projectRoot, '.git', 'index'), 'not a valid index file, corrupted');

    const { workDir } = await setupWorkDir('foo');
    fs.writeFileSync(path.join(workDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    // The inverted migrator succeeds — it does not query git at all.
    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.summary.moved).toBe(1);
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(false);
  });
});
