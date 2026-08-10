# Portfolio Integration Report: archive-and-validate-defects

- Verdict: **INCONCLUSIVE — the unsharded run and all three Windows-shaped shards timed out**
- `fix-store-finalization-admission` task 7.3 evidence: **insufficient; do not mark complete**
- Verification role: fresh integration verifier; no product, test, task, run-state, commit, push, or archive mutation
- Verification date: 2026-08-10 (Asia/Shanghai)

## Integrated tree admission

- Branch worktree: `E:\wt\rasen-archive-follow-up`
- HEAD: `911942afc4239f04de9d241b34600a7c9e3252cd`
- HEAD tree: `afc84ca6806e9913f783b9cdcaee043abee8722c`
- Five child product commits recorded in their ship logs:
  - spec reconciliation: `e82149fe441742b17e88499db7af573d8a69e2a3`
  - project registry alias safety: `43c7e88fb2cacb584754bfbee7bdedf28114131d`
  - workspace claim portability: `bf6bdbb77fbe23acdc2f6e8868286c5162bf37c6`
  - archive recovery ownership: `c09a1dcbe2553a3831ab117f41e0a3326d2c9cec`
  - Store finalization admission: `cedfa82d3905e1aa63527121db6ce828e35ead82`
- All five child review-cycle reports were read and record a final independent `CLEAN` verdict with `0 Blocker / 0 Major / 0 Minor / 0 Trivial`.
- Pre-gate status contained only the permitted untracked `.rasen/**` state and `rasen/changes/archive-and-validate-defects/planning-context.md`.
- Post-gate checks found no tracked worktree diff, no staged diff, and no product/test status delta. The tested product tree therefore matched HEAD.

## Local environment

- Execution class: local native Windows; **not** GitHub Actions or post-push CI
- OS: Microsoft Windows 11 Pro, version `10.0.26200`, build `26200`
- Platform/architecture: `win32` / `x64`
- PowerShell: `5.1.26100.8875`
- Node.js: `v24.14.0`
- pnpm: `9.15.9`
- Full-gate worker configuration: `VITEST_MAX_WORKERS=2`

The repository CI uses Node `20.19.0` for Windows jobs and partitions the Windows general suite into three shards. The initial local run used the installed Node 24 runtime and intentionally did not partition the suite. A follow-up then used the CI partition variables and worker count, but remained a local Node 24 execution with a 25-minute diagnostic bound rather than a GitHub Actions job.

## Gate results

### 1. Build

- Command: `pnpm run build`
- Started: `2026-08-10T09:22:07.1813760+08:00`
- Ended: `2026-08-10T09:22:31.7778820+08:00`
- Duration: `24.597 s`
- Exit code: `0`
- Result: **PASS** — TypeScript compilation and project build completed successfully.

### 2. Full integration suite

- Command: `$env:VITEST_MAX_WORKERS='2'; pnpm test`
- Partitioning: none
- Tool-observed wall time: `2704.1 s` (45 minutes, 4.1 seconds)
- Runner exit code: `124`
- Result: **INCONCLUSIVE — infrastructure/runtime timeout**
- Test-file count: unavailable; Vitest did not emit a final summary before the runner timeout
- Test count: unavailable
- Passed/failed/skipped counts: unavailable
- Assertion failures observed: none were returned before termination, but absence of a returned failure is not evidence of a pass

The runner reached its 45-minute hard limit without returning the Vitest final summary. The tool timeout left the worktree's `vitest`/`tinypool`/`esbuild` subprocess tree alive; the verifier checked the exact command lines and terminated only those residual test PIDs. No source or test file was changed. The timeout is attributable to an incomplete local full-suite execution, not to a proven product assertion failure or to any specific child change.

### 2a. Windows-shaped three-shard follow-up

The unsharded suite was not repeated. The follow-up ran the three CI partitions once each, in order, with `VITEST_MAX_WORKERS=2` and a 25-minute per-shard local bound. A timed-out shard did not prevent the independent later shards from running.

| Partition | Manifest files | Command environment | Tool-observed wall time | Exit | Final Vitest counts | Failed file |
|---|---:|---|---:|---:|---|---|
| `1/3` | 143 | `VITEST_MAX_WORKERS=2`, `VITEST_FILE_PARTITION=1/3` | `1515 s` | `124` | unavailable; no final summary | none reported |
| `2/3` | 142 | `VITEST_MAX_WORKERS=2`, `VITEST_FILE_PARTITION=2/3` | `1504 s` | `124` | unavailable; no final summary | none reported |
| `3/3` | 142 | `VITEST_MAX_WORKERS=2`, `VITEST_FILE_PARTITION=3/3` | `1504 s` | `124` | unavailable; no final summary | none reported |

Result: **all three shards INCONCLUSIVE due to local runner timeout**. Each command lost its buffered progress when the command runner enforced the timeout, so no test-file/test/pass/fail/skip totals or last-active test file can be recovered honestly. No shard returned an assertion failure. Post-timeout process checks found no surviving Vitest/tinypool process for these three shard runs.

The deterministic manifest resolver assigned `143 + 142 + 142 = 427` paths. A read-only resolver check found 427 total assignments, 427 unique test files, and zero overlap. The partition definitions therefore cover the complete manifest structurally, but the executions did not complete those manifests. Structural coverage is not an executed green full suite.

### 2b. Shard-1 bounded diagnostics

Read-only manifest inspection showed that shard `1/3` disproportionately contains subprocess/CLI-heavy files whose current runtime is not represented by `KNOWN_SLOW_TEST_WEIGHTS_MS`. The strongest initial suspect was `test/core/management-api/store-finalize-api.test.ts`, which contains real HTTP/child-process coverage and three intentional hung-child cases.

- Command: `$env:VITEST_MAX_WORKERS='1'; $env:VITEST_FILE_PARTITION='1/3'; pnpm exec vitest run test/core/management-api/store-finalize-api.test.ts -t 'times out the .* phase and releases the cap-one gate' --reporter=verbose`
- Started: `2026-08-10T11:29:03.0291796+08:00`
- Ended: `2026-08-10T11:30:04.7926966+08:00`
- Result: **PASS** — 1 file passed; 3 tests passed; 33 skipped; exit 0; command duration `61.764 s`.
- Per-case durations: inspect `14.377 s`, save `11.821 s`, apply `10.300 s`.

That result excludes the smallest hung-child subset as a product failure, but does not make the full file or shard green.

The first unweighted Store-v2 journey diagnostic was then run with the same shard and one-worker environment:

- File: `test/commands/store-v2-cross-project-journey.test.ts`
- Started: `2026-08-10T11:30:38.5203556+08:00`
- Ended: `2026-08-10T11:33:31.8290715+08:00`
- Result: **PASS** — 1 file passed; 6 tests passed; exit 0.
- Command duration: `173.309 s`; Vitest duration `170.78 s`, including `156.26 s` in tests.

This first journey file was already an abnormal runtime for a source-size-fallback weight, so diagnosis stopped as prescribed rather than running the remaining four journey files. The evidence supports stale/insufficient partition weighting as a plausible runtime cause. It does not prove a hang, a product assertion failure, or a complete explanation for the independent `2/3` and `3/3` timeouts.

### 3. Cross-child focused selection

The planned cross-child contract selection was not run because the verification contract permits it only after a green full suite. The shard-1 commands above were narrow timeout diagnostics, not a substitute cross-child gate and not evidence that completes `fix-store-finalization-admission` task 7.3.

## CI and platform evidence boundary

- Local native Windows build: passed.
- Local native Windows unpartitioned full suite: inconclusive due to the 45-minute timeout.
- Local native Windows three-shard strategy: all three shards inconclusive due to their 25-minute local bounds; no final counts were emitted.
- GitHub Windows jobs: not executed by this verifier; no post-push CI pass is claimed.
- GitHub Linux/macOS or any other native POSIX jobs: not executed; no POSIX pass is claimed.
- Child-local focused and review evidence remains useful, but it does not substitute for this missing portfolio full-suite result or the outstanding native CI requirements recorded by the children.

## Task disposition

`fix-store-finalization-admission` task 7.3 does **not** have sufficient evidence and remains unchecked. The combined tree builds, is review-clean at each child boundary, and remained clean during verification, but neither the required unpartitioned portfolio suite nor any of the three Windows-shaped shards completed or produced exact final counts.

This is distinct from parent `archive-and-validate-defects` task 7.3, which is an already-completed workflow-template task. The parent's relevant outstanding cross-platform item is task 8.7, which requires a recorded passing repository Windows CI job. These local runs are not GitHub CI and do not satisfy parent task 8.7.

## Durable findings

1. The five-child combined HEAD is admitted as a clean, reproducible product tree and passes the local build gate.
2. A native Windows unsharded suite with two workers did not finish within 45 minutes, and all three Windows-shaped partitions independently exceeded 25 minutes without a Vitest summary. None may be represented as green or as a test failure with a fabricated child attribution.
3. The manifest partitioner is complete and disjoint (`143/142/142`, 427 unique files), but its timing model is stale for at least one unweighted Store-v2 journey: a single passing six-test file took 173.309 seconds locally.
4. The selected Store-finalization hung-child cases passed 3/3, so current evidence favors runner duration/weight imbalance over a demonstrated assertion failure; it remains insufficient to identify a single root cause for all three shards.
5. Focused child suites and mocked platform cases cannot close the portfolio full-suite gate or native post-push Windows/POSIX CI tasks.
