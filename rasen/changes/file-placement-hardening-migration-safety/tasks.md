## 1. Lock cleaner safety with failing tests

- [x] 1.1 Replace invalid placeholder run-state fixtures in `test/core/ephemera-cleaner.test.ts` with schema-valid `auto-run.json`, `portfolio-run.json`, and `goal-run.json` fixtures, then add byte-preservation assertions for malformed JSON, schema-invalid content, and unsupported explicit version markers for each known state filename.
- [x] 1.2 Add recursive classification tests for a nested `src/main.ts` and nested source manifests, asserting every discovered signal is reported and an otherwise valid top-level deletion candidate remains on disk; retain coverage that nested non-source directories, symlinks, and unknown files are preserved.
- [x] 1.3 Add dependency-injected read/lstat failure tests proving only `ENOENT` is absence and `EACCES`, `EPERM`, and `EIO` block the complete cleaner plan before any deletion.
- [x] 1.4 Add cleaner apply-race tests that replace or mutate a deletion candidate after classification and assert identity revalidation refuses to delete the changed path.

## 2. Implement complete cleaner plan and guarded apply

- [x] 2.1 In `src/core/ephemera-cleaner.ts`, centralize explicit manifest names, source-directory names, source extensions, known state filenames, and the filename-to-validator registry; reuse the canonical auto-run and portfolio parsers and add a bounded validator for the generated goal-round record contract.
- [x] 2.2 Refactor `classifyEphemera` into a deterministic recursive preflight that records candidate fingerprints, preserved paths/reasons, all source signals, and typed filesystem blockers without following symlinks or mutating disk.
- [x] 2.3 Refactor `applyEphemeraDeletion`/`cleanEphemera` to reject aborted or incomplete plans, revalidate each candidate's regular-file identity, unlink only validated top-level candidates, and report exact deleted/preserved/failed paths without swallowing non-`ENOENT` errors.
- [x] 2.4 Run the focused cleaner suite and confirm dry-run/tree-hash tests remain byte-identical while schema-valid known state is still removed and accounted.

## 3. Lock migration planning, scoping, and disposal with failing tests

- [x] 3.1 In `test/core/work-migration.test.ts`, compare deterministic serialized action arrays from preview and apply for files, directories, and `--discard-absorbed-conclusions`, proving apply outcomes never rewrite a planned `leave` into `discard`.
- [x] 3.2 Add scoped-mode fixtures containing active/archived `foo`, unrelated `bar`, global probes, and global design-docs; assert `--change foo` plans only proven `foo` work and leaves every unrelated byte unchanged while unscoped planning retains the global phases.
- [x] 3.3 Strengthen archived run-state tests to assert the source disappears only after successful apply, discarded counters reflect actual unlink success, an injected unlink error reports failed, and a successful second plan is empty.
- [x] 3.4 Add scan-error tests for work, probe, and design-doc directories proving `ENOENT` is a no-op while `EACCES`, `EPERM`, and `EIO` create plan blockers and prevent all apply actions.

## 4. Extract immutable migration plan and truthful outcomes

- [x] 4.1 In `src/core/work-migration.ts`, introduce explicit `WorkMigrationPlan`, ordered action, precondition/blocker, and apply-outcome types; keep action/classification independent of execute mode and preserve existing reporting through a compatibility projection.
- [x] 4.2 Extract deterministic planning that completes discovery, routing, option interpretation, and visible-conflict observations before mutation; make `--discard-absorbed-conclusions` produce a discard action during this phase.
- [x] 4.3 Replace catch-all filesystem discovery helpers with `ENOENT`-only absence handling and typed operation/path/code blockers; refuse apply when the plan is incomplete.
- [x] 4.4 Gate global probe and design-doc planning on unscoped mode, using only exact active/archive ownership matches for `changeName` and no name/content heuristic for global state.
- [x] 4.5 Implement apply as a consumer of the immutable plan, recording moved, discarded, conflict, already-absent, failed, and incomplete outcomes separately; count archived state discarded only after successful non-recursive removal.

## 5. Lock no-clobber publication and fallback with failing tests

- [x] 5.1 Add file-publication tests for a pre-existing destination and a destination created between plan and apply, asserting both copies and exact bytes survive and the outcome is conflict on Windows, macOS, and Linux semantics.
- [x] 5.2 Add directory-publication tests for a destination directory created after planning and a child entry created during recursive copy, asserting no merge/overwrite occurs, the source tree remains complete, and any migration-owned partial destination is reported.
- [x] 5.3 Inject `EXDEV`, `EACCES`, `EPERM`, and `EIO` at the primary publish seam and assert only the explicit cross-device case enters fallback; permission/I/O failures retain the source and report the original error.
- [x] 5.4 Inject copy failure, verification mismatch, and source-removal failure after a successful copy; assert no outcome says moved, discarded counters do not change, and every surviving/partial path is reported for recovery.

## 6. Implement exclusive file and directory moves

- [x] 6.1 Add a narrow dependency-injected filesystem adapter in `src/core/work-migration.ts` so race/error paths are deterministic in tests without changing production defaults.
- [x] 6.2 Implement file publication with atomic exclusive destination creation, cross-device-only copy fallback, content/identity verification, and source removal last; never route `EACCES`, `EPERM`, or `EIO` through fallback.
- [x] 6.3 Implement directory publication with exclusive destination reservation and exclusive recursive child creation, verify the completed tree before source removal, and track only current-action creations for conservative partial cleanup/reporting.
- [x] 6.4 Replace all migration file/directory move sites with the shared primitives and remove check-then-rename/copy code paths so evidence, handoff, run-state, probes, and design-docs share the same no-clobber result contract.

## 7. Cross-platform verification

- [x] 7.1 Add `path.win32` and `path.posix` routing/containment cases for drive letters, separators, date-prefixed archive matching, case-sensitive POSIX names, and case-insensitive Windows conflict assumptions; build all expected paths with `path.join`/`path.resolve`.
- [x] 7.2 Record the completed local combined focused-suite check: `pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts` passed 74/74 tests, including `path.win32` and `path.posix` semantic coverage.
- [x] 7.3 Run affected integration tests plus `pnpm lint` and `pnpm build`, then run the full test suite and record any unrelated pre-existing hang separately rather than treating it as a pass.
- [x] 7.4 Run `rasen validate file-placement-hardening-migration-safety --json` and confirm the change remains apply-ready with no implementation edits outside this child's cleaner/migration-safety ownership.
