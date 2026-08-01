import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const WORKTREE_TIMEOUT_MS = 60_000;

/**
 * Regression for the reproduced worktree collision (file-placement D3): two
 * worktrees of one project resolve distinct roots but the SAME machine home,
 * so `new change <same-name> --pipeline <p>` used to fail in the second
 * worktree with `Run-state already exists at ~/.rasen/projects/<id>/...`.
 * Run-state now lands in each worktree's own EXECUTION root, which is
 * per-worktree by construction.
 */
describe('new change --pipeline across two worktrees of one project', () => {
  let tempDir: string;
  let repoRoot: string;
  let worktreePath: string;
  let env: NodeJS.ProcessEnv;
  let gitEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-wt-collision-')));
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };

    repoRoot = path.join(tempDir, 'code-project');
    fs.mkdirSync(repoRoot, { recursive: true });
    createOpenSpecRoot(repoRoot);

    gitEnv = { ...process.env, ...isolatedGitEnv(tempDir) };
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitEnv, stdio: 'ignore' });

    // The linked worktree carries the same committed `rasen/config.yaml`, so
    // it shares the project's identity while being a different root on disk.
    worktreePath = path.join(tempDir, 'code-project-wt-feature');
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktreePath], {
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
      // The worktree may already be gone; cleanup below removes the rest.
    }
    cleanupTempPath(tempDir);
  });

  it('succeeds in both worktrees and keeps run-state in each execution root', async () => {
    const main = await runCLI(
      ['new', 'change', 'collide', '--pipeline', 'small-feature', '--json'],
      { cwd: repoRoot, env }
    );
    expect(main.exitCode, main.stdout + main.stderr).toBe(0);

    const linked = await runCLI(
      ['new', 'change', 'collide', '--pipeline', 'small-feature', '--json'],
      { cwd: worktreePath, env }
    );
    // The defect this inverts: the second creation used to exit 1 with
    // "Run-state already exists at <shared machine home>".
    expect(linked.stdout + linked.stderr).not.toContain('Run-state already exists');
    expect(linked.exitCode, linked.stdout + linked.stderr).toBe(0);

    const mainPath = JSON.parse(main.stdout.trim()).change.runStatePath as string;
    const linkedPath = JSON.parse(linked.stdout.trim()).change.runStatePath as string;

    expect(mainPath).not.toBe(linkedPath);
    expect(fs.existsSync(mainPath)).toBe(true);
    expect(fs.existsSync(linkedPath)).toBe(true);

    // Each lands in its OWN execution root's ephemera directory — never in the
    // shared machine home.
    expect(mainPath).toBe(
      path.join(repoRoot, '.rasen', 'changes', 'collide', 'ephemera', 'auto-run.json')
    );
    expect(linkedPath).toBe(
      path.join(worktreePath, '.rasen', 'changes', 'collide', 'ephemera', 'auto-run.json')
    );
    expect(fs.existsSync(path.join(tempDir, 'data', 'rasen', 'projects'))).toBe(false);
  }, WORKTREE_TIMEOUT_MS);

  it('pipeline resume finds the new run-state location in each worktree', async () => {
    await runCLI(['new', 'change', 'collide', '--pipeline', 'small-feature', '--json'], {
      cwd: repoRoot,
      env,
    });
    await runCLI(['new', 'change', 'collide', '--pipeline', 'small-feature', '--json'], {
      cwd: worktreePath,
      env,
    });

    for (const root of [repoRoot, worktreePath]) {
      const resumed = await runCLI(['pipeline', 'resume', 'collide', '--json'], {
        cwd: root,
        env,
      });
      expect(resumed.exitCode, resumed.stdout + resumed.stderr).toBe(0);
      const payload = JSON.parse(resumed.stdout.trim());
      expect(payload.pipeline).toBe('small-feature');
      expect(payload.runStateDir).toBe(
        path.join(root, '.rasen', 'changes', 'collide', 'ephemera')
      );
    }
  }, WORKTREE_TIMEOUT_MS);
});
