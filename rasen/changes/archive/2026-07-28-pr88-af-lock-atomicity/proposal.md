## Why

The owner-aware file lock that serializes catalog writes (knowledge-bundle import, learned-skill mutation, Store membership records) has two concurrency defects found in the PR #88 acceptance review:

1. **B1 — the steal path is non-atomic.** When a lock's owner PID is provably dead, the current code reads the lock content, judges the PID dead, and `unlink`s by path. Two concurrent stealers of the same dead-owner lock can each `unlink` by path — one deletes the other's subsequently-created LIVE lock, letting both enter the critical section simultaneously. A swallowed `unlink` failure also sets `stolen = true` without sleeping or checking the deadline, producing a CPU busy-loop.
2. **B2 — the same catalog mixes two lock protocols.** Bundle import uses the owner-aware lock, but learned-skill mutation still uses the legacy 30-second-mtime stale judgment for the same `ResolvedStore.lockPath`. A slow disk or large bundle holding the lock beyond 30 seconds lets the legacy writer evict a LIVE owner-aware lock.

These break mutual exclusion for read-modify-write transactions on the project knowledge catalog, which can silently lose updates or interleave publications.

## What Changes

- Replace the non-atomic `read → judge PID dead → unlink(path)` steal with a **rename-based atomic claim**: `rename(lockPath, uniqueTemp)` is the single atomic step — only one stealer succeeds; the loser gets `ENOENT`. After rename, the content is re-read and compared against what was originally read. If it matches, the dead lock is provably claimed and cleaned up. If it mismatches (the file was replaced between read and rename by another stealer), the moved file is restored via `link(tempPath, lockPath)` — which fails safely with `EEXIST` if a new lock already appeared — and the stealer waits instead.
- Fix the busy-loop: `stolen` is set to `true` ONLY after the dead lock is provably claimed and cleaned up. Any filesystem failure (rename, read, unlink) leaves `stolen = false`, so the loop always falls through to the deadline check and sleep.
- Unify all writers of the same `ResolvedStore.lockPath` on the owner-aware protocol: `commitLearnedSkillPlan` in `learned-skills/mutate.ts` switches from the legacy `acquireFileLock` (30 s mtime stale) to `acquireOwnerAwareFileLock` (PID-liveness based). The legacy lock remains for its other callers (registry, pipeline library, profiles, worksets), whose lockPaths never overlap with owner-aware callers.
- Ship deterministic regression tests for both defects: orchestrated dual-stealer over a dead-owner lock; release-window token mismatch; swallowed-unlink busy-loop avoidance; and legacy/owner-aware mixed contention with a >30-second hold.

## Capabilities

### New Capabilities

- `catalog-lock-mutual-exclusion`: The observable contract that concurrent writers of the same project knowledge catalog are serialized safely — a dead-owner lock is reclaimed without deleting another holder's live lock, a swallowed filesystem failure does not produce a busy-loop, and all writers sharing one lock path use the same liveness protocol so a slow writer is never evicted by a faster one using a stale-heuristic lock.

### Modified Capabilities

## Impact

- `src/core/file-state.ts` — rewrite the steal path inside `acquireOwnerAwareFileLock`; fix the busy-loop guard. The release side (`releaseOwnerAwareFileLock`) is unchanged (its dev/ino + token guard is already correct).
- `src/core/learned-skills/mutate.ts` — `commitLearnedSkillPlan` switches from `acquireFileLock`/`releaseFileLock` to `acquireOwnerAwareFileLock`/`releaseOwnerAwareFileLock`.
- `test/core/file-state.test.ts` — add dual-stealer, release-window, busy-loop, and mixed-protocol regression tests.
- No public API changes. No dependency changes. The legacy `acquireFileLock` stays exported for its existing non-overlapping callers.
