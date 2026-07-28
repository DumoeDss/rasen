## Context

The owner-aware file lock (`acquireOwnerAwareFileLock` / `releaseOwnerAwareFileLock` in `src/core/file-state.ts`) serializes read-modify-write transactions on the project knowledge catalog. Two callers share the same `ResolvedStore.lockPath`:

- **knowledge-bundle import** (`import.ts:918`) — uses `acquireOwnerAwareFileLock` (PID-liveness based stale detection).
- **learned-skill mutation** (`mutate.ts:1151`) — uses the legacy `acquireFileLock` (30-second-mtime stale detection).

The steal path of the owner-aware lock (lines 294–310) is non-atomic: it reads lock content, judges the owner PID dead via `process.kill(pid, 0) === ESRCH`, and then calls `fs.unlink(lockPath).catch(() => undefined)` by path. Two concurrent stealers of the same dead-owner lock can each `unlink` by path; one deletes the other's subsequently-created live lock. The `.catch(() => undefined)` also swallows failures while still setting `stolen = true`, causing a CPU busy-loop (no sleep, no deadline check).

The PR #88 acceptance review (B1, B2) classifies both defects as Blockers and requires deterministic regression tests.

## Goals / Non-Goals

**Goals:**

- The steal path never `unlink`s (or `rename`s) a lock file whose content it has not just verified as the dead-owner token it read.
- Only one stealer can claim a dead-owner lock; the loser discovers this atomically and waits.
- A swallowed filesystem failure respects the deadline and sleeps — no busy-loop.
- All writers sharing one `ResolvedStore.lockPath` use the same PID-liveness-based stale-detection protocol.
- Each regression test is deterministically red on `728688ba` and green after the fix, with no timing luck.

**Non-Goals:**

- Crash-consistency for multi-record bundle import (B8 — sibling child `pr88-af-bundle-transactions`).
- Backup cleanup data-loss (B3 — sibling child `pr88-af-catalog-backup`).
- Changing the legacy `acquireFileLock` itself or migrating its other callers (registry, pipeline library, profiles, worksets, workflow-package transaction — all use disjoint lockPaths).
- Distributed locking across machines. The lock is and remains machine-local.

## Decisions

### D1: Rename-based atomic claim with content verification (B1 fix)

**Decision:** Replace `unlink(lockPath)` with a two-step protocol:

1. `fs.rename(lockPath, tempPath)` — where `tempPath` is a unique path in the same directory (same naming scheme as `writeFileAtomically`'s temp file: `.<basename>.<pid>.<Date.now()>.<random>.steal-tmp`). `rename` is the single atomic claim step. Only one stealer succeeds; concurrent callers get `ENOENT`.
2. After successful rename, re-read `tempPath` and compare content with what was originally read from `lockPath`:
   - **Match** — the file at `lockPath` was still the dead-owner lock at rename time. Delete `tempPath`. Set `stolen = true`. Loop back; the next `fs.open(lockPath, 'wx')` creates the caller's own lock.
   - **Mismatch** — the file at `lockPath` was replaced between the content read and the rename (another stealer already claimed the dead lock and created a new one, and THIS stealer renamed that new live lock). Restore: attempt `fs.link(tempPath, lockPath)`. If it succeeds, `unlink(tempPath)` (the hard link's temp name). If it fails with `EEXIST`, a new lock already exists at `lockPath` — just `unlink(tempPath)`. Either way, `stolen` stays `false`; the loop falls through to deadline + sleep.

**Why rename over unlink:** `unlink` by path is not atomic with the preceding content read — the file at `lockPath` can be replaced between read and unlink, so the stealer deletes a file it never verified. `rename` moves the file atomically; after the move, the stealer holds the only reference to the moved file and can verify its content in private, without any further race on `lockPath`.

**Why content re-read (not dev/ino):** On Windows NTFS, `ino === 0n` for every file (the release-side comment at line 338 already notes this). Content comparison is the only identity check that works cross-platform. On POSIX, dev/ino could serve as a secondary check, but it adds no safety over content comparison and would require a separate code path.

**Alternative considered — stop auto-stealing on Windows:** The review permits "宁可停止自动 steal". This was rejected because the rename protocol is provably safe cross-platform: `rename` works on Windows NTFS (Node.js opens files with `FILE_SHARE_DELETE`, and `MoveFileExW` with a unique destination has no replace-semantics issue), and `link` (CreateHardLinkW) is supported on NTFS with `EEXIST` on collision. Stopping auto-stealing would turn every crashed-process lock on Windows into a manual cleanup task with no safety benefit.

**Alternative considered — fd-based fstat identity:** Open the lock with `fs.open(lockPath, 'r')`, `fstat` the fd for dev/ino, then `unlink(lockPath)` only if a subsequent `stat(lockPath)` matches. Rejected because (a) the TOCTOU window between `stat` and `unlink` is still present, just smaller; (b) dev/ino is `0n` on Windows; (c) the rename approach eliminates the TOCTOU entirely.

### D2: Busy-loop fix — stolen only on proven claim

**Decision:** `stolen` is set to `true` ONLY after the rename succeeded, the content matched, and the temp file was cleaned up. Every intermediate failure (rename ENOENT, rename other-error, read failure, content mismatch, link/restore failure) leaves `stolen = false`. The `if (!stolen)` block unconditionally checks the deadline and sleeps, so no failure path can spin without bound.

**Current bug:** `await fs.unlink(lockPath).catch(() => undefined); stolen = true;` — the `.catch` swallows EPERM/EBUSY and still sets `stolen`, skipping the sleep/deadline check.

### D3: Protocol unification for learned-skill mutation (B2 fix)

**Decision:** `commitLearnedSkillPlan` in `mutate.ts` switches from `acquireFileLock` / `releaseFileLock` to `acquireOwnerAwareFileLock` / `releaseOwnerAwareFileLock`. The `errorFor` factory and `holder` label are preserved. No other caller of `acquireFileLock` changes — their lockPaths are disjoint from the catalog lock.

**Why not migrate all `acquireFileLock` callers:** The legacy lock's 30-second mtime heuristic is correct for sub-second operations (registry, pipeline library, profiles). The danger arises ONLY when two writers sharing one lockPath use different staleness protocols. `mutate.ts` and `import.ts` are the only such pair.

### D4: Deterministic test injection

**Decision:** Tests inject races deterministically — no `setTimeout` timing bets:

- **Dual-stealer test:** Spawn a child process that creates a lock with its PID, exits (ESRCH), then orchestrate two concurrent `acquireOwnerAwareFileLock` calls with `pollMs: 0` and a long deadline. Assert that exactly one succeeds and the other either succeeds-after-wait or times out — but the lock file on disk always belongs to exactly one live owner. Neither stealer deletes the other's lock.
- **Release-window test:** Acquire a lock, then replace its content on disk (simulating a steal-and-recreate). Call `releaseOwnerAwareFileLock` — it detects the token mismatch and does not unlink. (Existing test covers this; keep it.)
- **Busy-loop test:** Create a dead-PID lock. Monkey-patch `fs.rename` (or `fs.unlink` on the pre-fix code) to always reject with a synthetic `EPERM`. Assert the acquire call respects the deadline (takes ≥ `deadlineMs`, not instant) and throws `timeout`, not a busy-spin.
- **Mixed-protocol contention test (B2):** Hold an owner-aware lock for a simulated >30-second period (directly write a lock file with a live PID, set its mtime 31 seconds in the past). Then call `commitLearnedSkillPlan` (post-fix, using `acquireOwnerAwareFileLock`) — it must NOT evict the live lock; it must wait and time out. Pre-fix (using `acquireFileLock` with 30 s mtime), it WOULD evict.

## Risks / Trade-offs

- **[rename fails on Windows open-file]** → On Windows, `MoveFileExW` can move a file opened by another process because Node.js uses `FILE_SHARE_DELETE`. If a future Node.js version changes sharing flags, rename of an open file might fail with `EPERM`. The protocol handles this safely: `stolen` stays `false`, the caller waits, and the deadline eventually fires. No correctness regression.
- **[link-based restore race]** → Between detecting content mismatch and calling `link(tempPath, lockPath)`, another process might create a new lock at `lockPath`. `link` atomically fails with `EEXIST` in that case; we clean up `tempPath` and wait. The moved file is deleted, but its original owner still holds an open fd (on POSIX the inode persists until fd close; on Windows the file data is gone but the owner's release-side token check will handle the missing file gracefully). The worst outcome is a stale fd on the original owner's side, which their `releaseOwnerAwareFileLock` already handles (stat ENOENT → return).
- **[Temp file debris]** → If the process crashes after `rename` but before `unlink(tempPath)`, a `.steal-tmp` file remains. This is inert debris (unique name, no one reads it) and is cleaned up by the same `sweepMutationDebris`-style pattern on the next acquire if needed. For the lock directory (`os.tmpdir()/rasen-locks` or the global data dir's locks), this debris is transient and self-cleans on reboot.
- **[Test isolation on Windows]** → `process.kill(pid, 0)` behavior for recycled PIDs is theoretically ambiguous but kernel-guaranteed `ESRCH` for truly dead PIDs within the test's time window. Tests use freshly-spawned children that exit immediately, so PID recycling within the test is not a concern.
