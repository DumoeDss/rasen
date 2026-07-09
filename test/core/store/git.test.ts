import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitListTrackedFiles } from '../../../src/core/store/git.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';

/**
 * `gitListTrackedFiles` is the read-only classification query
 * `migrate-legacy-ephemera` (D4) uses to tell tracked ephemera apart from
 * untracked noise — one `git ls-files -z` per scan, never a git write.
 */
describe('gitListTrackedFiles', () => {
  let repoRoot: string;
  let gitExecEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-git-list-tracked-'));
    gitExecEnv = { ...process.env, ...isolatedGitEnv(repoRoot) };
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns absolute paths for committed files under a directory', async () => {
    const changesDir = path.join(repoRoot, 'rasen', 'changes');
    fs.mkdirSync(path.join(changesDir, 'archive', '2026-01-01-foo'), { recursive: true });
    const trackedFile = path.join(changesDir, 'archive', '2026-01-01-foo', 'review-report.md');
    fs.writeFileSync(trackedFile, '# report\n');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

    const tracked = await gitListTrackedFiles(repoRoot, 'rasen/changes');

    expect(tracked).not.toBeNull();
    expect(tracked).toContain(trackedFile);
  });

  it('omits untracked files from the result', async () => {
    const changesDir = path.join(repoRoot, 'rasen', 'changes');
    fs.mkdirSync(path.join(changesDir, 'archive', '2026-01-01-foo'), { recursive: true });
    const trackedFile = path.join(changesDir, 'archive', '2026-01-01-foo', 'review-report.md');
    fs.writeFileSync(trackedFile, '# report\n');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });

    const untrackedFile = path.join(changesDir, 'archive', '2026-01-01-foo', 'auto-run.json');
    fs.writeFileSync(untrackedFile, '{}');

    const tracked = await gitListTrackedFiles(repoRoot, 'rasen/changes');

    expect(tracked).not.toBeNull();
    expect(tracked).toContain(trackedFile);
    expect(tracked).not.toContain(untrackedFile);
  });

  it('returns an empty array (not null) for a git root with nothing tracked yet', async () => {
    fs.mkdirSync(path.join(repoRoot, 'rasen', 'changes'), { recursive: true });

    const tracked = await gitListTrackedFiles(repoRoot, 'rasen/changes');

    expect(tracked).toEqual([]);
  });

  it('returns null for a non-git root (caller must treat everything as untracked)', async () => {
    const nonGitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-git-list-tracked-nongit-'));
    fs.mkdirSync(path.join(nonGitRoot, 'rasen', 'changes'), { recursive: true });

    try {
      const tracked = await gitListTrackedFiles(nonGitRoot, 'rasen/changes');
      expect(tracked).toBeNull();
    } finally {
      fs.rmSync(nonGitRoot, { recursive: true, force: true });
    }
  });
});
