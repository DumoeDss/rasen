# Windows legacy lock contention implementation evidence

## Scope and baseline

- Child implementation baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`.
- Product/test delta against that baseline is exactly:
  - `src/core/file-state.ts`
  - `test/core/file-state.test.ts`
- `test/core/pipeline-library.test.ts`, `src/core/pipeline-library.ts`, and `src/core/workflow-package/transaction.ts` are unchanged by this child.
- The production diff adds only the bounded Windows-transient branch to legacy `acquireFileLock`. Constants, `EEXIST` stale handling, release behavior, error factories, non-Windows classification, and the owner-aware lock implementation are unchanged.
- No portfolio or run-state command was run by the implementer. No custom runner was created or used, and no manual process-termination command was issued.

## Native Windows deterministic regression

Command:

```powershell
$env:VITEST_MAX_WORKERS='1'; pnpm exec vitest run test/core/file-state.test.ts --testNamePattern "Windows transient open handling|non-transient open error" --reporter=verbose
```

Result: exit `0`; 1 file passed; 5 tests passed; 24 unselected tests skipped; Vitest duration 2.43 s (shell 4.3 s).

- `EPERM`, `EACCES`, and `EBUSY` each executed on native Windows, injected once at the exact legacy `open(lockPath, 'wx')` seam, then acquired and released successfully.
- The persistent `EPERM` case made two matching open attempts and used deterministic `Date.now()` values to reach the existing deadline; it returned the injected factory's `timeout` result in 34 ms rather than waiting five real seconds.
- `ENOSPC` remained an immediate `create-failed` result.
- Filesystem and clock replacements are restored in `finally`; acquired handles are released and residual lock paths are removed in `finally`.

## Complete file-state regression

Command:

```powershell
$env:VITEST_MAX_WORKERS='1'; pnpm exec vitest run test/core/file-state.test.ts --reporter=verbose
```

Result: exit `0`; 1 file passed; 27 tests passed; 2 existing POSIX-only permission tests skipped on Windows; Vitest duration 9.48 s (shell 11.1 s). The owner-aware lock tests remained green without implementation changes.

## Unchanged same-name pipeline concurrency contract

Target command, run with one worker and no retry flag:

```powershell
$env:VITEST_MAX_WORKERS='1'; pnpm exec vitest run test/core/pipeline-library.test.ts --testNamePattern "serializes two concurrent imports of the same pipeline name" --reporter=dot --silent
```

Result: 10 completed invocations passed; each invocation reported 1 target test passed and 22 unselected tests skipped. The unchanged assertion therefore proved one complete winner, one `pipeline_already_exists` loser, and no mixed content on every completed invocation.

The first shell attempted ten sequential direct Vitest invocations but its outer 60-second tool timeout fired after iteration 8 had already printed a complete passing summary (shell exit `124`). No ninth-iteration start marker was emitted. Two subsequent independent direct Vitest invocations completed iterations 9 and 10 with exit `0` (Vitest 5.76 s and 5.39 s). The transport timeout is not counted as a test pass; only the ten complete per-invocation summaries are counted.

## Static checks and build

| Check | Result |
| --- | --- |
| `pnpm exec eslint src/core/file-state.ts test/core/file-state.test.ts` | exit 0; shell 15.5 s |
| `pnpm exec tsc --noEmit` | exit 0; shell 11.4 s |
| `pnpm run build` | exit 0; build completed successfully; shell 11.3 s |
| `pnpm exec rasen validate file-placement-hardening-windows-lock-contention --strict` | exit 0; change valid; shell 2.3 s |
| `git diff --check -- src/core/file-state.ts test/core/file-state.test.ts` | exit 0; only checkout-policy LF/CRLF warnings |

## CI discovery

`.github/workflows/ci.yml` has three `windows-latest` matrix shards. Each shard sets `VITEST_FILE_PARTITION` and runs `pnpm test`. Direct discovery with `pnpm exec vitest list test/core/file-state.test.ts --filesOnly` under `1/3`, `2/3`, and `3/3` showed the file exactly once, in Windows shard `3/3`. The native full-file command above proves the Windows-only tests execute locally.

An actual remote CI job URL/result is not yet available because this worktree has not been committed, pushed, or opened as a PR. Task 3.5 remains open until delivery produces that remote evidence.

## Independent review

The independent implementation review returned **CLEAN — 0 Blockers, 0 Majors, 0 Minors**. It found the production delta limited to the ten-line legacy-lock branch, confirmed the required platform/error boundaries and test isolation, and independently reran the five-test native Windows selection with exit `0`. The full findings are preserved in `evidence/review-report.md`.

## Closure partition 4 after the fix

After the CLEAN review, closure explicitly authorized the locked direct protocol:

```powershell
$env:VITEST_MAX_WORKERS='1'; $env:VITEST_FILE_PARTITION='4/8'; pnpm exec vitest run --reporter=json --outputFile=rasen/changes/file-placement-hardening-windows-lock-contention/evidence/partition-4-after-fix-vitest.json --silent
```

Result: shell exit `0` in 177.4 s. The 222,444-byte raw report parses as JSON with `success=true` and reconciles exactly:

- files: 43 total, 43 passed;
- suites: 168 total = 168 passed + 0 failed + 0 pending + 0 runtime-error;
- tests: 641 total = 637 passed + 0 failed + 4 pending + 0 todo;
- assertion results: 641 total = 637 passed + 4 skipped;
- every file status is `passed`, with zero failed suites/tests and zero runtime-error suites.

The parent independently parsed the raw JSON and confirmed the same result. The final P4 report is `evidence/partition-4-after-fix-vitest.json` (SHA-256 `6BC2A4917DF61AACDFBFA147E444D62FDDB59EA5BB82050D03F1607640ADF6A5`). The original closure failure remains preserved and unchanged at `../file-placement-hardening-closure/evidence/direct-partition-4-vitest.json` (SHA-256 `E517528F88F6835BBD9631BC52968FB7D2472E7985E35571E14589334EEF396F`).

Tasks 3.4 and 4.3 are complete and the successful final P4 result has been handed back to closure. Task 3.5 remains open because a remote CI job URL/result does not yet exist.
