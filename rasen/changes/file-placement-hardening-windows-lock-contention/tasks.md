## 1. Add deterministic legacy-lock regressions

- [x] 1.1 Add Windows-only parameterized coverage under the legacy `acquireFileLock` tests that injects one `EPERM`, `EACCES`, or `EBUSY` for the exact `wx` lock open and proves each case subsequently acquires and releases cleanly.
- [x] 1.2 Add a Windows-only persistent-transient case with deterministic time control that proves the existing deadline returns the caller's `timeout` error without waiting five real seconds.
- [x] 1.3 Add or retain focused coverage proving a non-transient open error still reaches `create-failed`, and confirm the existing non-Windows create-failure test remains unchanged.
- [x] 1.4 Restore every mocked filesystem/time function and release or remove every temporary lock in `finally`, so the new regressions cannot leak state into another test.

## 2. Correct the bounded Windows contention branch

- [x] 2.1 Update only legacy `acquireFileLock` to reuse `isTransientWindowsLockOpenError` before its non-`EEXIST` create-failed branch.
- [x] 2.2 For a matching Windows transient, preserve the existing deadline and poll interval: return the caller's existing timeout error at the deadline, otherwise sleep and retry the open.
- [x] 2.3 Audit the implementation diff to confirm non-Windows and other-error paths, constants, stale-age behavior, error factories, release behavior, and owner-aware locking are unchanged.

## 3. Verify the original failure and platform contract

- [x] 3.1 Run the focused legacy file-state regression on native Windows and confirm all three transient codes execute rather than skip, with the persistent case returning the existing timeout classification.
- [x] 3.2 Run the complete `test/core/file-state.test.ts` file and record its final file/test counts, skips, exit status, and summary.
- [x] 3.3 Run the unchanged concurrent same-name test in `test/core/pipeline-library.test.ts` repeatedly with one worker, proving one complete winner, one `pipeline_already_exists` loser, and no mixed content.
- [x] 3.4 Rerun closure partition 4 with `VITEST_MAX_WORKERS=1` and `VITEST_FILE_PARTITION=4/8`, writing a new JSON report under this child change rather than overwriting the original closure failure artifact.
- [ ] 3.5 Confirm the existing native Windows CI test leg discovers and executes the new Windows-only regression, and record its actual job URL/result at delivery without changing CI configuration unless discovery is demonstrably absent.

## 4. Close the narrow child with evidence

- [x] 4.1 Run build, typecheck/lint, and strict Rasen validation appropriate to the two-file implementation and record exact commands and results.
- [x] 4.2 Diff against the saved baseline and confirm implementation changes are limited to `src/core/file-state.ts` and `test/core/file-state.test.ts`, with no pipeline contract, owner-aware migration, portfolio, run-state, or unrelated closure edits.
- [x] 4.3 Publish the deterministic regression, focused pipeline, P4, scope, and compatibility results in child evidence and hand the successful P4 result back to closure for its aggregate gate.
