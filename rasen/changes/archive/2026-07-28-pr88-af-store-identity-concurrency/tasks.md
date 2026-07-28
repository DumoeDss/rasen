## 1. B5 — Serialize Store registration by canonical root

- [x] 1.1 In `src/core/store/registry.ts`, import `withOwnerAwareFileLock` and `machineLockPath` from `../file-state.js`. Wrap the body of `commitStoreRegistration` (after computing `storeRoot` at line 514, before `verifyStoreIdentity`) in `withOwnerAwareFileLock` keyed by `machineLockPath(storeRoot)`. Use an appropriate `errorFor` factory (reuse the registry lock-error pattern from `foundation.ts`) and `holder: 'store-registration'`
- [x] 1.2 In the catch-block cleanup (lines 599-614), add a metadata identity check before `fs.rm`: re-read the current metadata via `readOptionalStoreMetadataState(storeRoot)`, compute its uid via `storeMetadataUid`, and compare with `verified.uid`. If they differ, another registration overwrote the metadata — do NOT delete it. Keep the existing `stillReferenced` registry lookup as a secondary guard

## 2. B6 — Wrap eject and migrate in the membership lock

- [x] 2.1 In `src/core/store/migration-ops.ts`, import `withOwnerAwareFileLock`, `machineLockPath` from `../file-state.js` and `getStoreProjectRecordPath` from `./project-records.js` (if not already imported). Wrap the RMW sequence in `clearProjectOwnership` (lines 213-226) inside `withOwnerAwareFileLock` keyed by `machineLockPath(path.resolve(getStoreProjectRecordPath(storeRoot, projectId)))`. Move the `readStoreProjectRecord` call inside the lock callback
- [x] 2.2 In the `migrate-membership --apply` write block (lines 1321-1344), wrap each record's write+verify inside `withOwnerAwareFileLock` keyed by that record's path. Before writing, re-read the current record and merge roles (if a concurrent `add-project` already wrote a role, preserve it) rather than blindly overwriting

## 3. M3 — Canonicalize project-ID comparisons

- [x] 3.1 In `src/core/learned-skills/context.ts`, import `normalizeProjectIdentity` from `../store/project-records.js` (if not already imported). Wrap the 5 raw comparison sites: line 306 (`configuredId !== registered.entry.projectId`), line 337 (`entry.projectId === id`), line 347 (`readProjectConfig(root)?.projectId !== entry.projectId`), line 908 (`sessionContext.execution.projectId === owner.id`), line 915 (`readProjectConfig(canonical)?.projectId === owner.id`) — each becomes `normalizeProjectIdentity(a) === normalizeProjectIdentity(b)` or `!==`
- [x] 3.2 In `src/core/pipeline-registry/execution-binding.ts`, import `normalizeProjectIdentity` from `../store/project-records.js`. Wrap the 4 raw comparison sites: line 94 (`entry.projectId === projectId`), line 123 (`input.explicitProjectId !== frozenProjectId`), line 138 (`sessionExecution.projectId !== frozenProjectId`), line 172 (`cwdIdentity === frozenProjectId`)

## 4. M4 — ENOENT-discriminating authority reads

- [x] 4.1 In `src/core/store/project-records.ts`, replace `readRecordFile` (lines 354-356): instead of `pathIsFile(filePath)` (catch-all), use `fs.stat(filePath)` and return `null` only on ENOENT; rethrow other errors. The callers (`readStoreProjectRecord`) already wrap in try/catch → diagnostic
- [x] 4.2 In `listStoreProjectRecords` (lines 414-416), replace the bare `catch` on `fs.readdir`: check `isNodeErrorCode(error, 'ENOENT')` → return empty records; other errors → throw a `StoreError` with code `store_project_records_unreadable` naming the directory and error code

## 5. Regression tests

- [x] 5.1 B5: test concurrent registration of the same root under two aliases — orchestrate two `commitStoreRegistration` calls with `Promise.all`; assert both succeed, metadata file exists after both, and no registry entry points at missing metadata. Deterministic: no timing luck (both calls share the same lock, serialized)
- [x] 5.2 B5: test cleanup does not delete metadata after overwrite — mock/stub `updateStoreRegistryState` to throw, verify the cleanup re-reads metadata and does NOT delete it when the uid differs from the transaction's
- [x] 5.3 B6: test add-project × eject concurrency — write a record with knowledge role, then concurrently run `clearProjectOwnership` and `writeMembershipRecord` adding a new role; assert the new role survives (not silently dropped)
- [x] 5.4 B6: test add-project × migrate concurrency — similar pattern for the migrate-membership apply path
- [x] 5.5 M3: test case-differing UUID — register a project with lowercase UUID, set config to uppercase, verify `resolveMachineProjectById` and `resolveFrozenExecutionBinding` recognize them as the same project
- [x] 5.6 M4: test EACCES on record file is not treated as absent (posix-only: chmod the record file to 000, verify `readStoreProjectRecord` throws/produces diagnostic rather than returning null). Test ENOENT still returns null cleanly
- [x] 5.7 M4: test I/O error on readdir is not treated as empty

## 6. Verification

- [x] 6.1 Run affected test files in isolation (`test/core/store/registry.test.ts`, `test/core/store/migration-ops.test.ts` or equivalent, `test/core/store/project-records.test.ts`, plus any context/execution-binding tests)
- [x] 6.2 Run `pnpm exec tsc --noEmit` — confirm no type errors
- [x] 6.3 Run `pnpm lint` on changed files — confirm clean
