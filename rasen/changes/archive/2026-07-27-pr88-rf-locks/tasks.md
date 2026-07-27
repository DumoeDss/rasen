# pr88-rf-locks — Tasks

Owner-aware locking for shared YAML read-modify-write. Implements B5, M7, M8
from `rasen/changes/pr88-review-fixes/planning-context.md`. See `proposal.md`
for the design.

## Scope fences (DO NOT CROSS)

- Touch ONLY: `src/core/file-state.ts`, `src/core/knowledge-bundle/import.ts`,
  `src/core/store/membership.ts`, `src/core/project-config.ts`, plus test
  files under `test/core/file-state.test.ts`, `test/core/knowledge-bundle/import.test.ts`,
  `test/core/store/membership.test.ts`, `test/core/project-config-store-memberships.test.ts`.
- Do NOT touch: `bootstrap.ts` / `operations.ts` / `foundation.ts` (C1's
  scope), `run-state.ts` / `init.ts` / `pipeline.ts` / `portfolio-state.ts`
  (C3's scope), or any other caller of `acquireFileLock` (out of scope per
  proposal.md "Out of scope").
- Do NOT migrate the existing mtime-based `acquireFileLock` callers. Their
  operations are sub-second; leave them alone.

## Phase 1 — Shared owner-aware lock primitive

### 1.1 Implement `acquireOwnerAwareFileLock` / `releaseOwnerAwareFileLock` / `withOwnerAwareFileLock`

Add to `src/core/file-state.ts`, alongside (NOT replacing) the existing
`acquireFileLock` / `releaseFileLock`:

- `OwnerAwareFileLockOptions` interface: `{ lockPath, errorFor, deadlineMs?, pollMs?, holder? }`.
- `OwnerAwareFileLockHandle` interface: `{ lockPath, fd, token, dev, ino }`
  where `token` is the entire lock file content (string), and `dev`/`ino` are
  `bigint` from `fstat` at acquire time.
- Token format (UTF-8 string, the whole content is the comparison token):
  ```
  pid: <process.pid>
  bornAt: <new Date().toISOString()>
  holder: <options.holder ?? 'unnamed'>
  nonce: <crypto.randomBytes(16).toString('hex')>
  ```
- Acquire loop on EEXIST:
  1. Read content; if empty or unparseable (no `pid:` line) → wait + retry
     (do NOT steal).
  2. Parse pid; `process.kill(pid, 0)`:
     - success or EPERM → wait + retry.
     - ESRCH → `fs.unlink(lockPath)` (steal); loop re-creates with `wx`.
  3. Throw `errorFor('timeout', {lockPath})` after `deadlineMs` (default
     `LOCK_DEADLINE_MS = 5000`).
- Release:
  1. `await handle.fd.close().catch(() => undefined)`.
  2. `fs.lstat(lockPath, { bigint: true })`; if throws (ENOENT) or
     `dev/ino` mismatch → return without unlink.
  3. Read content; if !== `handle.token` → return without unlink.
  4. `fs.unlink(lockPath)`.
- `withOwnerAwareFileLock(options, fn)`: acquire, `try { return await fn(); }
  finally { await release(handle); }`.

Reference: `src/core/threshold-schemes.ts:235-305` is the in-repo prior art
for the same shape (`SchemeLockOwnership`, `releaseSchemeLock`,
`withSchemeLock`). Generalize; do NOT call into threshold-schemes.

### 1.2 `machineLockPath` helper

Add to `src/core/file-state.ts`:

```ts
export function machineLockPath(lockedAbsolutePath: string): string {
  const digest = createHash('sha256').update(lockedAbsolutePath, 'utf-8').digest('hex').slice(0, 32);
  return path.join(os.tmpdir(), 'rasen-locks', `${digest}.lock`);
}
```

Used by M7 (record path) and M8 (config path). NOT used by B5 (B5 keeps the
existing `lockPathFor` from `learned-skills/stores.ts:98-106` — that path is
already machine-local and per-owner).

### 1.3 Owner-aware primitive unit tests

Add to `test/core/file-state.test.ts`:

- `acquires and releases with a populated token` — lock file contains
  `pid:`/`nonce:` lines after acquire; gone after release.
- `PID-dead lock is stolen`: spawn child via `child_process.fork`; child
  acquires and `process.exit(0)` without releasing; parent reads content,
  sees dead PID, steals within one poll interval.
- `PID-alive lock is NOT stolen`: parent and child both `process.kill(parentPid, 0)`
  returns success; parent's acquire waits until child releases; on timeout
  throws `errorFor('timeout')`.
- `empty lock is NOT stolen`: write empty file at lockPath; acquire times out
  without deleting it.
- `release after token mismatch does not unlink`: hold lock A; manually
  overwrite lock file with different content; release A; lock file still
  present (do nothing).
- `release after dev/ino mismatch does not unlink`: hold lock A; delete lock
  file and recreate with same content but different inode; release A; new
  lock file still present.
- `legacy mtime-based primitive unchanged`: existing tests for
  `acquireFileLock` / `releaseFileLock` still pass byte-for-byte (regression
  guard).

## Phase 2 — B5 (knowledge-bundle import)

### 2.1 Migrate `import.ts` default dependencies

Edit `src/core/knowledge-bundle/import.ts`:

- Line 214-215: change `acquireLock: typeof acquireFileLock` /
  `releaseLock: typeof releaseFileLock` to
  `acquireLock: typeof acquireOwnerAwareFileLock` /
  `releaseLock: typeof releaseOwnerAwareFileLock`.
- Line 290-291: change `DEFAULT_DEPENDENCIES.acquireLock = acquireOwnerAwareFileLock`,
  `releaseLock = releaseOwnerAwareFileLock`.
- Line 1068: change `dependencies.releaseLock(lock, initialStore.lockPath)`
  to `dependencies.releaseLock(lock)` — the handle carries `lockPath`.
- Imports: add `acquireOwnerAwareFileLock`, `releaseOwnerAwareFileLock` from
  `../file-state.js`; remove now-unused `acquireFileLock`, `releaseFileLock`
  imports IF they are no longer referenced elsewhere in the file.

### 2.2 Update existing `import.test.ts` DI stubs

Existing tests at `test/core/knowledge-bundle/import.test.ts` lines 752, 860,
1274, 1301, 1431 pass a custom `acquireLock` for stubbing. Inspect each:

- Lines 752, 860, 1274, 1431: stub throws without returning — no signature
  change needed.
- Line 1301: stub returns `await acquireFileLock(lockOptions)` and the test
  relies on the 2-arg release contract. Change to return
  `await acquireOwnerAwareFileLock(lockOptions)`. The release call is in
  import.ts (already updated in 2.1) — no further test change needed.

### 2.3 B5 integration tests (NEW)

Add to `test/core/knowledge-bundle/import.test.ts`:

- `holds the lock for more than 30s without being stale-stolen`: spawn a
  child process that acquires the owner-aware lock at the test's
  `lockPath`, signals the parent (e.g. via a pipe or a sentinel file),
  waits 35 s, releases, and exits. Parent calls `importKnowledgeBundle` and
  expects `'knowledge_bundle_import_lock_failed'` with `reason: 'timeout'`
  within ~5 s of the deadline (NOT within 30 s — the new primitive does not
  use the 30 s mtime heuristic). Child finishes; parent retries; import
  succeeds.
- `dual-process import serializes via the lock`: spawn a child that runs an
  import which writes record `A`. While the child holds the lock, parent
  starts an import for record `B` against the same project catalog. Parent's
  import waits; child finishes successfully; parent's import acquires and
  completes; both records present.

The child helper can be a small `child_process.fork()` script under
`test/core/knowledge-bundle/fixtures/` or inlined via `--eval`. Document the
fixture path in the test header.

## Phase 3 — M7 (membership record concurrent-write preservation)

### 3.1 Wrap `writeMembershipRecord` in the owner-aware lock

Edit `src/core/store/membership.ts:730-761`:

- Compute `lockPath = machineLockPath(path.resolve(getStoreProjectRecordPath(input.store.root, projectId)))`.
- Wrap the read-compose-write-verify sequence (lines 736-757) in
  `withOwnerAwareFileLock({ lockPath, errorFor: membershipLockError, holder: 'store-membership-record' }, async () => { ... })`.
- The early-return on `recordsEqual` (line 739-741) stays INSIDE the lock —
  the no-op-on-unchanged contract still holds, just under the lock.
- Add a `membershipLockError` factory analogous to the existing
  `importLockError` in `import.ts:885-906`, with a stable diagnostic code
  like `'store_membership_record_busy'` and the same busy/create-failed
  shape. Reuse `makeLockErrorFactory` from `file-state.ts:39-60` for the
  template, with membership-specific subject/target/fix strings.

### 3.2 M7 integration test (NEW)

Add to `test/core/store/membership.test.ts`:

- `concurrent mutations of different fields on the same project record both
  survive`: set up one Store + one Project record with base roles
  `{planning: true}`. Use `Promise.all` to run two
  `applyMembershipMutation` invocations: one adds `knowledge: true` to
  roles, another sets `adoption: {...}`. After both settle, read the record
  and assert BOTH the knowledge role AND the adoption field are present.
  Without the lock, the second writer's `composeRecord` would have read the
  pre-first-write base and the second write would clobber the first.
- `concurrent mutations of different projects on the same Store do not
  serialize`: two `Promise.all` invocations for DIFFERENT projectIds on the
  same Store should proceed in parallel (different lock paths). Assert the
  total wall time is closer to one mutation than two. This guards against
  accidentally over-locking at the Store dir level.

## Phase 4 — M8 (project config hint concurrent-append preservation)

### 4.1 Wrap `appendStoreMembershipHint` in the owner-aware lock

Edit `src/core/project-config.ts:2060-2107`:

- Compute `lockPath = machineLockPath(path.resolve(configPath))` after the
  `resolveConfigFilePath` call (line 2072).
- Wrap the remainder of the function (read existing → match/merge/append →
  `writeStoreMembershipHints`) in `withOwnerAwareFileLock({ lockPath, errorFor: hintLockError, holder: 'project-membership-hint' }, async () => { ... })`.
- `writeStoreMembershipHints` already re-reads the YAML to preserve other
  fields (line 2113) — the lock just ensures the snapshot in
  `appendStoreMembershipHint`'s hand and the write in
  `writeStoreMembershipHints` see a consistent `storeMemberships` field.
- Add a `hintLockError` factory with code
  `'project_membership_hint_busy'`.

### 4.2 M8 integration test (NEW)

Add to `test/core/project-config-store-memberships.test.ts`:

- `concurrent appends of different Store hints both survive`: write a base
  config with one hint `[A]`. Use `Promise.all` to call
  `appendStoreMembershipHint` twice — once for Store `B` (uid B), once for
  Store `C` (uid C). After both settle, read the config and assert the
  hints list contains A, B, AND C (order-independent). Without the lock,
  one of B/C would be silently lost.
- `concurrent idempotent re-appends of the same hint do not duplicate`:
  `Promise.all` two `appendStoreMembershipHint` calls for the SAME Store
  uid. Assert only ONE entry exists in the final list. Guards the
  existing dedup-by-UID logic under contention.

## Phase 5 — Verify

### 5.1 Focused vitest

- `pnpm vitest run test/core/file-state.test.ts`
- `pnpm vitest run test/core/knowledge-bundle/import.test.ts`
- `pnpm vitest run test/core/store/membership.test.ts`
- `pnpm vitest run test/core/project-config-store-memberships.test.ts`
- `pnpm vitest run test/core/store/bootstrap.test.ts` (sanity — heavy user
  of `appendStoreMembershipHint`)

All must pass except the two known-prior failures cited in
`rasen/changes/pr88-review-fixes/planning-context.md` (those live in
`test/commands/pipeline.test.ts`, not in any file this child touches).

### 5.2 Lint + build

- `pnpm run lint`
- `pnpm build`

### 5.3 Cross-platform spot-check

- Confirm `process.kill(pid, 0)` is invoked in a try/catch (it throws on
  ESRCH/EPERM); confirm no platform branch is needed.
- Confirm `os.tmpdir()` is used without mutation (no env override) — the
  tests must not depend on a particular tmp path.
- Confirm `git diff --check origin/dev/0.1.5...HEAD` introduces no
  whitespace errors on touched files.

## Phase 6 — Append durable findings

After implementation settles, append 1-3 durable findings to
`rasen/changes/pr88-review-fixes/planning-context.md` under
"Appended durable findings → C2 pr88-rf-locks (planner)" so later children
(C3-C6) and any post-restart warm-seed inherit them. Likely candidates:

- The new primitive's location/signature (so future callers migrate to it
  rather than re-inventing).
- The `os.tmpdir()` lock placement rule and WHY (don't pollute git repos).
- PID liveness vs. heartbeat decision (PID is enough; heartbeat left as
  future extension hook in the token format).
