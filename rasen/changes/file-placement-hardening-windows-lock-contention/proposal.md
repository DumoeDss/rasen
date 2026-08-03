## Why

The closure complete-suite gate exposed a pre-existing Windows race in the `ace5369` baseline: two concurrent same-name pipeline imports can turn a transient lock-file sharing error into an immediate registry-create failure instead of waiting for the winning import and returning the semantic already-exists result. The pipeline contract and transaction remain correct, but the shared legacy lock primitive does not yet apply the bounded Windows retry behavior already used by the owner-aware lock.

## What Changes

- Treat Windows `EPERM`, `EACCES`, and `EBUSY` results from opening a legacy lock as transient contention, retrying only within the existing lock deadline and returning the existing timeout diagnostic when that deadline expires.
- Preserve immediate create-failed behavior for other errors and for all non-Windows platforms.
- Add a deterministic Windows-only legacy-lock regression that injects a transient sharing violation and proves acquisition succeeds after retry.
- Re-run the focused concurrent same-name pipeline import test and closure partition 4 to prove the original failure is resolved without changing the pipeline transaction or its error contract.
- Keep owner-aware lock migration, pipeline-library behavior changes, timeout constants, and unrelated full-suite work outside this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opsx-pipeline-registry`: Concurrent pipeline imports on Windows wait through bounded transient lock-file sharing errors and then report the same semantic winner/loser outcome as other platforms.

## Impact

- `src/core/file-state.ts`: the existing legacy `acquireFileLock` non-`EEXIST` error branch only.
- `test/core/file-state.test.ts`: deterministic Windows-only transient-open regression.
- Verification only in `test/core/pipeline-library.test.ts` and closure partition 4; neither file's product contract is changed by this proposal.
- No dependency, public API, pipeline package, owner-aware locking, portfolio, run-state, or delivery changes.
