import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { resolveRegistrationRoot } from '../project-registry.js';

const fs = nodeFs.promises;

/**
 * Process-local cache over `resolveRegistrationRoot` for the daemon's
 * request-time selector resolution (the sibling of
 * `store/worktree-inventory-cache.ts`, same three-layer contract). Every
 * board fetch against a `project:<worktree root>` selector pierces the root
 * to find the owning main checkout — two `git rev-parse` spawns per request,
 * so one board switch (changes + runs) cost four spawns, each 30–80ms of
 * Windows process creation and worst-case seconds under antivirus scanning.
 *
 * Freshness: TTL window plus an mtime re-check of `<root>/.git` on every
 * hit — retargeting or deleting a linked worktree's `.git` file (the only
 * ways this mapping changes shape from the worktree's side) moves that
 * mtime, so structural changes are visible on the very next read. The
 * pierced answer is a pure git-topology fact; registry state is NOT part of
 * the cached value (callers look the pierced root up in the registry
 * themselves, so registration changes are never masked).
 *
 * In-memory only, dies with the process — resolution stays non-mutating and
 * nothing is persisted. Registration paths (registerProject, doctor, gc)
 * keep calling the uncached resolver: they are short-lived CLI processes
 * whose writes must never act on a stale pierce.
 */

const DEFAULT_TTL_MS = 15_000;

interface CacheSlot {
  value: string;
  expiresAt: number;
  /** mtimeMs of `<canonicalPath>/.git` when the probe started; null = absent/unreadable. */
  gitLinkMtimeMs: number | null;
}

const slots = new Map<string, CacheSlot>();
const inFlight = new Map<string, Promise<string>>();

async function gitLinkMtime(canonicalPath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(path.join(canonicalPath, '.git'));
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/** Test/reset surface: drops every cached slot (in-flight probes still settle and re-populate). */
export function clearPiercingCache(): void {
  slots.clear();
}

/**
 * `resolveRegistrationRoot` with the caching contract documented above.
 * `ttlMs` is exposed for tests; production callers use the default window.
 */
export async function cachedResolveRegistrationRoot(
  canonicalPath: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const key = canonicalPath;

  const slot = slots.get(key);
  if (slot) {
    if (Date.now() < slot.expiresAt && (await gitLinkMtime(key)) === slot.gitLinkMtimeMs) {
      return slot.value;
    }
    slots.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const probe = (async () => {
    // mtime recorded BEFORE the probe (same rationale as the inventory
    // cache): a retarget racing the probe leaves a stale recorded mtime, so
    // the next read mismatches and re-probes — one extra probe, never a
    // stale slot surviving a structural change.
    const mtime = await gitLinkMtime(key);
    const value = await resolveRegistrationRoot(key);
    slots.set(key, { value, expiresAt: Date.now() + ttlMs, gitLinkMtimeMs: mtime });
    return value;
  })();
  inFlight.set(key, probe);
  try {
    return await probe;
  } finally {
    inFlight.delete(key);
  }
}
