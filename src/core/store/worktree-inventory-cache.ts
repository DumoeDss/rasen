import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { gitWorktreeList, type GitWorktreeEntry } from './git.js';

const fs = nodeFs.promises;

/**
 * Process-local cache over `gitWorktreeList` for the management API's
 * request-time reads. The space listing runs one inventory probe per project
 * entry on EVERY page load, and each probe is a git.exe spawn — cheap on
 * Linux, 30–80ms of process creation on Windows — so uncached navigation
 * cost scales as (page loads × projects) spawns.
 *
 * Three layers, in order of consultation:
 *  1. TTL slot: a probe result is reused for a short freshness window.
 *  2. Structural invalidation: adding/removing a linked worktree creates or
 *     deletes entries under `<root>/.git/worktrees`, changing that
 *     directory's mtime — a hit re-checks the mtime (one fs.stat) and
 *     discards the slot on mismatch, so worktree add/remove is visible
 *     immediately, not after the TTL. Branch switches and new commits do
 *     NOT move the directory mtime and surface within the TTL instead —
 *     acceptable staleness for a board UI. For a LINKED worktree root
 *     (`.git` is a file, no `worktrees/` dir) the mtime is always null and
 *     freshness is TTL-only.
 *  3. In-flight coalescing: concurrent reads for one root (e.g. a Spaces
 *     load and a board load racing) share a single underlying probe.
 *
 * Nothing is ever persisted — the cache dies with the process, so the
 * "derived live from git, never persisted" self-healing contract
 * (worktree-aware-spaces constraint 3) keeps holding: no gc debt, no
 * stale-on-disk state. Failures (`null`: non-git root, git unavailable)
 * are cached for the same TTL so a non-git root cannot cause a spawn storm.
 *
 * CLI paths (doctor, gc, registry piercing) intentionally do NOT go through
 * this module: they are short-lived processes that need fresh answers.
 */

const DEFAULT_TTL_MS = 15_000;

interface CacheSlot {
  value: GitWorktreeEntry[] | null;
  expiresAt: number;
  /** mtimeMs of `<root>/.git/worktrees` when the probe started; null = absent/unreadable. */
  worktreesDirMtimeMs: number | null;
}

const slots = new Map<string, CacheSlot>();
const inFlight = new Map<string, Promise<GitWorktreeEntry[] | null>>();

async function worktreesDirMtime(rootKey: string): Promise<number | null> {
  try {
    const stat = await fs.stat(path.join(rootKey, '.git', 'worktrees'));
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/** Test/reset surface: drops every cached slot (in-flight probes still settle and re-populate). */
export function clearWorktreeInventoryCache(): void {
  slots.clear();
}

/**
 * `gitWorktreeList` with the caching contract documented above. `ttlMs` is
 * exposed for tests; production callers use the default window.
 */
export async function cachedGitWorktreeList(
  repoRoot: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<GitWorktreeEntry[] | null> {
  const key = path.resolve(repoRoot);

  const slot = slots.get(key);
  if (slot) {
    if (Date.now() < slot.expiresAt && (await worktreesDirMtime(key)) === slot.worktreesDirMtimeMs) {
      return slot.value;
    }
    slots.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const probe = (async () => {
    // The mtime is recorded BEFORE the probe: a worktree added between the
    // stat and git's answer leaves a stale recorded mtime, so the next read
    // mismatches and re-probes — the failure mode is one extra probe, never
    // a stale slot that survives a structural change.
    const mtime = await worktreesDirMtime(key);
    const value = await gitWorktreeList(key);
    slots.set(key, { value, expiresAt: Date.now() + ttlMs, worktreesDirMtimeMs: mtime });
    return value;
  })();
  inFlight.set(key, probe);
  try {
    return await probe;
  } finally {
    inFlight.delete(key);
  }
}
