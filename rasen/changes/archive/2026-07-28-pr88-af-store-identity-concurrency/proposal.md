## Why

Four findings from the PR #88 acceptance review — two Blockers (B5, B6) and two Majors (M3, M4) — all in Store identity, membership, and project-record code paths:

1. **B5:** Concurrent registration of the same canonical Store root under different aliases can race: both see no metadata, both write metadata (one overwrites the other), and the loser's catch-block cleanup deletes the metadata file the winner's committed registry entry depends on — leaving a registry pointing at a Store with no identity metadata.
2. **B6:** `store eject` and `migrate-membership --apply` read-compose-write (or delete) the project membership record WITHOUT the shared machine lock that `writeMembershipRecord` already uses. A concurrent `add-project` can write a new role between the stale read and the overwrite — silently losing the update.
3. **M3:** Project identity is defined as trim+lowercase (`normalizeProjectIdentity` in `project-records.ts:97`), but `learned-skills/context.ts` and `pipeline-registry/execution-binding.ts` compare raw strings. A hand-edited uppercase UUID is misreported as stale, mismatched, or missing across registry/config/session/frozen resolution.
4. **M4:** `project-records.ts` authority reads (`pathIsFile`, bare `catch` on `readdir`) swallow non-ENOENT I/O errors (EACCES, net-drive blip, Windows delete-pending) as "absent/empty." A real member is silently reported as non-member.

## What Changes

- **B5:** Serialize `commitStoreRegistration` by canonical Store root using a `machineLockPath`-keyed owner-aware lock. Inside the lock, the existing verify→write→register sequence is safe. Cleanup in the catch block additionally verifies the current metadata content still belongs to this transaction (uid match) before deleting — if another registration overwrote it, the metadata stays.
- **B6:** Wrap `clearProjectOwnership` (eject path) and the `migrate-membership --apply` write loop in `withOwnerAwareFileLock` using the same `machineLockPath` key that `writeMembershipRecord` uses. Re-read the record inside the lock before composing the mutation.
- **M3:** Wrap every raw project-ID comparison in `context.ts` (lines 306, 337, 347, 908, 915) and `execution-binding.ts` (lines 94, 123, 138, 172) with `normalizeProjectIdentity()` on both sides.
- **M4:** Replace the catch-all `pathIsFile` and bare-`catch` `readdir` in `project-records.ts` with ENOENT-discriminating checks. Only ENOENT yields "absent"; EACCES/EIO/EPERM/EBUSY propagate as errors or degraded diagnostics.

## Capabilities

### New Capabilities

- `store-registration-concurrency`: Concurrent registration of the same Store root is serialized; a failed registration's cleanup never deletes identity metadata another committed entry depends on.
- `membership-record-mutation-safety`: All read-modify-write and delete operations on a project membership record acquire the shared machine lock and re-read inside it, so a concurrent mutation is never silently dropped.
- `project-identity-canonical-form`: Project identity is compared in its normalized (trim+lowercase) form at every boundary — registry, config, session, frozen binding — so case-differing UUIDs are never misreported.
- `project-record-read-integrity`: Authority reads of project membership records distinguish "file does not exist" (ENOENT) from "file exists but is unreadable" (permission, I/O fault), reporting the latter rather than silently treating it as absence.

### Modified Capabilities

## Impact

- `src/core/store/registry.ts` — wrap `commitStoreRegistration` in a per-root lock; strengthen cleanup identity verification (B5).
- `src/core/store/migration-ops.ts` — wrap `clearProjectOwnership` and the migrate-membership apply write in `withOwnerAwareFileLock` (B6).
- `src/core/learned-skills/context.ts` — wrap 5 raw project-ID comparisons with `normalizeProjectIdentity` (M3).
- `src/core/pipeline-registry/execution-binding.ts` — wrap 4 raw project-ID comparisons with `normalizeProjectIdentity` (M3).
- `src/core/store/project-records.ts` — ENOENT-discriminating `readRecordFile` and `listStoreProjectRecords` (M4).
- Tests: deterministic regression tests for each finding.
- No public API changes. No dependency changes.
