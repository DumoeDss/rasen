import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

/**
 * `rasen work migrate` CLI surface (`migrate-legacy-ephemera` task 2.4):
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

  function makeChange(name: string): string {
    const dir = path.join(projectRoot, 'rasen', 'changes', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# proposal\n');
    return dir;
  }

  it('--dry-run previews without moving files', async () => {
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.executed).toBe(false);
    expect(payload.dryRun).toBe(true);
    expect(payload.summary.totalCandidates).toBe(1);
    expect(payload.changes[0].moved).toEqual(['auto-run.json']);
  });

  it('--json without --yes previews without moving files', async () => {
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'ship-log.md'), '# ship\n');

    const result = await runCLI(['work', 'migrate', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, 'ship-log.md'))).toBe(true);
    const payload = parseJson(result);
    expect(payload.executed).toBe(false);
    expect(payload.summary.totalCandidates).toBe(1);
  });

  it('--json --yes executes and moves the file', async () => {
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(false);
    const payload = parseJson(result);
    expect(payload.executed).toBe(true);
    expect(payload.summary.moved).toBe(1);
    const workDir = payload.changes[0].workDir as string;
    expect(fs.existsSync(path.join(workDir, 'auto-run.json'))).toBe(true);
  });

  it('a second --yes run reports nothing to migrate (idempotent)', async () => {
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

    const first = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(first.exitCode).toBe(0);

    const second = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });
    expect(second.exitCode).toBe(0);
    const payload = parseJson(second);
    expect(payload.summary.totalCandidates).toBe(0);
  });

  it('--change scopes migration to a single change', async () => {
    const fooDir = makeChange('foo');
    const barDir = makeChange('bar');
    fs.writeFileSync(path.join(fooDir, 'auto-run.json'), '{}');
    fs.writeFileSync(path.join(barDir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--json', '--yes', '--change', 'foo'], {
      cwd: projectRoot,
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(fooDir, 'auto-run.json'))).toBe(false);
    expect(fs.existsSync(path.join(barDir, 'auto-run.json'))).toBe(true);
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
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');

    const result = await runCLI(['work', 'migrate', '--dry-run'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Work migration (preview)');
    expect(result.stdout).toContain('auto-run.json');
    expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
  });

  it('M1: --dry-run on an unregistered project never mints identity (config.yaml and registry untouched)', async () => {
    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    const configBefore = fs.readFileSync(configPath, 'utf-8');

    const result = await runCLI(['work', 'migrate', '--dry-run', '--json'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(0);
    const payload = parseJson(result);
    expect(payload.identityPending).toBe(true);
    expect(payload.changes[0].workDir).toBeNull();
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(configBefore);
    expect(fs.existsSync(path.join(tempDir, 'data', 'rasen', 'projects'))).toBe(false);
  });

  it('M2: a git query failure on a confirmed repo exits non-zero and moves nothing', async () => {
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    const gitExecEnv = { ...process.env, ...isolatedGitEnv(projectRoot) };
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: projectRoot, env: gitExecEnv, stdio: 'ignore' });

    const dir = makeChange('foo');
    fs.writeFileSync(path.join(dir, 'auto-run.json'), '{}');
    // Corrupt the index: rev-parse still confirms a repo, but ls-files fails.
    fs.writeFileSync(path.join(projectRoot, '.git', 'index'), 'not a valid index file, corrupted');

    const result = await runCLI(['work', 'migrate', '--json', '--yes'], { cwd: projectRoot, env });

    expect(result.exitCode).toBe(1);
    const payload = parseJson(result);
    expect(payload.status?.[0]?.code).toBe('work_migrate_git_query_failed');
    expect(fs.existsSync(path.join(dir, 'auto-run.json'))).toBe(true);
  });
});
