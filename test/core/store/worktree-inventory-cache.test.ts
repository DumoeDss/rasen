import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitWorktreeEntry } from '../../../src/core/store/git.js';

vi.mock('../../../src/core/store/git.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/core/store/git.js')>();
  return { ...original, gitWorktreeList: vi.fn() };
});

import { gitWorktreeList } from '../../../src/core/store/git.js';
import {
  cachedGitWorktreeList,
  clearWorktreeInventoryCache,
} from '../../../src/core/store/worktree-inventory-cache.js';

const gitWorktreeListMock = vi.mocked(gitWorktreeList);

function inventory(root: string): GitWorktreeEntry[] {
  return [{ root, head: 'abc123', branch: 'main', isMain: true, locked: false, prunable: false }];
}

describe('worktree inventory cache', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-wt-cache-'));
    // A fake main-checkout shape: `.git/worktrees` exists as a real directory
    // so the structural-invalidation stat has something to watch.
    await fs.mkdir(path.join(root, '.git', 'worktrees'), { recursive: true });
    clearWorktreeInventoryCache();
    gitWorktreeListMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reuses one probe for sequential reads within the freshness window', async () => {
    gitWorktreeListMock.mockResolvedValue(inventory(root));

    const first = await cachedGitWorktreeList(root);
    const second = await cachedGitWorktreeList(root);

    expect(first).toEqual(inventory(root));
    expect(second).toBe(first);
    expect(gitWorktreeListMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent reads for one root into a single probe', async () => {
    let release!: (value: GitWorktreeEntry[]) => void;
    gitWorktreeListMock.mockImplementation(
      () => new Promise<GitWorktreeEntry[] | null>((resolve) => (release = resolve))
    );

    const reads = Promise.all([
      cachedGitWorktreeList(root),
      cachedGitWorktreeList(root),
      cachedGitWorktreeList(root),
    ]);
    // Let the probe pass its internal mtime stat and reach git; all three
    // reads are then pending on the same in-flight probe.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gitWorktreeListMock).toHaveBeenCalledTimes(1);
    release(inventory(root));

    const results = await reads;
    expect(results[0]).toEqual(inventory(root));
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(gitWorktreeListMock).toHaveBeenCalledTimes(1);
  });

  it('re-probes within the window when .git/worktrees mtime changes (worktree add/remove)', async () => {
    gitWorktreeListMock.mockResolvedValue(inventory(root));
    await cachedGitWorktreeList(root);

    const worktreesDir = path.join(root, '.git', 'worktrees');
    const bumped = new Date(Date.now() + 5_000);
    await fs.utimes(worktreesDir, bumped, bumped);

    await cachedGitWorktreeList(root);
    expect(gitWorktreeListMock).toHaveBeenCalledTimes(2);
  });

  it('re-probes after the freshness window expires', async () => {
    gitWorktreeListMock.mockResolvedValue(inventory(root));

    await cachedGitWorktreeList(root, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await cachedGitWorktreeList(root, 10);

    expect(gitWorktreeListMock).toHaveBeenCalledTimes(2);
  });

  it('caches a null (non-git / git-unavailable) answer so failures cannot spawn-storm', async () => {
    gitWorktreeListMock.mockResolvedValue(null);

    expect(await cachedGitWorktreeList(root)).toBeNull();
    expect(await cachedGitWorktreeList(root)).toBeNull();
    expect(gitWorktreeListMock).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct roots in distinct slots', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-wt-cache-b-'));
    try {
      gitWorktreeListMock.mockImplementation(async (repoRoot: string) => inventory(repoRoot));

      await cachedGitWorktreeList(root);
      await cachedGitWorktreeList(other);

      expect(gitWorktreeListMock).toHaveBeenCalledTimes(2);
      expect(gitWorktreeListMock).toHaveBeenNthCalledWith(1, path.resolve(root));
      expect(gitWorktreeListMock).toHaveBeenNthCalledWith(2, path.resolve(other));
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('reuses within the window for a linked-worktree root (no .git/worktrees dir, TTL-only freshness)', async () => {
    const linked = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-wt-cache-linked-'));
    try {
      // A linked worktree has a `.git` FILE, not a directory — the mtime
      // probe answers null consistently and freshness is TTL-only.
      await fs.writeFile(path.join(linked, '.git'), 'gitdir: elsewhere\n');
      gitWorktreeListMock.mockResolvedValue(inventory(linked));

      await cachedGitWorktreeList(linked);
      await cachedGitWorktreeList(linked);
      expect(gitWorktreeListMock).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(linked, { recursive: true, force: true });
    }
  });

  it('clearWorktreeInventoryCache forces the next read to re-probe', async () => {
    gitWorktreeListMock.mockResolvedValue(inventory(root));

    await cachedGitWorktreeList(root);
    clearWorktreeInventoryCache();
    await cachedGitWorktreeList(root);

    expect(gitWorktreeListMock).toHaveBeenCalledTimes(2);
  });
});
