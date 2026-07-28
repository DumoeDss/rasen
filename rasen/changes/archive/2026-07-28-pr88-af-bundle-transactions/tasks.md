## 1. B8 — Transaction marker for partial-import detection

- [x] 1.1 In `src/core/knowledge-bundle/import.ts`, define a transaction marker path: `path.join(storeResolution.store.dir, '.bundle-import-transaction.json')`. Define the marker shape: `{ bundleId: string, projectId: string, expectedRecords: string[], startedAt: string }`
- [x] 1.2 Before `publishStagedRecords` (after staging is verified, ~line 996), write the marker atomically via `writeFileAtomically(markerPath, JSON.stringify(marker))`. List all `locked.newRecords` IDs in `expectedRecords`
- [x] 1.3 After successful completion (after staging cleanup, ~line 1054), remove the marker: `fs.rm(markerPath, { force: true }).catch(() => undefined)`
- [x] 1.4 Add a detection function `detectStaleImportTransaction(storeDir): Promise<StaleTransactionReport | null>`. On import entry (before acquiring the lock), check for the marker. If found, read it, scan which expected records exist as managed records, return a degraded diagnostic listing published vs missing
- [x] 1.5 Wire the detection into `importKnowledgeBundle` (the public entry point): if a stale marker is detected, include the diagnostic in the result's warnings/degraded field, then remove the marker
- [x] 1.6 Update the spec/CLI docs: change "all-or-nothing" to "atomic for catchable failures; not crash-safe across SIGKILL/power loss; partial imports are detected on next run." Update help text and any user-facing error messages that promise unconditional atomicity

## 2. M2 — Close the export publication TOCTOU

- [x] 2.1 In `src/core/knowledge-bundle/export.ts`, after `verifyKnowledgeBundleStoreDirectory(options.authorization)` (line 561) but before `io.publishNewFile` (line 563), re-call `io.pathOwnsOpenFile(fd, temporary)`. If it returns false, throw `KnowledgeBundleExportError` with code `knowledge_bundle_write_failed` and reason "staging pathname ownership changed after authorization"
- [x] 2.2 After `io.publishNewFile(temporary, destination)` succeeds (line 563), read the destination file and compare its content to `serializedBundle`. If they differ, throw `KnowledgeBundleExportError` with code `knowledge_bundle_write_failed` and reason "published destination content does not match the written bundle"
- [x] 2.3 Add a guard for `ino === 0n` platforms: after the `pathOwnsOpenFile` check at line 541, if `fstat(fd).ino === 0n`, set a flag indicating the identity check is vacuous. The post-link content comparison (task 2.2) is the authoritative guard in this case — log/annotate that content verification is the fallback

## 3. Regression tests — B8

- [x] 3.1 Test partial-publish + recovery: set up a 3-record bundle import; inject a failure (via IO dependency mock) after the 2nd record is published; assert the marker file exists with all 3 expected IDs; simulate next import; assert the degraded diagnostic lists 2 published + 1 missing; assert the marker is cleaned up after reporting
- [x] 3.2 Test no-marker-no-report: run a normal import; assert no marker remains; assert no degraded diagnostic on the next import
- [x] 3.3 Test catchable-exception rollback still works: inject a throw mid-publish; assert all published records are rolled back; assert the marker is removed in the rollback path

## 4. Regression tests — M2

- [x] 4.1 Test temp-path swap detection: inject an IO mock that replaces the temp file between authorization and link; assert the export throws (not wrong-bytes success). Deterministic: the mock swaps on `beforePublish` callback
- [x] 4.2 Test destination content mismatch detection: inject an IO mock where `publishNewFile` links a different file; assert the post-link content check catches it and throws
- [x] 4.3 Test the existing happy path still works: a normal export publishes and verifies successfully (no false alarm)

## 5. Verification

- [x] 5.1 Run affected test files in isolation (`test/core/knowledge-bundle/import.test.ts`, `test/core/knowledge-bundle/export.test.ts` or equivalent)
- [x] 5.2 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 5.3 Run `pnpm lint` on changed files — confirm clean
