## Context

Four findings span Store registration, membership records, and project-identity reads:

- **B5** (`registry.ts:508-618`): `commitStoreRegistration` verifies identity, writes metadata if missing, then updates the registry — without holding any lock on the Store root. Two concurrent registrations of the same root under different aliases both observe absent metadata; both write it (one overwrites the other's); the loser's catch-block cleanup (lines 599-614) checks whether the store is "still referenced" by its own uid/alias/key — but since the winner committed under a different alias, the loser sees itself as unreferenced and deletes the metadata file the winner's entry depends on.
- **B6** (`migration-ops.ts:209-227, 1321-1333`): `clearProjectOwnership` (eject) and the migrate-membership `--apply` write loop directly call `readStoreProjectRecord` / `writeStoreProjectRecord` / `deleteStoreProjectRecord` without the shared machine lock. `writeMembershipRecord` (`membership.ts:755-799`) already uses `withOwnerAwareFileLock` with `machineLockPath(getStoreProjectRecordPath(...))`. The bypass means a concurrent `add-project`'s role write is silently overwritten or deleted.
- **M3** (`context.ts:306,337,347,908,915`; `execution-binding.ts:94,123,138,172`): `normalizeProjectIdentity` (trim+lowercase) is the canonical form, but 9 comparison sites use raw `===`/`!==`.
- **M4** (`project-records.ts:354-356, 414-416`): `pathIsFile` catches all errors → `false`; `listStoreProjectRecords`'s `readdir` catch-all returns empty. EACCES/EIO/EPERM/EBUSY are silently swallowed as "absent."

## Goals / Non-Goals

**Goals:**
- B5: same-root registrations serialize; cleanup never deletes metadata a committed entry depends on.
- B6: all RMW/delete on a project record acquire the shared lock and re-read inside.
- M3: every project-ID comparison uses the normalized form.
- M4: only ENOENT yields absent; other I/O errors propagate or degrade.
- Each regression test is deterministically red on `728688ba`, green after.

**Non-Goals:**
- Changing the registry data model or rekeying logic.
- Distributed locking across machines (remains machine-local).
- Migrating the legacy adoptions manifest into the locked path (it's a separate file being retired).
- Adding new project-identity grammars (UUID and kebab-case stay the only accepted forms).

## Decisions

### D1: B5 — per-root lock + metadata identity verification in cleanup

**Lock:** Acquire `withOwnerAwareFileLock` keyed by `machineLockPath(canonicalStoreRoot)` at the top of `commitStoreRegistration`. The canonical root is `getStoreRootForBackend(backend)` (already computed at line 514). Two registrations of the same root acquire the same lock and serialize.

**Cleanup verification:** In the catch block (lines 599-614), before deleting metadata, re-read the current metadata and verify its uid still matches `verified.uid` (the uid this transaction computed at verification time). If the metadata was overwritten by another registration (different uid), do NOT delete it — another transaction owns it now. The existing `stillReferenced` check (registry lookup by uid/alias/key) stays as a secondary guard.

**Why not just the lock:** The lock prevents the race in the normal case. But if a registration crashes after acquiring the lock but before releasing it (SIGKILL), the lock becomes stale and a subsequent registration steals it. The metadata identity verification in cleanup is the defense-in-depth: even if two registrations interleave due to a stolen stale lock, the cleanup won't delete metadata it didn't write.

### D2: B6 — wrap eject and migrate in the membership lock

**`clearProjectOwnership`:** The entire read-modify-write/delete sequence moves inside `withOwnerAwareFileLock`, keyed by the same `machineLockPath(path.resolve(getStoreProjectRecordPath(storeRoot, projectId)))` that `writeMembershipRecord` uses. Re-read the record inside the lock before composing the mutation.

**`migrate-membership --apply` write loop (lines 1321-1333):** Each record's write+verify moves inside `withOwnerAwareFileLock` keyed by that record's path. The loop acquires+releases per record (not one lock for the whole migration — different records have different lock paths). Before writing, re-read the current record and merge roles rather than blindly overwriting: if a concurrent `add-project` already added a knowledge role, the migration must not drop it.

**Why not a single lock for the whole migration:** The migration converts multiple project records. Each has its own lock path. A single lock would need to cover all records, but the membership lock is per-record by design (one file per project = one lock per project). Holding all locks simultaneously risks deadlock if another process locks them in a different order.

### D3: M3 — normalizeProjectIdentity at every comparison site

Replace each raw `a === b` / `a !== b` with `normalizeProjectIdentity(a) === normalizeProjectIdentity(b)`. The function is already exported from `project-records.ts` and imported in both files (or can be imported with a one-line addition).

Sites in `context.ts`:
- Line 306: `configuredId !== registered.entry.projectId`
- Line 337: `entry.projectId === id`
- Line 347: `readProjectConfig(root)?.projectId !== entry.projectId`
- Line 908: `sessionContext.execution.projectId === owner.id`
- Line 915: `readProjectConfig(canonical)?.projectId === owner.id`

Sites in `execution-binding.ts`:
- Line 94: `entry.projectId === projectId`
- Line 123: `input.explicitProjectId !== frozenProjectId`
- Line 138: `sessionExecution.projectId !== frozenProjectId`
- Line 172: `cwdIdentity === frozenProjectId`

### D4: M4 — ENOENT-discriminating authority reads

**`readRecordFile` (line 354-356):** Replace `pathIsFile(filePath)` (which catches all errors) with an explicit `fs.stat` that returns `null` only on ENOENT. Any other error (EACCES, EIO, EBUSY) propagates to the caller, which already has `try/catch` that wraps it in a `StoreError` diagnostic.

**`listStoreProjectRecords` (line 414-416):** Replace the bare `catch` on `readdir` with an ENOENT check. ENOENT → return empty records (the ordinary "no projects yet" state). Other errors → throw a `StoreError` with a degraded diagnostic naming the directory and the error code.

## Risks / Trade-offs

- **[Lock contention on registration]** → Registration is infrequent (manual `rasen store register`). The per-root lock only serializes registrations of the SAME root; different roots are unaffected. Contention is negligible.
- **[Lock contention on migrate-membership]** → Migration acquires per-record locks in a loop. If a concurrent `add-project` holds the same record's lock, the migration waits for that one record. The lock deadline (5 s default) may need increasing for large migrations; the `deadlineMs` option on `withOwnerAwareFileLock` accommodates this.
- **[M3 double-normalization]** → Some values may already be normalized (e.g., `normalizeProjectIdentity` is called earlier in the pipeline). Calling it again is idempotent (trim+lowercase of an already-trimmed-lowercase value is a no-op) and costs nothing measurable.
- **[M4 behavior change]** → Code that previously got `null` (absent) for an EACCES error now gets a thrown error or degraded diagnostic. Callers that assumed "null = absent, no other failure mode" need audit. The main callers (`readStoreProjectRecord`, `listStoreProjectRecords`, `resolveProjectMembership`) already handle errors via `try/catch` → diagnostic, so the change is compatible.
