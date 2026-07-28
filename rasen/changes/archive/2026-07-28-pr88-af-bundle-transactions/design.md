## Context

**B8:** `applyPlan` in `import.ts` (lines 909-1054) orchestrates a multi-record import:
1. Acquire owner-aware lock on the catalog lockPath.
2. Re-resolve store, build locked plan.
3. Create staging directory, write all records to staging, verify staging.
4. `publishStagedRecords` (lines 798-883): for each record, `createDirectoryExclusive(target)` → publish manifest + content → verify. Records are published one at a time.
5. On catchable exception (lines 1004-1047): roll back published records + staging + created directories.
6. On success: clean up staging.

The gap: step 5 only fires for catchable exceptions. SIGKILL/power loss during step 4 leaves records 1..(k) published with the staging directory orphaned. There is no marker to detect this on the next run.

**M2:** `writeKnowledgeBundleFile` in `export.ts` (lines 525-564):
1. Open temp file exclusively (`openExclusive` → `fs.openSync(target, 'wx', 0o600)`).
2. Write content, fsync.
3. `pathOwnsOpenFile(fd, temporary)` — compare `fstat(fd)` vs `stat(temporary)` by dev/ino.
4. `beforePublish(destination)` — hook.
5. `verifyKnowledgeBundleStoreDirectory(authorization)` — Store auth check (symlink/junction guard, canonical path check, dev/ino match).
6. `publishNewFile(temporary, destination)` — `fs.linkSync(temporary, destination)`.

The TOCTOU window is between step 3 (ownership verified) and step 6 (link). Steps 4-5 run hooks and authorization — during which the temp path or the destination parent can be swapped. Additionally, on Windows NTFS, `fstat.ino === stat.ino === 0n` for all files, so step 3's ownership check is vacuous.

## Goals / Non-Goals

**Goals:**
- B8: spec/docs honestly describe the crash-consistency boundary. A transaction marker enables best-effort detection of partial imports on the next run.
- M2: the publication path verifies identity immediately before AND after `linkSync`. Platforms that cannot prove file identity fail rather than succeed.
- Each regression test is deterministically red on `728688ba`, green after.

**Non-Goals:**
- Full WAL/journal with automatic rollback of partial publishes (the B8 decision explicitly chose narrow-contract + detection over full crash-safety).
- Atomic multi-record publish (would require catalog-level atomic write or a persistent journal — deferred to a potential follow-up).
- Changing the `publishStagedRecords` record-by-record publication strategy.
- Migrating the export IO interface shape.

## Decisions

### D1: B8 — Transaction marker file for best-effort detection

**Marker location:** `<storeDir>/.bundle-import-transaction.json` — inside the project knowledge catalog directory (the Store's knowledge home), not in staging (which is cleaned up on success).

**Marker content:** `{ bundleId, projectId, expectedRecords: ["id1", ...], startedAt: ISO }`.

**Lifecycle:**
- Written atomically (`writeFileAtomically`) immediately before `publishStagedRecords` begins.
- Removed on successful completion (after all records published + verified + staging cleaned).
- If the process crashes mid-import, the marker survives.

**Detection:** On the next import to the same project catalog, before acquiring the lock, check for a stale marker. If found:
- Read the expected record set.
- Scan which records are actually published (exist as managed records in the catalog).
- Report a degraded diagnostic: "A previous bundle import was interrupted. Records [list] were published; records [list] were not. The catalog is consistent but incomplete."
- The marker is then removed (the user decides whether to re-import).

**Why not automatic rollback:** The review's B8 decision explicitly chose narrow-contract + best-effort detection. Automatic rollback would require a journal and recovery logic that can distinguish "partially imported by this transaction" from "pre-existing records that happen to overlap" — a much larger scope. Detection + reporting is additive, reversible, and honest.

### D2: M2 — Close the export TOCTOU with pre-link and post-link verification

**Pre-link re-verification:** After `verifyKnowledgeBundleStoreDirectory(authorization)` but immediately before `publishNewFile`, re-call `pathOwnsOpenFile(fd, temporary)`. This closes the window between the original ownership check (step 3) and the authorization check (step 5). If ownership was lost during authorization, fail.

**Post-link destination verification:** After `publishNewFile` succeeds, read the destination file and compare its content to the `serializedBundle` that was written to the fd. If they differ, the wrong bytes were published — throw. Also `stat` the destination and verify its dev/ino matches the fd's fstat (on POSIX). On Windows NTFS where `ino === 0n`, the content comparison is the authoritative check.

**Platform identity failure:** The existing `pathOwnsOpenFile` returns `true` whenever `fstat(fd).dev === stat(path).dev && fstat(fd).ino === stat(path).ino`. On NTFS, `ino === 0n` for every file, so this is `dev === dev && true` — it matches any file on the same device. The fix adds a guard: if `opened.ino === 0n`, the ownership check is insufficient by itself. The post-link content comparison is the fallback that catches a swap on all platforms.

## Risks / Trade-offs

- **[Marker debris after crash]** → If the process crashes after writing the marker but before any records are published, the marker exists but no partial state occurred. The detection logic handles this gracefully: all expected records are "not yet published," and the diagnostic says "no records were published." The user can safely re-import.
- **[Content comparison cost]** → Reading the destination file after every publish adds one file read per export. Bundle files are small (bounded by `LEARNED_SKILL_CONTENT_BUDGET`), so the cost is negligible.
- **[Windows `ino === 0n` false alarm]** → On NTFS, the pre-link ownership check is vacuous. The post-link content comparison is the real guard. If a future NTFS update provides non-zero inodes, both checks become meaningful. No code change needed.
- **[Contract narrowing is user-visible]** → The spec change from "all-or-nothing" to "atomic for catchable failures, not crash-safe" is a promise reduction. This is the honest description of what the code actually does. The transaction marker detection mitigates the user impact.
