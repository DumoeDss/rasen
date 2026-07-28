## 1. Fix the steal path — rename-based atomic claim (B1)

- [x] 1.1 In `acquireOwnerAwareFileLock` (`src/core/file-state.ts`), replace the `fs.unlink(lockPath).catch(() => undefined); stolen = true;` block (lines ~300–303) with the rename-based atomic claim protocol from design.md D1: generate a unique `tempPath` in `path.dirname(lockPath)`; call `fs.rename(lockPath, tempPath)`; on success, re-read `tempPath` and compare content with the original read; on match, `unlink(tempPath)` and set `stolen = true`; on mismatch, restore via `fs.link(tempPath, lockPath)` (tolerate `EEXIST`), `unlink(tempPath)`, leave `stolen = false`
- [x] 1.2 Handle `rename` errors: `ENOENT` (another stealer already claimed) — leave `stolen = false`, loop; any other error — leave `stolen = false`, fall through to deadline + sleep. Never set `stolen = true` on any failure path
- [x] 1.3 Verify the release side (`releaseOwnerAwareFileLock`) is unchanged — its dev/ino + token guard is already correct

## 2. Unify learned-skill mutation on the owner-aware lock (B2)

- [x] 2.1 In `src/core/learned-skills/mutate.ts`, change the import at line 26 from `{ acquireFileLock, releaseFileLock }` to include `{ acquireOwnerAwareFileLock, releaseOwnerAwareFileLock }`
- [x] 2.2 In `commitLearnedSkillPlan` (line ~1151), replace `acquireFileLock({ lockPath: payload.lockPath, errorFor })` with `acquireOwnerAwareFileLock({ lockPath: payload.lockPath, errorFor, holder: 'learned-skill-catalog' })`. Replace `releaseFileLock(lock, payload.lockPath)` in the `finally` block with `releaseOwnerAwareFileLock(handle)`
- [x] 2.3 Verify no other caller of `acquireFileLock` shares a lockPath with an owner-aware caller (confirmed: registry, pipeline-library, profiles, worksets, workflow-package all use disjoint paths)

## 3. Regression tests — B1 (steal atomicity)

- [x] 3.1 Add a test in `test/core/file-state.test.ts`: spawn a child process that exits immediately to obtain a dead PID; write a dead-owner lock token; launch two concurrent `acquireOwnerAwareFileLock` calls with `pollMs: 0, deadlineMs: 5000`; assert exactly one acquires and the other either waits-then-acquires or times out; assert the lock file on disk at all times belongs to at most one live owner (never two simultaneous holders)
- [x] 3.2 Add a test: create a dead-PID lock; monkey-patch `fs.promises.rename` to reject with a synthetic `EPERM`; call `acquireOwnerAwareFileLock` with `deadlineMs: 300, pollMs: 50`; assert it takes ≥ 250 ms (respects deadline + sleep, no busy-loop) and throws `timeout`
- [x] 3.3 Add a test: acquire a lock, then overwrite its file content on disk (simulating a steal-and-recreate); call `releaseOwnerAwareFileLock`; assert it does not unlink (token mismatch). This mirrors the existing release-mismatch test — confirm it still passes with the new steal protocol

## 4. Regression tests — B2 (mixed-protocol contention)

- [x] 4.1 Add a test: write a lock file at a catalog lockPath with a live PID token and set its mtime 31 seconds in the past (simulating a >30 s hold); call `commitLearnedSkillPlan` against that same lockPath (post-fix, using the owner-aware lock); assert the mutation does NOT evict the live lock — it waits and throws timeout or a busy error. This test is deterministically red on `728688ba` (where the legacy 30 s mtime lock would evict it)

## 5. Verification

- [x] 5.1 Run `pnpm exec vitest test/core/file-state.test.ts` in isolation — confirm all new tests pass and existing tests still pass
- [x] 5.2 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 5.3 Run `pnpm lint` on changed files — confirm clean
