## Why

After a learned-skill catalog record is successfully published, the code cleans up the backup (the old record moved aside before the swap). On Windows, antivirus/file-lock/I/O faults can make the recursive `fs.rmSync(backup)` throw part-way through. The current catch block then **deletes the successfully-published new record and restores the partially-deleted backup** — data loss. This happens at two sites in `mutate.ts`:

1. `writeCanonicalDirectory` (lines 974-980): after `fs.renameSync(staging, directory)` succeeds, the `fs.rmSync(backup)` catch deletes `directory` (the new record) and restores `backup` (now missing files).
2. `commitRename` (lines 1324-1328): same pattern — after `writeCanonicalDirectory(payload.directory, ...)` succeeds, the `fs.rmSync(backup)` catch deletes `payload.directory` and restores the partial backup.

The existing backup tests only cover complete crash debris (`sweepMutationDebris`), never a partial-delete failure mid-cleanup.

## What Changes

- Once the new record is published (rename or write succeeds), a backup-cleanup failure SHALL NOT roll back. The new record stays intact. The backup debris is left behind (inert, temp-prefixed, ignored by the catalog, cleaned by `sweepMutationDebris` on the next mutation). A degraded condition is reported in the mutation result.
- Both sites in `mutate.ts` are fixed: the catch block for `fs.rmSync(backup)` no longer deletes the new record or restores the partial backup. Instead it records a warning and continues.
- `writeCanonicalDirectory` returns a `{ degraded?: string }` flag so `commitLearnedSkillPlan` can include the warning in the result. `commitRename` returns a `LearnedSkillBlock | { degraded?: string }` similarly.

## Capabilities

### New Capabilities

- `catalog-backup-cleanup-safety`: Once a new catalog record is published, a backup-cleanup failure may only retain the new record and leave inert debris — it must never delete the published record or restore a partially-deleted backup.

### Modified Capabilities

## Impact

- `src/core/learned-skills/mutate.ts` — rewrite the two backup-cleanup catch blocks (lines 974-980 and 1324-1328); add degraded reporting to the function returns.
- `test/core/learned-skills/mutate.test.ts` (or equivalent) — add partial-delete regression test.
- Note: the backup cleanup runs INSIDE the owner-aware lock's critical section (post-#1 B2 fix). If async retry logic is added inside the lock, the 5 s default deadline may need an explicit `deadlineMs`.
