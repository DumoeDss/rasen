# pr88-rf-locks — Owner-aware locking for shared YAML read-modify-write

Fixes PR #88 review findings **B5** (Blocker), **M7** (Major), and **M8** (Major)
from `rasen/explorations/global-store-project-unification-development-plan.md` §36.

## The defect, in one sentence

Three read-modify-write paths over shared YAML currently rely on either a
30 s mtime-only stale heuristic that deletes the lock from underneath a
legitimately long holder (B5), or on no lock at all (M7, M8) — so concurrent
rasen commands silently lose each other's non-overlapping fields.

## Findings

### B5 (Blocker) — `src/core/file-state.ts:62-64,139-147,164-169`

- `STALE_LOCK_THRESHOLD_MS = 30_000` + `Date.now() - lockStat.mtimeMs` decides
  "stale" purely from mtime. No owner, no PID liveness check, no heartbeat.
- `releaseFileLock(lock, lockPath)` closes the fd and `fs.rm(lockPath)` **uncon-
  ditionally** — even if the lock file on disk is no longer the one this holder
  created (deleted by a stale-stealer and re-created for someone else).
- Consumer: `src/core/knowledge-bundle/import.ts:917-920` calls
  `dependencies.acquireLock({lockPath: initialStore.lockPath, ...})` and holds
  it across the publish transaction (`publishStagedRecords`, line 996-1002),
  which writes one file per record. Large bundles / slow disks / slow networks
  mounted into the bundle path can push the txn past 30 s; a second import then
  steals the lock and both run their publish txn against the same catalog.

### M7 (Major) — `src/core/store/membership.ts:730-760` + `src/core/store/project-records.ts:462-478`

- `writeMembershipRecord` (membership.ts:730-761) reads the existing record
  (line 736), `composeRecord` merges the requested field into it (line 737),
  and `writeStoreProjectRecord` (project-records.ts:468-478) writes the whole
  record via single-file `tempfile + rename`.
- There is **no lock** around the read-modify-write. Two concurrent rasen
  commands mutating different fields of the SAME Project's record (one adds a
  knowledge role, another sets adoption) read the same base, each writes a
  composed record, and the second writer silently clobbers the first's field.
- The Store registry HAS a lock (`updateStoreRegistryState` at
  `foundation.ts:778-803` acquires `${registryPath}.lock`), but that lock
  protects the REGISTRY file, not the per-project record file. M7's record
  file lives at `<store>/.rasen-store/projects/<projectId>.yaml` and has no
  mutex.

### M8 (Major) — `src/core/project-config.ts:2060-2127`

- `appendStoreMembershipHint` (line 2060) calls `readProjectConfig(projectRoot)`
  at line 2079 — which reads the **whole** `storeMemberships` array — then
  composes a new array, and writes it back via `writeStoreMembershipHints`
  (line 2100 or 2105).
- `writeStoreMembershipHints` (line 2109-2128) re-reads the YAML to preserve
  **other fields**, then `doc.setIn([STORE_MEMBERSHIPS_FIELD], ...)` REPLACES
  the entire `storeMemberships` field with the snapshot `appendStoreMembershipHint`
  built BEFORE the lock was taken.
- Net effect: two concurrent rasen commands, each adding a hint for a different
  Store, both read the same base list (say, `[A]`), one writes `[A, B]`, the
  other writes `[A, C]`, and the second writer wins — Store `B`'s hint is lost
  silently.

## Approach — one owner-aware lock primitive, three call sites

### The shared contract (new code in `src/core/file-state.ts`)

Add `acquireOwnerAwareFileLock` / `releaseOwnerAwareFileLock` /
`withOwnerAwareFileLock` alongside the existing `acquireFileLock` /
`releaseFileLock`. The legacy pair stays for the many sub-second callers
(registry, project registry, pipeline registry, workflow library, worksets,
named profiles, learned-skills mutate) — their operations finish well under
30 s so the latent mtime bug does not manifest, and re-stating their lock
contracts is out of scope for this child.

**Lock file content** (plain text, multi-line — human-readable when an
operator inspects a stuck lock):

```
pid: 12345
bornAt: 2026-07-27T12:34:56.789Z
holder: knowledge-bundle-import
nonce: <32 hex chars>
```

The entire file content IS the comparison token. The PID line is parsed for
liveness; all other lines are for operators.

**Acquire rule on EEXIST** (never pure mtime):

1. Read the lock content.
2. If empty or unparseable → **wait + retry**. The window between kernel
   `create-exclusive` and `writeFile` completing is sub-millisecond; an empty
   lock that persists past the deadline is reported as busy (timeout error)
   rather than stolen — we cannot prove who owns it, so we do not delete it.
3. If parseable and `pid` is present → check `process.kill(pid, 0)`:
   - success → PID alive → **wait + retry** (legit long holder; e.g. import
     of a large bundle).
   - `ESRCH` → PID dead → **steal** (provable owner death; `fs.unlink` then
     re-`open(wx)` on next loop iteration).
   - `EPERM` → PID exists but not signalable by this user → treat as alive;
     **wait + retry**.
4. Retry until `LOCK_DEADLINE_MS` (default 5000); on timeout, throw via
   `errorFor('timeout', ...)`.

`process.kill(pid, 0)` is documented to work on Windows, Linux, and macOS as
a liveness check; Windows returns `ino: 0n` from `fstat` so the dev/ino check
is paired with a token-content check below to remain robust there.

**Release rule** (release only own token):

1. Close the fd.
2. `fs.lstat(lockPath, { bigint: true })`. If `dev` or `ino` disagree with
   what we recorded at acquire time, OR if lstat throws (ENOENT — someone
   already removed it), DO NOTHING.
3. Read lock content; if it does not match the token we wrote, DO NOTHING
   (the lock was stolen-and-recreated while we held a stale fd; deleting it
   would damage the new owner).
4. `fs.unlink(lockPath)`.

This mirrors the ownership discipline `src/core/threshold-schemes.ts:243-258`
already uses (`releaseSchemeLock` re-stats and reads the token before any
unlink), generalized and made stale-tolerant for long holders.

**Heartbeat** — not implemented. PID liveness is a sufficient "provable owner
death" signal for the three call sites in this child. The contract leaves
room for a future heartbeat field (a holder periodically rewrites `bornAt`),
but no caller in B5/M7/M8 needs it: their worst case is "PID alive but
slow", which the deadline + busy-error path handles correctly.

### B5 application — knowledge-bundle import (`src/core/knowledge-bundle/import.ts`)

- `DEFAULT_DEPENDENCIES.acquireLock` / `releaseLock` (line 290-291) swap from
  `acquireFileLock` / `releaseFileLock` to `acquireOwnerAwareFileLock` /
  `releaseOwnerAwareFileLock`.
- The `KnowledgeBundleImportDependencies` interface (line 214-215) changes
  the types accordingly. The release call at line 1068 drops its second
  argument (`initialStore.lockPath`) — the new handle carries `lockPath`.
- The lock PATH stays `${globalDataDir}/learned-skill-locks/project-<digest>.lock`
  (resolved by `lockPathFor` in `learned-skills/stores.ts:98-106`). That path
  is already machine-local, lives outside any git repo, and is per-owner.
- `importLockError` (line 885-906) keeps its error shape — the new primitive
  uses the same `FileLockErrorKind` and `FileLockErrorInfo` types, so the
  diagnostic strings (`'knowledge_bundle_import_lock_failed'`,
  `'The project knowledge catalog is busy.'`) are unchanged byte-for-byte.

### M7 application — Store authority record (`src/core/store/membership.ts`)

- New helper `withOwnerAwareFileLock` wraps the read-modify-write inside
  `writeMembershipRecord`. The lock is keyed per (Store, projectId):
  ```
  machineLockPath(absoluteRecordPath) =
    path.join(os.tmpdir(), 'rasen-locks', `${sha256(absoluteRecordPath).slice(0,32)}.lock`)
  ```
- Why `os.tmpdir()`, not next to the record file: the record file lives in a
  git repo (`<store>/.rasen-store/projects/<projectId>.yaml`). Dropping a
  `.lock` sibling into that dir would either pollute commits or require a new
  `.gitignore` entry, neither of which is acceptable for a transient
  machine-local mutex. `os.tmpdir()` is per-user on Windows and Linux, deter-
  ministically computed from the absolute locked path, and self-cleaning on
  reboot — which is the correct lifecycle for an abandoned lock.
- Inside the lock, the existing read-compose-verify sequence (membership.ts:
  736-757) runs unchanged — re-read, `composeRecord`, write, verify by
  re-read. The lock just guarantees no other rasen process is between the
  read and the write of the same record.

### M8 application — Project locator hints (`src/core/project-config.ts`)

- `appendStoreMembershipHint` wraps its whole body (line 2060-2107) in
  `withOwnerAwareFileLock` keyed by `machineLockPath(absoluteConfigPath)`.
  The config file lives in the project repo, so the same `os.tmpdir()`
  reasoning applies.
- Inside the lock: re-read `readProjectConfig(projectRoot)?.storeMemberships`
  at the moment of composition (not before the lock), then `writeStoreMembershipHints`
  re-reads the YAML to preserve OTHER fields. The composition and the write
  now both happen under the lock, so a concurrent `appendStoreMembershipHint`
  for a different Store serializes: the second caller's re-read sees the
  first caller's appended entry and adds its own next to it — both survive.

### Why ONE primitive, not three

The three findings share the exact ownership contract: unique token,
provable owner death as the only stale signal, release only own token.
Three ad-hoc implementations would drift. A single primitive in
`file-state.ts` lets a future audit (or a future migration of the registry,
pipeline, workflow, worksets, named-profile, and learned-skills callers)
verify the contract in one place. Threshold-schemes already uses a
`withSchemeLock` helper with the same shape — this child generalizes that
pattern into the shared module without changing threshold-schemes' behavior.

## Spec deltas

- **B5 — no delta.** `rasen/specs/portable-project-knowledge/spec.md`
  requirements "A bundle is validated in full before anything is imported"
  (line 103) and "Import never overwrites or removes local knowledge"
  (line 136) already imply transactional safety. The bug is an implementation
  defect in the lock primitive, not a missing spec promise.
- **M7 + M8 — delta to `store-project-membership`.** The canonical spec does
  not currently promise that concurrent rasen commands mutating the same
  Project's record (or appending different Stores' hints) preserve each
  other's non-overlapping writes. That is a real behavioral promise worth
  encoding. See `specs/store-project-membership/spec.md`.

## Canonical spec requirements satisfied

- `store-project-membership` MODIFIED "Adding membership writes each repository
  in a defined order" — adds the concurrent-preservation scenario for the
  Store record (M7).
- `store-project-membership` MODIFIED "A project carries portable locator
  hints for the Stores it belongs to" — adds the concurrent-append scenario
  for the hint list (M8).
- `portable-project-knowledge` "A bundle is validated in full before anything
  is imported" (line 103) — B5's lock fix is what upholds "anything" meaning
  "no other rasen process is mid-publish against the same catalog".

## Risks

- **Line drift.** The cited line numbers (file-state.ts:62-64, 139-147,
  164-169; membership.ts:730-760; project-config.ts:2060-2127; import.ts:
  917-920) were verified against `a884f5e4` and matched the review. C1 ships
  first and edits `bootstrap.ts` / `operations.ts` / `foundation.ts` — none
  of which this child touches. C3 ships after this child and edits
  `run-state.ts` / `init.ts` / `pipeline.ts` / `portfolio-state.ts` — also
  untouched here. No overlap.
- **PID reuse.** A holder crashes; the OS recycles its PID for an unrelated
  process before the lock is stolen. The new process has the same PID →
  `process.kill(pid, 0)` returns success → we treat the lock as alive and
  wait until deadline. Worst case: a once-in-a-blue-moon false "busy" that
  the user resolves by retrying. The risk is bounded and far better than
  mtime-stealing a legitimately held lock. (A future heartbeat field would
  close this entirely; not needed for this child.)
- **Windows `ino = 0n`.** `fstat().ino` is always 0 for NTFS. The release
  rule's dev/ino check is therefore necessary-but-insufficient on Windows;
  the token-content read at step 3 is what actually prevents deleting a
  recreated lock. Both checks are kept — defense in depth.
- **`os.tmpdir()` cleared on reboot.** A held lock file is lost if the OS
  reboots (Windows cleans temp aggressively; Linux `/tmp` survives reboot on
  systemd-tmpfiles). This is the correct behavior — a reboot definitely
  kills the holder process, so the lock is stale and its absence on next
  acquire is fine.
- **Cross-user contention on a shared repo.** Two users on the same machine
  editing the same project config get independent `tmpdir`s → independent
  lock paths → no mutual exclusion. This is the status quo for every other
  machine-local rasen state file and is out of scope for this child.
- **Heartbeat not implemented.** Documented above; PID liveness is sufficient
  for the cited call sites.

## Out of scope

- Migrating the OTHER `acquireFileLock` callers (foundation.ts, project-
  registry.ts, pipeline-library.ts, workflow-library.ts, worksets.ts,
  named-profiles.ts, learned-skills/mutate.ts, workflow-package/transaction.ts)
  to the owner-aware primitive. Their operations are sub-second so the mtime
  heuristic does not fire in practice. A separate cleanup change could do
  this; doing it here would explode the diff and the test surface for no
  behavioral gain.
- Cross-machine distributed locking. Rasen is single-machine; the spec says
  so (the lock files live under `${globalDataDir}`).
- Migrating `withSchemeLock` (threshold-schemes.ts) to call the new shared
  primitive. The threshold-scheme implementation is already owner-aware; a
  refactor to deduplicate is a cleanup, not a fix.

## Test clusters

See `tasks.md`. The clusters that are load-bearing for review:

1. **B5 — long holder is not stale-stolen**: real subprocess holds the lock
   for 35 s while the parent attempts to acquire; parent's attempt succeeds
   only after the child releases; the lock file's content (PID + nonce) is
   preserved across the wait.
2. **B5 — dual-process import/rollback**: subprocess runs an import that
   writes one record; parent runs a conflicting import concurrently; parent
   gets `'knowledge_bundle_import_lock_failed'` with `reason: 'timeout'`
   within `LOCK_DEADLINE_MS`; child finishes; parent retries successfully.
3. **M7 — concurrent field update on same Project record**: two
   `applyMembershipMutation` invocations in `Promise.all`, one adding a
   knowledge role, another setting adoption; BOTH fields present in the
   final record. Without the lock, the second writer clobbers the first.
4. **M8 — concurrent append of different Stores' hints**: two
   `appendStoreMembershipHint` invocations in `Promise.all` for different
   Store UIDs; BOTH hints present in the final config.
5. **Owner-aware primitive units**: PID-dead → steal; PID-alive → wait;
   empty lock → wait + timeout (no steal); release after token mismatch →
   no unlink; release after dev/ino mismatch → no unlink; legacy empty lock
   (no PID) → not stolen.
