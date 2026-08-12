# Portfolio Integration Report: archive-and-validate-defects

> **Current terminal status (2026-08-10): PASS.** GitHub Actions run `31355525652` completed successfully at exact head `21e9c0a75a36f0845dcf4771f53759e9fceb519d`; see “Post-fix native CI gate” below. The `INCONCLUSIVE` verdict and task dispositions immediately below are preserved historical results from the earlier local attempts, not the final delivery state.

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

## Merged-tree focused overlap gate

### Scope and tree admission

- Verdict for this gate: **PASS**
- Verification role: independent verifier; not the merge or evidence-commit author
- Merged HEAD: `7135149c2382300fcaf1a879e327d89c3ab1e94d`
- Merged tree: `6e82665da14d53df13411fd565dca9e3157b857f`
- Merge parents: `8950cf3e88ae27aaec37aed43509edd3dd36a268` and `3576334019bf64d196088aee28a78a9b6c16ccf6`
- Merge subject: `Merge remote-tracking branch 'origin/dev/0.1.7' into fix/archive-transaction-recovery-follow-up`
- Pre-gate tracked worktree and index: clean
- Pre-gate untracked state: `.rasen/**` only
- Post-gate tracked product/test worktree and index: clean
- `VITEST_FILE_PARTITION`: explicitly cleared and confirmed unset for the focused run

The merge diff was inspected against both parents. Against the first parent it contains the base workspace apply/module/journey integration and associated artifacts (19 files, 5,452 insertions, 13 deletions). Against the second parent it contains the portfolio product/test/evidence side (121 files, 27,999 insertions, 1,865 deletions). No uncommitted product or test delta was admitted to the gate.

### Build

- Command: `pnpm run build`
- Started: `2026-08-10T11:39:39.2537980+08:00`
- Ended: `2026-08-10T11:40:00.6242374+08:00`
- Duration: `21.370 s`
- Exit code: `0`
- Result: **PASS**

### Merged-overlap focused suite

- Environment: `VITEST_MAX_WORKERS=2`; `VITEST_FILE_PARTITION` unset
- Command: `pnpm exec vitest run test/core/store/workspace-apply.test.ts test/core/store/workspace-atomic-write.test.ts test/commands/store-v2-workspace-journey.test.ts test/core/store/finalization-association.test.ts test/core/store-planning/finalize-scope.test.ts test/core/store/workspace-windows-paths.test.ts test/core/store/workspace-identity.test.ts --reporter=dot`
- Started: `2026-08-10T11:40:12.4018268+08:00`
- Ended: `2026-08-10T11:44:54.4036930+08:00`
- Command duration: `282.002 s`
- Vitest duration: `279.89 s`
- Result: **PASS** — 7 test files passed; 135 tests passed; 0 failed; 0 skipped; exit 0.

This selection exercises the merge boundary between the base branch's workspace apply/module/journey work and the portfolio's atomic persistence, Store finalization association/admission, planning scope, Windows path handling, and workspace identity contracts. The merged tree passed that focused overlap boundary without an isolated failure or retry.

### Evidence boundary and task disposition

This is a merged-tree focused gate only. It does not replace the repository full suite, the GitHub Actions test matrix, native POSIX evidence, or a recorded passing GitHub Windows job. The earlier unsharded and three-shard timeout history remains valid and is not converted to green by this focused result.

- `fix-store-finalization-admission` task 7.3 remains unchecked because the full portfolio test gate did not complete.
- Parent `archive-and-validate-defects` task 8.7 remains unchecked because no passing GitHub Windows CI job was recorded.

## Historical failed native CI run

- Verdict: **FAIL** — diagnostic evidence superseded by the later exact-head pass
- GitHub Actions run: [31353647221](https://github.com/DumoeDss/rasen/actions/runs/31353647221)
- Exact tested head: `446a224f4820c5963bc304737575d46f0de4beb4`
- Failure class: real test assertion/fixture-baseline failures, not an infrastructure timeout

| Platform job | Failures | Evidence-backed attribution |
|---|---:|---|
| [Windows shard 2](https://github.com/DumoeDss/rasen/actions/runs/31353647221/job/93349060030) | 5 | Five archive-finalization failures |
| [Linux Node 20](https://github.com/DumoeDss/rasen/actions/runs/31353647221/job/93349060001) | 7 | Five archive-finalization failures plus two workspace-atomic failures |
| [Linux Node 24](https://github.com/DumoeDss/rasen/actions/runs/31353647221/job/93349060015) | 7 | The same five archive-finalization failures plus two workspace-atomic failures |
| [macOS](https://github.com/DumoeDss/rasen/actions/runs/31353647221/job/93349060029) | 7 | Five archive-finalization failures plus two combined cross-platform assertions involving workspace/platform behavior and registry path identity |

This native CI result is distinct from the earlier local unsharded and three-shard timeout history: those local gates timed out, while run `31353647221` completed with observable assertion and fixture-baseline failures. The branch test-baseline fix commit `21e9c0a7` closed these failures, and the next run, [31355525652](https://github.com/DumoeDss/rasen/actions/runs/31355525652), passed completely.

## Post-fix native CI gate

### Terminal admission

- Verdict: **PASS**
- GitHub Actions run: [31355525652](https://github.com/DumoeDss/rasen/actions/runs/31355525652)
- Exact tested head: `21e9c0a75a36f0845dcf4771f53759e9fceb519d`
- PR aggregate: [All checks passed](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93356944247) — success
- Platform boundary: GitHub-hosted `windows-latest` PowerShell shards, `ubuntu-latest` Linux jobs, and `macos-latest` POSIX jobs. Linux ran both the Node 20.19 matrix floor and Node 24 compatibility job; the Windows and macOS general jobs used Node 20.19.

The test-fix head completed the repository's native CI matrix without a failed required check. The earlier local unsharded/sharded timeouts and failed CI run `31353647221` remain valid historical diagnostic evidence, but they are not the terminal delivery state and must not be read as contradicting or replacing this later exact-head success.

### General test matrix

| Platform job | Manifest files | Passed | Skipped | Failed | Result |
|---|---:|---:|---:|---:|---|
| [Linux Node 20](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366687) | 427 | 7,480 | 40 | 0 | PASS |
| [Linux Node 24](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366664) | 427 | 7,480 | 40 | 0 | PASS |
| [macOS Node 20](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366783) | 427 | 7,479 | 41 | 0 | PASS |
| [Windows shard 1](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366692), [shard 2](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366688), [shard 3](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366683) | `143 + 142 + 142 = 427` | 7,473 | 47 | 0 | PASS |

The three successful Windows shards executed the complete disjoint 427-file manifest, including the path-sensitive reconciliation, archive/finalization, project-registry, workspace persistence, and Store-finalization regressions distributed across the partitions.

### Native recovery and quality gates

| Gate | Passed | Skipped | Result |
|---|---:|---:|---|
| [Windows file-placement recovery](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366597) | 186 | 9 | PASS |
| [Linux file-placement recovery](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366624) | 182 | 13 | PASS |
| [macOS file-placement recovery](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366673) | 182 | 13 | PASS |
| [Lint and type check](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366607) | — | — | PASS |
| [UI package build and tests](https://github.com/DumoeDss/rasen/actions/runs/31355525652/job/93354366609) | 510 | 0 | PASS |

### Final task disposition

This exact-head native evidence closes parent task 8.7, `fix-spec-reconciliation-integrity` task 4.3, `fix-workspace-claim-portability` task 4.3, and `fix-store-finalization-admission` tasks 7.1 through 7.4. The earlier focused merged-tree build and 7-file/135-test overlap gate remain complementary local evidence; the terminal GitHub matrix supplies the previously missing full-suite and native Windows/POSIX boundary.
