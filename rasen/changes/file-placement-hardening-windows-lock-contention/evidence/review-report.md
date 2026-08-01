# Independent review report

Date: 2026-07-31

## Verdict

**CLEAN — 0 Blockers, 0 Majors, 0 Minors.**

The implementation matches the child proposal, design, tasks, and `opsx-pipeline-registry` delta requirement. Review was limited to the product/test delta in `src/core/file-state.ts` and `test/core/file-state.test.ts`; no product or test edits were made.

## Standards review

No findings.

- The production delta is ten lines in legacy `acquireFileLock` only (`src/core/file-state.ts:137-146`). It reuses the existing classifier rather than duplicating platform/error lists.
- The classifier remains explicit and conservative (`src/core/file-state.ts:261-266`): it returns false off Windows and recognizes only `EPERM`, `EACCES`, and `EBUSY` on Windows.
- The existing deadline and poll constants remain unchanged at `src/core/file-state.ts:65-66`. A classified transient checks the already-computed deadline, returns the caller's existing `timeout` error at/after it, otherwise sleeps for the existing poll interval and retries (`:130`, `:140-145`). Other non-`EEXIST` errors still immediately use the existing `create-failed` factory (`:147-148`).
- The `EEXIST` stale-lock path, release behavior, error factories, and owner-aware implementation are byte-unchanged by the production diff.

## Spec review

No findings.

- One-shot Windows contention for each required errno retries and then acquires through the unchanged legacy transaction.
- Persistent Windows contention remains bounded and maps to the existing timeout classification.
- Non-Windows behavior is preserved by the classifier's platform guard; unrelated errno values retain immediate create-failed behavior.
- No pipeline transaction, overwrite/error contract, owner-aware migration, public API, constant, dependency, portfolio, run-state, or delivery behavior was added.

## Test authenticity and isolation

No findings.

- The Windows group is genuinely platform-gated with `describe.skipIf(process.platform !== 'win32')` (`test/core/file-state.test.ts:40`, `:103`). On this native Windows review host all five selected cases executed rather than skipping.
- The parameterized regression injects each of `EPERM`, `EACCES`, and `EBUSY` only for the exact target path and `wx` open, then delegates the second call to the real `fs.promises.open`, verifies exactly two matching opens, observes the real lock file, and releases it (`:104-134`).
- The persistent case controls `Date.now()` deterministically, requires two matching open attempts, and reaches the existing timeout path without a real five-second delay (`:137-164`).
- The platform-independent `ENOSPC` case proves an unrelated open errno still performs one attempt and returns create-failed (`:167-190`). The pre-existing POSIX permission test remains unchanged.
- Every open replacement, clock spy, acquired handle, and residual lock path is restored or released in `finally`; matching is path- and flag-specific, so unrelated file operations are delegated to the original function.

## Scope verification

Diffing the recorded baseline `04cea87ae5bea9af2d90f526455b6ea513cd57e8` across the allowed implementation surfaces reports only:

```text
src/core/file-state.ts       10 insertions
test/core/file-state.test.ts 91 insertions, 1 import-line replacement
```

The same baseline check reports no changes in `src/core/pipeline-library.ts`, `test/core/pipeline-library.test.ts`, or `src/core/workflow-package/transaction.ts`. The only test-file replacement is adding `vi` to the existing Vitest import; all behavioral additions are the scoped legacy-lock regressions.

## Independent verification

Executed only the safe low-level selection; no P4, timeout harness, or process-termination action was run:

```powershell
$env:VITEST_MAX_WORKERS='1'; pnpm exec vitest run test/core/file-state.test.ts --testNamePattern "Windows transient open handling|non-transient open error" --reporter=verbose
```

Result: exit `0`; 1 file passed; 5 tests passed; 24 unselected tests skipped; all three Windows errno cases executed.

## Remaining gates

Tasks 3.4, 3.5, and 4.3 remain explicitly open: closure P4 was not rerun, and no remote Windows CI URL/result exists before delivery. Those held gates are truthfully recorded in `implementation-and-verification.md` and are not implementation-review findings. This CLEAN verdict authorizes neither process termination nor an aggregate/P4 success claim.
