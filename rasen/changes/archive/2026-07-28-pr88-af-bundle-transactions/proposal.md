## Why

Two findings in knowledge-bundle import/export:

1. **B8:** Multi-record import publishes records one-by-one (`publishStagedRecords`, import.ts:798-883). The rollback in `applyPlan` (lines 1004-1047) fires only for catchable exceptions — SIGKILL or power loss after publishing records 1..N leaves them permanently in the catalog with no detection. The spec and CLI docs promise unconditional "all-or-nothing" import, which the implementation never truly delivered.
2. **M2:** Bundle export's publication path has a TOCTOU window. `pathOwnsOpenFile(fd, temporary)` (export.ts:541) verifies the fd still owns the temp path, then `beforePublish` + Store authorization run, then `fs.linkSync(temporary, destination)` publishes (line 563). Between the ownership check and the link, an attacker can swap the temp path (publishing wrong bytes) or replace the authorized parent with a symlink/junction (publishing outside the Store subtree). On Windows NTFS where `ino === 0n`, the `pathOwnsOpenFile` check is vacuous — it matches ANY file on the same device.

## What Changes

- **B8 (narrow contract + best-effort recovery):** Spec and CLI docs are updated to state honestly: multi-record import is atomic for catchable failures but NOT crash-safe across process kill or power loss (records 1..N may remain). A transaction marker file is written atomically before the publish loop begins, listing the expected record set. On successful completion, the marker is removed. On the next import or catalog read, a stale marker triggers a degraded diagnostic reporting which records from the expected set are published vs missing — the catalog is not silently inconsistent.
- **M2 (close the TOCTOU):** After Store authorization but immediately before `linkSync`, re-verify the temp file's identity against the open fd. After `linkSync`, verify the destination file's content matches the serialized bundle written to the fd. On platforms where file identity cannot be proven (`ino === 0n`), fail with a diagnostic rather than returning success.

## Capabilities

### New Capabilities

- `bundle-import-crash-consistency`: The honest contract for multi-record import under process/machine failure, plus best-effort detection of a partial import on the next run.
- `bundle-export-publication-integrity`: The observable contract that a published bundle's bytes and destination are verified against the authorized fd after every publication step, and that a platform unable to prove file identity fails rather than succeeds.

### Modified Capabilities

## Impact

- `src/core/knowledge-bundle/import.ts` — write/remove transaction marker; add stale-marker detection on import entry; update error messages.
- `src/core/knowledge-bundle/export.ts` — re-verify identity before `linkSync`; verify destination content after `linkSync`; fail on `ino === 0n` for the ownership check.
- CLI docs and spec language for bundle import — narrow the "all-or-nothing" promise.
- Tests: simulate partial-publish + recovery detection (B8); inject path-swap between auth and link (M2).
- No public API changes to function signatures. No dependency changes.
