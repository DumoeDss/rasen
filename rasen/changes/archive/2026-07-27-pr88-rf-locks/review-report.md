# Review Report — pr88-rf-locks

**Reviewer**: role-isolated reviewer (verify stage). Author != verifier.
**Date**: 2026-07-27.
**Scope**: owner-aware locking for shared YAML read-modify-write (B5, M7, M8).

## Verdict: CLEAN (with 1 Minor + 1 Trivial, neither blocks ship)

The core lock contract, the B5/M7/M8 applications, the concurrency tests, and
the delta spec are all correct. The implementation faithfully realizes the
proposal's contract: PID-liveness stale rule (never mtime), 4-step safe
release (close → lstat → re-read token → unlink), locks routed to
`os.tmpdir()` so no lock file is ever committable into a git repo, and legacy
`acquireFileLock`/`releaseFileLock` left byte-identical for sub-second callers.

## Findings

### Minor

**M-1. Double JSDoc block detaches `appendStoreMembershipHint`'s doc comment**
`src/core/project-config.ts:2051-2079`.

The pre-existing JSDoc at lines 2051-2064 (describing `appendStoreMembershipHint`
— "Appends one Store membership hint to the project's config...") used to sit
immediately above the function. C2 inserted a NEW JSDoc block (lines
2065-2071, describing `projectMembershipHintLockError`) PLUS the const
declaration (lines 2072-2077) BETWEEN the original JSDoc and the function.
TypeScript's JSDoc-to-declaration association attaches a doc comment to the
NEXT declaration only. The result:

- The original JSDoc (2051-2064) is now orphaned — it sits above another
  JSDoc, not above a declaration, so IDE hover / TypeDoc will not attach it
  to `appendStoreMembershipHint`.
- The function at line 2079 (`export async function appendStoreMembershipHint`)
  now has NO JSDoc above it (the const declaration sits between).

Failure scenario: an engineer hovering over `appendStoreMembershipHint` in
their IDE sees no documentation; the function's careful contract about
atomic writes, dedup-by-UID, and "throws when the project has no config file"
becomes invisible at the call site.

Suggested fix: move the original JSDoc to immediately ABOVE `export async
function appendStoreMembershipHint` (i.e., below the const declaration), so
the file reads:

```
const projectMembershipHintLockError = makeLockErrorFactory({ ... });

/**
 * Appends one Store membership hint ...
 */
export async function appendStoreMembershipHint(...)
```

### Trivial

**T-1. Unit test "serializes two concurrent callers" relies on a 10ms timing stagger**
`test/core/file-state.test.ts` — `it('serializes two concurrent callers via the same lock path')`.

Caller B is staggered by `await new Promise((r) => setTimeout(r, 10))` to
ensure caller A wins the first acquire. On a heavily loaded CI runner this
head-start could in principle be insufficient (A's `fs.open(wx)` has not yet
completed when B's 10ms timer fires), and the assertion
`expect(log).toEqual(['A-start', 'A-end', 'B-start', 'B-end'])` would fail
with the order reversed. The B5/M7/M8 integration tests all use the stronger
pre-acquire-then-release pattern and do NOT have this issue; this is the only
test in the change that depends on sub-100ms scheduling.

Suggested fix (optional): replace the 10ms stagger with the same pre-acquire
pattern used by the M7/M8 tests (pre-acquire the lock at `lockPath`, start
both callers via `Promise.all`, release the pre-acquired handle). This makes
the test deterministic regardless of runner load.

## Independent verification

### Focused tests (run once, per coordinator instruction)

```
pnpm vitest run test/core/file-state.test.ts \
  test/core/knowledge-bundle/import.test.ts \
  test/core/store/membership.test.ts \
  test/core/project-config-store-memberships.test.ts
```

Result: **4 files passed, 93 tests passed | 2 skipped** (2 skipped are
pre-existing platform-conditional tests in file-state, not introduced by C2).
Duration 12.16s. The load-bearing new tests all pass:
- `owner-aware file lock > does NOT steal a lock whose owner PID is alive (times out)` ✓
- `owner-aware file lock > steals a lock whose owner PID is provably dead (ESRCH)` ✓
- `owner-aware file lock > does NOT steal an empty (unparseable) lock` ✓
- `owner-aware file lock > does not unlink on release when the token content changed` ✓
- `owner-aware import lock (B5) > waits rather than stealing when the lock is held by a live process` ✓
- `owner-aware import lock (B5) > serializes two concurrent imports so both records survive` ✓
- `owner-aware import lock (B5) > cleans up the lock file on a transactional rollback` ✓
- `concurrent membership record writes (M7) > preserves both fields when two concurrent writes target different fields of the same record` ✓
- `concurrent membership record writes (M7) > does not serialize concurrent writes targeting different projects` ✓
- `concurrent appends (M8 owner-aware lock) > preserves both hints when two concurrent appends target different Stores` ✓
- `concurrent appends (M8 owner-aware lock) > does not duplicate when two concurrent appends target the same Store` ✓
- `concurrent appends (M8 owner-aware lock) > the lock file does not live inside the project git repo` ✓

### TypeScript

```
pnpm exec tsc --noEmit
```

Result: **PASS** (zero diagnostics). The `acquireLock`/`releaseLock` type
swaps in `KnowledgeBundleImportDependencies` compile cleanly; the new
handle shape (`OwnerAwareFileLockHandle`) flows through `applyPlan`'s
finally block without mismatch.

## Scope check: PASS

`git diff --name-only` shows this child touched ONLY its declared files:
- `src/core/file-state.ts` ✓ (new primitive at lines 174-382)
- `src/core/knowledge-bundle/import.ts` ✓ (4-line B5 swap)
- `src/core/store/membership.ts` ✓ (M7 wrap)
- `src/core/project-config.ts` ✓ (M8 wrap, only the ~2060-2140 region)
- `test/core/file-state.test.ts`, `test/core/knowledge-bundle/import.test.ts`,
  `test/core/store/membership.test.ts`,
  `test/core/project-config-store-memberships.test.ts` ✓

NOT touched (correctly): `bootstrap.ts`/`operations.ts`/`foundation.ts` (C1),
`run-state.ts`/`init.ts`/`pipeline.ts`/`portfolio-state.ts` (C3),
`src/core/store/project-records.ts` (verified zero diff). The other
uncommitted files visible in the worktree (`src/commands/pipeline.ts`,
`src/core/init.ts`, `src/core/pipeline-registry/*`, `src/core/store/bootstrap.ts`,
`src/core/store/foundation.ts`, `src/core/store/operations.ts`,
`test/commands/pipeline.test.ts`, `test/core/store/bootstrap-obtain.test.ts`)
belong to siblings C1/C3 and are excluded from this review.

## Lock contract verification (the core of the review)

### Acquire rule — no mtime, no live-holder deletion path

`src/core/file-state.ts:218-282` (`acquireOwnerAwareFileLock`).

On `EEXIST`, the loop reads the lock content and:
1. **Empty/unparseable** (no `pid:` line) → `parsePidFromLockContent` returns
   `undefined` → falls through to wait+retry. The lock is NEVER deleted on
   this path. Verified by the test "does NOT steal an empty (unparseable)
   lock" (`file-state.test.ts`) — the empty file survives the deadline.
2. **PID parsed** → `pidIsAlive(pid)` calls `process.kill(pid, 0)`:
   - success → `return true` (alive) → wait+retry.
   - `EPERM` → `return true` (alive, not signalable) → wait+retry.
   - `ESRCH` → `return false` (provable death) → `fs.unlink` + `stolen = true`.
   - Any other error → `return true` (treat as alive) → wait+retry.

There is NO code path where a live holder's lock is deleted. The only
deletion path is `ESRCH` (kernel-affirmed "no such process"). The mtime
variable `STALE_LOCK_THRESHOLD_MS` and `lockStat.mtimeMs` exist ONLY in the
legacy `acquireFileLock` above — confirmed absent from the new primitive
by reading the full function body.

### Release rule — 4-step, deletes only on token match

`src/core/file-state.ts:284-323` (`releaseOwnerAwareFileLock`).

1. `await handle.fd.close().catch(() => undefined)` — always closes.
2. `fs.lstat(handle.lockPath, { bigint: true })` — if throws (ENOENT or
   anything) → return without unlink. If `dev` or `ino` disagree with
   acquire-time values → return without unlink.
3. `fs.readFile(handle.lockPath, 'utf-8')` — if !== `handle.token` → return
   without unlink. If read fails → return without unlink.
4. `fs.unlink(handle.lockPath)` — only reached when dev/ino AND token
   content all match.

The token-content re-read at step 3 is what protects a recreated lock on
Windows NTFS where `ino === 0n` for every file (step 2 is
necessary-but-insufficient there). Verified by test "does not unlink on
release when the token content changed" — the replacement lock survives.

The TOCTOU window between step 3 (readFile) and step 4 (unlink) is safe:
another process can only acquire the lock if our PID is dead (ESRCH) — but
we are running release(), so we are alive, and no stealer can create a new
lock at this path between our read and our unlink.

### `machineLockPath` — locks never committable

`src/core/file-state.ts:362-370`.

```
machineLockPath(abs) = path.join(os.tmpdir(), 'rasen-locks', sha256(abs).slice(0,32) + '.lock')
```

Used by M7 (`membership.ts:761-763`) for `<store>/.rasen-store/projects/<projectId>.yaml`
and M8 (`project-config.ts:2103`) for `<project>/rasen/config.yaml`. Both
locked files live inside git repos; the lock lives in `os.tmpdir()`. The
"no machine-local file in Git" invariant is upheld — verified by the test
"the lock file does not live inside the project git repo" which walks the
project tree and asserts zero `.lock` files.

B5 does NOT use `machineLockPath` — it keeps the existing `lockPathFor`
path under `${globalDataDir}/learned-skill-locks/`, which is already
machine-local and outside any git repo. Correct per proposal.

### B5 — knowledge-bundle import

`src/core/knowledge-bundle/import.ts`:
- Lines 18-22: imports swapped from `acquireFileLock`/`releaseFileLock` to
  `acquireOwnerAwareFileLock`/`releaseOwnerAwareFileLock`. Grep confirms
  zero remaining references to the legacy names in this file.
- Lines 211-215: `KnowledgeBundleImportDependencies.acquireLock`/`releaseLock`
  type signatures changed to the new primitives.
- Lines 287-291: `DEFAULT_DEPENDENCIES` swapped.
- Line 1065: `dependencies.releaseLock(lock)` — dropped the 2nd argument
  (`initialStore.lockPath`) since the handle carries `lockPath`.

`importLockError` (lines 885-906 per proposal, NOT in the diff) is
unchanged — it still produces `code: 'knowledge_bundle_import_lock_failed'`
with `details.reason: 'timeout' | 'create-failed'`. The new primitive uses
the same `FileLockErrorKind`/`FileLockErrorInfo` types, so the error shape
is byte-identical. Verified by the B5 test which asserts
`{ code: 'knowledge_bundle_import_lock_failed', details: { reason: 'timeout' } }`.

The lock PATH is unchanged — it still comes from `lockPathFor` in
`learned-skills/stores.ts` via `initialStore.lockPath`. B5 only changes
WHICH primitive guards that path.

Other test stubs at `import.test.ts:755, 863, 1277, 1434` use
`async () => { throw ... }` — they never return a handle, so the new
return type is compatible (no stub change needed; the green test run
confirms).

### M7 — membership record concurrent-write preservation

`src/core/store/membership.ts:755-805`.

The ENTIRE read-compose-write-verify sequence (readStoreProjectRecord →
composeRecord → recordsEqual early-return → writeStoreProjectRecord →
readStoreProjectRecord verify) runs inside `withOwnerAwareFileLock`.
Lock path: `machineLockPath(path.resolve(getStoreProjectRecordPath(input.store.root, projectId)))`
— keyed per (Store, projectId), so two concurrent writes to DIFFERENT
projects on the same Store get independent lock paths (verified by test
"does not serialize concurrent writes targeting different projects").

`composeRecord` uses `mergeStoreProjectRoles` which OR-merges each role
(`planning: existing.planning || requested.planning`), so a `false` input
does NOT clobber a `true` set by a concurrent writer. The lock ensures the
second writer sees the first writer's committed base rather than a stale
pre-lock snapshot — verified by test "preserves both fields when two
concurrent writes target different fields of the same record" which
asserts both `roles: { planning: true, knowledge: true }` AND the adoption
field survive.

### M8 — project-config hint concurrent-append preservation

`src/core/project-config.ts:2079-2141`.

The entire read-match-merge-append-write body runs inside
`withOwnerAwareFileLock`. The lock is acquired AFTER input validation
(uid/id required, portable-value assertions) and AFTER `resolveConfigFilePath`
— these don't touch shared state, so excluding them from the lock is correct.

The re-read `readProjectConfig(projectRoot)?.storeMemberships ?? []` is
INSIDE the lock body (line 2111), not before the lock. This is the crux of
the fix — the original bug snapshotted the array before any lock. Verified
by test "preserves both hints when two concurrent appends target different
Stores" which uses the deterministic pre-acquire-then-release pattern and
asserts all three UIDs (A, B, C) survive.

`writeStoreMembershipHints` (line 2143) re-reads the YAML inside the lock
to preserve other top-level fields — this second read is safe because the
lock body holds the mutex.

## Delta spec title check: PASS

`rasen/changes/pr88-rf-locks/specs/store-project-membership/spec.md` uses
`## MODIFIED Requirements` for two requirements. Both titles match the
canonical `rasen/specs/store-project-membership/spec.md` VERBATIM:

1. Delta: `### Requirement: Adding membership writes each repository in a defined order and reports what still needs repair`
   Canonical (line 142): `### Requirement: Adding membership writes each repository in a defined order and reports what still needs repair`
   ✓ Exact match.

2. Delta: `### Requirement: A project carries portable locator hints for the Stores it belongs to`
   Canonical (line 68): `### Requirement: A project carries portable locator hints for the Stores it belongs to`
   ✓ Exact match.

Both delta requirements preserve the canonical body paragraph verbatim and
append a new paragraph encoding the concurrent-write contract. All canonical
scenarios are preserved verbatim; new scenarios are appended below them. No
scenario was silently renamed or dropped.

## Legacy callers — unaffected

`acquireFileLock` (line 121) and `releaseFileLock` (line 166) in
`src/core/file-state.ts` are byte-identical to the pre-change version
(verified by reading the full function bodies). Their many callers
(registry, project registry, pipeline library, workflows, worksets, named
profiles, learned-skills mutate) are untouched and continue to use the
mtime-based stale heuristic, which is correct for their sub-second
operations.

## Summary table

| Severity | Count | Items |
|----------|-------|-------|
| Blocker  | 0     | — |
| Major    | 0     | — |
| Minor    | 1     | M-1 (double JSDoc detaches function doc) |
| Trivial  | 1     | T-1 (10ms timing stagger in one unit test) |
