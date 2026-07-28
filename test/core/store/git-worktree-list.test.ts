import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitWorktreeList, parseWorktreePorcelain } from '../../../src/core/store/git.js';
import { isolatedGitEnv } from '../../helpers/store-git.js';

/**
 * `gitWorktreeList` is the live, never-persisted worktree inventory probe
 * (worktree-aware-spaces D2): one `git worktree list --porcelain` read,
 * three-way (`[]` for a repo with only its main checkout, `null` for a
 * non-repo / git-unavailable). The parser is pure and exported for
 * fixture-driven coverage; one real-repo case guards against porcelain drift.
 */
describe('parseWorktreePorcelain', () => {
  it('parses a main checkout plus a linked worktree', () => {
    const porcelain = [
      'worktree /repos/my-app',
      'HEAD abc123abc123abc123abc123abc123abc123abcd',
      'branch refs/heads/main',
      '',
      'worktree /repos/my-app-feat-x',
      'HEAD def456def456def456def456def456def456def4',
      'branch refs/heads/feat/x',
      '',
    ].join('\n');

    const entries = parseWorktreePorcelain(porcelain);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      root: '/repos/my-app',
      head: 'abc123abc123abc123abc123abc123abc123abcd',
      branch: 'main',
      isMain: true,
      locked: false,
      prunable: false,
    });
    expect(entries[1]).toEqual({
      root: '/repos/my-app-feat-x',
      head: 'def456def456def456def456def456def456def4',
      branch: 'feat/x',
      isMain: false,
      locked: false,
      prunable: false,
    });
  });

  it('reports a detached HEAD worktree with a null branch', () => {
    const porcelain = [
      'worktree /repos/main',
      'HEAD aaaa111aaaa111aaaa111aaaa111aaaa111aaaa1',
      'branch refs/heads/main',
      '',
      'worktree /repos/detached',
      'HEAD bbbb222bbbb222bbbb222bbbb222bbbb222bbbb2',
      'detached',
      '',
    ].join('\n');

    const entries = parseWorktreePorcelain(porcelain);
    expect(entries[1].branch).toBeNull();
    expect(entries[1].root).toBe('/repos/detached');
  });

  it('captures locked and prunable flags', () => {
    const porcelain = [
      'worktree /repos/main',
      'HEAD aaaa111aaaa111aaaa111aaaa111aaaa111aaaa1',
      'branch refs/heads/main',
      '',
      'worktree /repos/locked-wt',
      'HEAD cccc333cccc333cccc333cccc333cccc333cccc3',
      'branch refs/heads/wip',
      'locked on external drive',
      '',
      'worktree /repos/prunable-wt',
      'HEAD dddd444dddd444dddd444dddd444dddd444dddd4',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');

    const entries = parseWorktreePorcelain(porcelain);
    expect(entries[1].locked).toBe(true);
    expect(entries[1].prunable).toBe(false);
    expect(entries[2].prunable).toBe(true);
  });

  it('tolerates a bare main and CRLF line endings', () => {
    const porcelain = [
      'worktree /repos/bare',
      'bare',
      '',
      'worktree /repos/wt',
      'HEAD eeee555eeee555eeee555eeee555eeee555eeee5',
      'branch refs/heads/main',
      '',
    ].join('\r\n');

    const entries = parseWorktreePorcelain(porcelain);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      root: '/repos/bare',
      head: null,
      branch: null,
      isMain: true,
      locked: false,
      prunable: false,
    });
    expect(entries[1].branch).toBe('main');
  });

  it('returns an empty array for empty output', () => {
    expect(parseWorktreePorcelain('')).toEqual([]);
  });
});

describe('gitWorktreeList', () => {
  let repoRoot: string;
  let gitExecEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-worktree-list-'));
    gitExecEnv = { ...process.env, ...isolatedGitEnv(repoRoot) };
    execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, env: gitExecEnv });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, env: gitExecEnv, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('lists the main checkout and a real linked worktree (integration)', async () => {
    const worktreePath = path.join(path.dirname(repoRoot), `wt-${path.basename(repoRoot)}-feat`);
    execFileSync('git', ['worktree', 'add', '-b', 'feat/x', worktreePath], {
      cwd: repoRoot,
      env: gitExecEnv,
      stdio: 'ignore',
    });

    try {
      const entries = await gitWorktreeList(repoRoot);
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(2);
      const main = entries!.find((e) => e.isMain)!;
      const linked = entries!.find((e) => !e.isMain)!;
      // git may report roots in canonical/real form; compare by basename.
      expect(path.basename(main.root)).toBe(path.basename(repoRoot));
      expect(path.basename(linked.root)).toBe(path.basename(worktreePath));
      expect(linked.branch).toBe('feat/x');
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        env: gitExecEnv,
        stdio: 'ignore',
      });
    }
  });

  it('returns a single-entry list for a repo with only its main checkout', async () => {
    const entries = await gitWorktreeList(repoRoot);
    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(1);
    expect(entries![0].isMain).toBe(true);
  });

  it('returns null for a non-git directory', async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-worktree-nongit-'));
    try {
      expect(await gitWorktreeList(nonGit)).toBeNull();
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it('returns null when the git binary itself is unavailable', async () => {
    // Strip PATH so the underlying `git -C <root> worktree list --porcelain`
    // spawn cannot resolve `git` at all — the ENOENT path folded into
    // `gitProbe`'s catch, distinct from the non-repo case above.
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(await gitWorktreeList(repoRoot)).toBeNull();
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
