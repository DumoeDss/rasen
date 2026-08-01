## Context

Closure partition 4 reproduced a single failure in the existing concurrent same-name pipeline import test. The loser rejected after 93 ms with `WorkflowTransactionError: Cannot create workflow registry lock...` instead of waiting for the winner and then returning `pipeline_already_exists`. The relevant implementation and test files are byte-unchanged from the `ace53693331998ff67050967b63fb710a0f11245` baseline, so this is an existing Windows contention defect discovered by the stronger closure gate rather than a file-placement regression.

`importPipelinePackage` stages both packages and enters `commitWorkflowInstall`, which acquires `.workflows.lock`; its dependent install then acquires `.pipelines.lock`. Both use the shared legacy `acquireFileLock`. That primitive retries `EEXIST`, but maps every other open error immediately to `create-failed`. Windows can report a sharing window during another holder's close, delete, or rename as `EPERM`, `EACCES`, or `EBUSY`. The owner-aware lock in the same module already recognizes exactly those codes as bounded Windows transients, while the legacy primitive does not.

## Goals / Non-Goals

**Goals:**

- Make legacy lock acquisition retry Windows `EPERM`, `EACCES`, and `EBUSY` within its existing deadline and poll interval.
- Preserve the existing timeout error factory path when a Windows transient persists to the deadline.
- Preserve immediate create-failed behavior for other error codes and on non-Windows platforms.
- Lock the behavior down with deterministic Windows-only regression coverage and prove the original pipeline concurrency and P4 scenarios pass.

**Non-Goals:**

- Changing pipeline package staging, transaction ordering, error codes, overwrite semantics, or the existing same-name concurrency test contract.
- Migrating legacy callers to the owner-aware lock or changing owner-aware acquisition/release behavior.
- Changing stale-lock age, deadline, poll interval, registry error wording, dependencies, portfolio state, run-state, or delivery state.
- Broad full-suite diagnosis beyond rerunning the closure P4 command that exposed this defect.

## Decisions

### 1. Reuse the existing Windows transient classifier in the legacy primitive

In the legacy `acquireFileLock` catch branch, keep `EEXIST` on its current stale-lock/contention path. Before mapping another error to `create-failed`, call the existing `isTransientWindowsLockOpenError`. Its explicit set is `EPERM`, `EACCES`, and `EBUSY`, and it returns false on every non-Windows platform.

When it returns true, compare against the already-computed legacy deadline. At or beyond the deadline, call the caller's existing `errorFor('timeout', { lockPath })`; otherwise sleep for the existing `LOCK_POLL_MS` and continue the acquisition loop. Function declaration hoisting permits the legacy function to reuse the existing classifier without moving or duplicating it.

This keeps platform detection and the transient-code list in one explicit helper. It also preserves each registry's current diagnostic factory instead of introducing a new pipeline-specific error mapping.

Alternatives considered:

- Handling the error in `importPipelinePackage` would fix only one consumer, duplicate lock semantics, and leave `.workflows.lock` and other legacy callers inconsistent.
- Treating these errors as `EEXIST` and entering stale-lock inspection would add unnecessary stat/removal behavior; a bounded sleep/retry is sufficient for an open sharing window.

### 2. Do not migrate this path to owner-aware locking

Owner-aware locks carry tokens, use PID liveness, and have different stale-claim and release semantics. Migrating `.workflows.lock` and `.pipelines.lock` would expand the change into a multi-consumer protocol migration unrelated to the observed failure. This change borrows only the already-reviewed Windows transient classifier while preserving all legacy lock behavior, constants, and file format.

### 3. Use deterministic injected Windows regressions at the lock seam

Under the existing `acquireFileLock` test group, add Windows-only coverage that temporarily replaces `fs.promises.open` for one exact lock path and `wx` call, restores it in `finally`, and injects each of `EPERM`, `EACCES`, and `EBUSY`. Each one-shot transient must be followed by successful acquisition and clean release.

Add a bounded-deadline case for a persistent injected transient, controlling time deterministically so it asserts the existing `timeout` factory path without a real five-second wait. Keep an ordinary non-transient injected error assertion to show create-failed behavior remains unchanged. No production test hook or exported configuration is introduced.

The existing pipeline concurrency test remains untouched because it already exercises the correct product seam: exactly one winner, one `pipeline_already_exists` loser, and complete winner bytes. After the lock regression is green, run that focused test repeatedly enough to exercise its concurrent path, then rerun closure P4 using its recorded one-worker partition command.

### 4. Keep verification evidence explicit and narrow

Record the exact regression, focused pipeline, and P4 commands with elapsed time, test/file counts, skips, exit codes, and final summaries. P4 must produce a successful JSON report; a retry flag or a later isolated pass cannot overwrite or conceal a failing attempt. No claim is made about partitions outside P4 or remote CI by this child.

## Risks / Trade-offs

- **A true Windows permission problem may use `EACCES`.** → The existing directory-write preflight still rejects the common permission case immediately; an open-time Windows `EACCES` is retried only to the existing five-second bound, then becomes the registry's established busy/timeout result as required.
- **Mocking `fs.promises.open` can leak across tests.** → Match one exact lock path and flags, restore the original function in `finally`, release any acquired handle, and run the test only on Windows.
- **Fake time can accidentally bypass the retry assertion.** → Assert that the injected open path was reached and that one-shot cases perform a later real open; keep the persistent case limited to the timeout mapping.
- **An isolated pipeline rerun may pass despite the original timing sensitivity.** → Pair the deterministic low-level regression with the unchanged high-level concurrency test and the original one-worker P4 command.

## Migration Plan

1. Add the legacy-lock Windows transient branch and deterministic lock-seam regressions.
2. Run the focused legacy file-state tests, then the unchanged concurrent same-name pipeline import test.
3. Rerun the recorded closure partition 4 command and attach its successful JSON summary to this child's evidence/handoff.
4. Hand the clean result back to closure so its complete-suite aggregate can continue.

Rollback reverts the legacy branch and its tests together. No data migration, lock-file format transition, or pipeline contract rollback is required.

## Open Questions

None.
