# Review Cycle: codex-luna-thread-dispatch

## Round 1 — fixer record

- Date: 2026-08-04T01:53:24+08:00
- Stage: review-loop, round 1
- Author: fresh Codex fixer leaf `/root/fix_codex_luna_thread_r1`
- Authoritative input: `evidence/review-report.md` (2 Blockers, 1 Major)
- Disposition: all three findings have implementation and regression coverage; **independent non-author re-review is still required**. This fixer does not certify the round clean.

| Finding | Severity | Fix | Fixer disposition | Non-author confirmation |
|---|---|---|---|---|
| Real Codex rejects leaf/evaluate output schemas | Blocker | Every declared property is now required; optional contract fields are required-but-nullable at the provider boundary and null sentinels are removed before the existing strict Zod results. The fake Codex fixture now rejects schemas that omit declared fields from `required` or fail to make optional fields nullable. Both contracts have focused schema/normalization tests. | Implemented and focused-tested | Pending fresh reviewer |
| Assembled prompt is unbounded and early stdin EOF can crash | Blocker | The shared agent process boundary now exports assembled-payload validation plus an observed, bounded stdin writer. `runCodexExec()` validates the prompt plus flat guard before spawn, binds resume ownership before prompt release, awaits stdin completion/error before classifying child close, maps early EOF/EPIPE to one `spawn-failed` receipt, and initiates full-tree teardown. The exact raw-2-MiB regression, an early-closed-stdin child with a descendant, scratch cleanup, and fresh-failure metadata are covered. | Implemented and focused-tested | Pending fresh reviewer |
| Resume fabricates sandbox from the ignored request | Major | Fresh thread state now persists a versioned creation-time sandbox beside the exact thread/cwd record as soon as the thread id is observed, including turns that later fail. Resume claims retrieve that value for receipts. Cwd-only legacy records remain resumable but omit `sandbox` rather than copying the ignored request. Mismatched-request and legacy compatibility cases are covered. | Implemented and focused-tested | Pending fresh reviewer |

### Exact verification

Required scope: strict provider schemas and normalization, shared bounded stdin and early-close teardown, durable exact-thread state, Codex CLI receipts, and Claude bridge compatibility. This scope targets every path named in the three authoritative findings without reopening unrelated configuration or orchestration design.

- `pnpm exec vitest run test/core/codex/contracts.test.ts test/core/agent-cli-process.test.ts test/core/codex/runner.test.ts test/core/codex/thread-state.test.ts test/cli-e2e/agent-dispatch-codex.test.ts` — PASS, 5 files / 47 tests.
- `pnpm exec vitest run test/cli-e2e/agent-dispatch-codex.test.ts test/cli-e2e/agent-dispatch.test.ts test/core/claude/runner.test.ts` — PASS, 3 files / 55 tests. This includes 18 Codex CLI cases, 16 Claude CLI cases, and 21 Claude runner cases.
- `pnpm exec vitest run test/core/codex/runner.test.ts` after changing the pre-spawn case to the exact raw 2 MiB reproducer — PASS, 1 file / 3 tests.
- `pnpm build` — PASS after implementation and PASS again after persisting fresh failure metadata.
- `pnpm lint` — exit 0; one pre-existing unrelated warning remains at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- `git diff --check` — PASS (only the repository's existing LF-to-CRLF conversion notices).
- `node bin/rasen.js validate codex-luna-thread-dispatch --strict --json` — PASS, 1 change / 0 failures.
- Exact reviewer reproduction (`runCodexExec` with `process.execPath` and a 2,097,152-byte raw prompt) — returned one `invalid-input` receipt: assembled stdin was 2,097,337 bytes against the 2,097,152-byte limit; no uncaught EOF and no spawn.
- Optional real `gpt-5.6-luna` / `max` probe — the provider accepted the new schema and emitted a conforming structured agent item with nullable `handoffReason`; the former immediate `invalid_json_schema` 400 did not recur. The intentionally bounded 120-second run later timed out because the README prompt caused repository exploration, so this is schema-acceptance evidence, **not** a completed task-6.4 smoke or a successful bridge completion claim. Thread id: `019fc8bb-ff98-7330-ad7f-e01380eae3c4`.

Git evidence target:

- HEAD: `a1306828a23b2c4adc0db81f92b09498a5e92710`
- `git rev-parse HEAD^{tree}`: `0272860dd820c4db0fcb021332ac8d3399340f0c`
- Verification ran against the live uncommitted round-1 delta on branch `feat/codex-luna-thread-dispatch`; the HEAD tree hash is recorded as required but does not by itself encode uncommitted changes.

### Remaining / bookkeeping

- All three authoritative findings await independent delta re-review; no finding is marked reviewer-confirmed here.
- Tasks 6.2, 6.3, and 6.4 remain unchecked. The fixer did not rerun the monolithic full suite, did not produce external Windows CI evidence, and did not complete the full real-Luna fresh/resume/concurrency/Terra smoke matrix.
- No unrelated redesign or model allow-list was introduced. Generic Luna/Terra/custom model forwarding, exact-thread ownership, cross-platform `.cmd` preparation, and the single JSON receipt boundary remain intact in focused evidence.
- Final audit found no process associated with this worktree, fake Codex fixture, or real-smoke thread. Three verified `rasen-codex-*` scratch directories left by intentional bridge-parent-death probes (one from the prior review and two from this fixer's E2E reruns) were removed from the system temp directory; they were ephemeral and are not recoverable.

## Round 1 - independent non-author re-review

- Date: 2026-08-04 (Asia/Shanghai)
- Reviewer: fresh independent leaf `/root/review_codex_luna_thread_r1`
- Mode: dispatched, report-only; no production code or tests edited
- Verdict: **PASS - round clean.** The original 2 Blockers and 1 Major are reviewer-confirmed resolved; no new Blocker/Major regression was found.

| Original finding | Reviewer confirmation | Evidence |
|---|---|---|
| Provider rejects leaf/evaluate schemas | Resolved | Both schemas require every declared property and encode optional values as nullable; strict normalization tests pass. Real Luna leaf and evaluate bridge calls both completed successfully. |
| Assembled prompt unbounded; early stdin EOF crashes | Resolved | Exact raw-2-MiB reproduction returned one pre-spawn `invalid-input` receipt (`2097337 > 2097152`) with empty scratch. Focused early-close fixture proved one `spawn-failed` receipt plus root/descendant teardown. |
| Resume fabricates sandbox | Resolved | Live resume of a read-only thread with a workspace-write request reported read-only plus the ignored-request warning. Focused tests also confirm persisted fresh failure metadata and legacy cwd-only omission. |

### Independent verification

- `pnpm lint` - PASS; only the known unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- `pnpm build` - PASS; this fresh build was used for every live bridge call.
- Focused high-risk Vitest selection - **22 files / 771 tests passed** in 65.00 s.
- `git diff --check origin/dev/0.2.0` - PASS, with line-ending conversion notices only.
- Real built-bridge matrix - PASS:
  - Luna/max fresh leaf: thread `019fc8d1-9556-7fd3-90dd-85d7fda44c1d`.
  - Exact-thread second-process Luna resume: same thread, creation sandbox preserved.
  - Concurrent Luna/max leaf pair: distinct threads `019fc8d2-3e3c-7c92-b928-d95df5ed2106` and `019fc8d2-3ecc-74d2-893d-5e9a34703c6f`.
  - Terra/high leaf: thread `019fc8d2-bd00-7b30-afc3-46c88faa1d27`.
  - Luna/max evaluate: thread `019fc8d2-bcf7-7e02-86e8-946e0520f3a5`, satisfied with no gaps.
- Dedicated prompts are under `.rasen/changes/codex-luna-thread-dispatch/ephemera/`; neither asks the model to explore or modify the repository.
- Cleanup audit found no worktree/fake-Codex process. The one scratch directory intentionally stranded by the parent-death E2E case was verified and removed.

### Evidence boundaries / bookkeeping

- The monolithic full suite was not rerun in this round; task 6.2 remains unchecked and no full-suite pass is claimed.
- No external Windows CI evidence was obtained; task 6.3 remains unchecked.
- The entire required optional live smoke matrix succeeded; task 6.4 is checked.

## Round 1 - monolithic full-suite attempt

- Command: exact `pnpm test` (`vitest run`) from the feature worktree.
- Bound: hard 30-minute tool/process cap.
- Result: **FAIL**, exit 1 after 1,558.5 seconds (~25m58.5s), before the cap.
- Failed surface: 5 tests in 2 files. The command output transport truncated the complete aggregate summary, so no total-file/total-test count is fabricated.
- Task disposition: **6.2 remains unchecked** because the monolithic gate did not pass.

### Actionable failures

1. `test/commands/config-editor.test.ts:142` - Japanese localization case expected the outside-project warning containing `Rasenプロジェクト外のため`; only the `Rasen設定` heading was logged.
2. `test/commands/config-editor.test.ts:163` - Simplified Chinese localization case expected the outside-project warning containing `不在 Rasen 项目中`; only the `Rasen 配置` heading was logged.
3. `test/commands/config-editor.test.ts:205` - `project-only keys are disabled outside a Rasen project` found `archive.timing.disabled` undefined instead of truthy.
4. `test/commands/config-editor.test.ts:329` - the outside-project both-scope fallback expected two `select()` calls but observed three, indicating an unexpected scope prompt.
5. `test/commands/config.test.ts:639` - project-scope operations outside a Rasen project set exit code 1 but did not emit the expected console error.

All five failures share an outside-project detection/scope symptom. Neither failed test file is changed by this branch, but this run alone does not prove the failures are pre-existing or unrelated; they require separate triage before task 6.2 can close.

### Completion and cleanup audit

- The test command exited on its own before the cap; no forced termination was used.
- No `pnpm test`/Vitest process associated with this worktree remained after exit (`processCount=0`).
- The previously observed `test-pipeline-command-tmp` leftover was absent.
- No other expansive verification command was run in this continuation.

## Round 2 - full-suite scope fixer record

- Date: 2026-08-04T03:01:16+08:00
- Stage: review-loop, round 2
- Author: fresh Codex fixer leaf `/root/fix_full_suite_scope_r2`
- Scope: diagnose and correct the five outside-project failures left by the round-1 monolithic run; **independent non-author re-review is still required**.

### Diagnosis

The failures were test/machine-state leakage, not a production behavior regression introduced by this branch and not cross-file ordering from the new effort/config tests.

- The prescribed isolated run of `test/commands/config-editor.test.ts` and `test/commands/config.test.ts` reproduced exactly 5 failures / 82 passes. Running only `project-only keys are disabled outside a Rasen project` also failed (1 failed / 18 skipped), ruling out new-test order, worker sharing, and prior-case cleanup as prerequisites.
- The nominally empty sandbox was under `C:\Users\Sayo\AppData\Local\Temp`. The unchanged nearest-ancestor detector therefore walked up to `C:\Users\Sayo\AppData\Local`, where an ambient legacy machine-data directory named `rasen` exists (`C:\Users\Sayo\AppData\Local\rasen`, containing `local-harness`). The test's claim that an `os.tmpdir()` child was necessarily outside every Rasen root was false on this machine.
- `git diff --exit-code origin/dev/0.2.0 -- src/core/planning-home.ts test/commands/config-editor.test.ts test/commands/config.test.ts` reported `IDENTICAL_TO_BASELINE` before the fix. The baseline has the same bare-`rasen/` nearest-ancestor contract and the same temp placement, so no temporary baseline worktree was needed.
- Static inspection covered every branch-changed production path and all untracked new tests/fixtures. No added production or test line mutates `process.cwd()`, ambient env, or global config without local isolation/cleanup. The new config-adjacent files run in Vitest's per-file forks and pass before, after, and alongside the legacy files.

### Fix

Added `test/helpers/outside-project-temp.ts`, which creates a writable temporary directory only under a candidate base whose entire canonical ancestor chain lacks a `rasen/` workspace marker. The outside-project portions of `config-editor.test.ts` and `config.test.ts` now use that helper; their real inside-project setup still creates `temp/project/rasen/config.yaml` and exercises the unchanged production detector.

This is test isolation only: no production path changed, no legacy assertion was weakened, and project-scope validation remains fully exercised.

### Exact verification

Required scope: the five original failures, the full two legacy config files, all new effort/config-resolution tests in suspicious order, concurrent aggregate execution, lint, and build. This covers the observed ancestor-state risk plus the branch's only config-adjacent additions without claiming a new monolithic pass.

- Initial reproduction: `pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts` - expected pre-fix FAIL, 2 files / 5 failed / 82 passed.
- Independent single-case reproduction: `pnpm exec vitest run test/commands/config-editor.test.ts -t "project-only keys are disabled outside"` - expected pre-fix FAIL, 1 failed / 18 skipped.
- Post-fix legacy surface: `pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts` - PASS, 2 files / 87 tests. Repeated after the new config tests - PASS again, 2 files / 87 tests.
- New config surface first: `pnpm exec vitest run test/core/config-keys.test.ts test/core/effective-config.test.ts test/core/pipeline-registry/effort-resolution.test.ts` - PASS, 3 files / 114 tests.
- Suspicious combined order: `pnpm exec vitest run test/core/pipeline-registry/effort-resolution.test.ts test/core/effective-config.test.ts test/core/config-keys.test.ts test/commands/config.test.ts test/commands/config-editor.test.ts` - PASS, 5 files / 201 tests.
- Final exact five-case reproduction after the last helper cleanup hardening: `pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts -t "localizes config groups and descriptions in Japanese|localizes config groups and descriptions in Simplified Chinese|project-only keys are disabled outside|does not prompt for scope for a both-scope key outside|fails --scope project operations outside"` - PASS, 5 selected / 82 skipped.
- `pnpm lint` - PASS (exit 0); only the known unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139` remains.
- `pnpm build` - PASS after the final test-helper delta.
- `git diff --check` - PASS; line-ending conversion notices only.
- `node bin/rasen.js validate codex-luna-thread-dispatch --strict --json` - PASS, 1 change / 0 failures.

Git evidence target:

- HEAD: `a1306828a23b2c4adc0db81f92b09498a5e92710`
- `git rev-parse 'HEAD^{tree}'`: `0272860dd820c4db0fcb021332ac8d3399340f0c`
- Verification ran against the live uncommitted round-1 plus round-2 delta; the HEAD tree hash is required evidence but does not encode uncommitted files.

### Remaining / cleanup

- Task 6.2 remains unchecked: no complete monolithic suite has passed after this fix. The next reviewer decides whether to rerun it.
- The round-2 isolation delta awaits independent non-author diff review/confirmation; this fixer does not certify the round clean.
- No Node/pnpm/cmd process associated with this worktree or `fake-codex` remained. Current-run config/Codex temp prefixes were absent after verification. The one exact diagnostic directory accidentally stranded while proving import-time behavior (`C:\Users\Sayo\AppData\Local\Temp\diag-config-root-11sMq9`) was verified under the system temp root and removed; it is not recoverable. Three `rasen-config-scope-test-*` directories dated July 28-31 predated this run and were left untouched as unrelated user state.

## Round 2 - independent non-author re-review

- Date: 2026-08-04T03:36:40+08:00
- Reviewer: fresh independent leaf `/root/review_full_suite_scope_r2`
- Mode: dispatched, report-only; no production code or tests edited
- Verdict: **ROUND-2 FIX PASS / OVERALL BLOCKED.** The five outside-project failures are independently confirmed to be an ambient ancestor-marker collision and the isolation helper is acceptable. The required monolithic gate still has one unrelated aggregate-load timeout, so one canonical Blocker remains open and task 6.2 stays unchecked.

### Independent diagnosis and delta audit

- An old-style temp child under `C:\Users\Sayo\AppData\Local\Temp` was independently passed to the unchanged built `findRepoPlanningRootSync()` and resolved to `C:\Users\Sayo\AppData\Local`.
- `C:\Users\Sayo\AppData\Local\rasen` exists and contains `local-harness`. Production `src/core/planning-home.ts:45-65` intentionally walks to the filesystem root and accepts any ancestor with a `rasen/` directory. This exactly explains all five round-1 outside-project symptoms without a branch production regression.
- `test/helpers/outside-project-temp.ts:5-64` uses Node native path/filesystem APIs, canonicalizes candidates, checks the full ancestor chain, tries a fixed four-candidate set, bounds every walk at the root, rechecks after creation, and cleans a rejected partial candidate. No shell quoting, POSIX separator, random unbounded retry, or broad cleanup is involved.
- `test/commands/config-editor.test.ts:64,86-103` and `test/commands/config.test.ts:455-485` restore cwd and remove only the exact returned tree. Both still create a real nested `rasen/config.yaml` marker for inside-project behavior; the outside cases use the marker-free parent. No detector, mock, or assertion was weakened, so nearest-ancestor regressions remain observable.
- Scope decision: acceptable in this feature PR. The required feature gate exposed a baseline test-isolation assumption; the fix is test-only, shared by the two affected legacy suites, and avoids changing production workspace semantics to accommodate one machine's legacy data directory.

### Exact verification

- Exact original five cases after the fix:
  - `pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts -t "localizes config groups and descriptions in Japanese|localizes config groups and descriptions in Simplified Chinese|project-only keys are disabled outside|does not prompt for scope for a both-scope key outside|fails --scope project operations outside"`
  - **PASS: 2 files / 5 selected / 82 skipped**, duration 15.52 s.
- Legacy config aggregate:
  - `pnpm exec vitest run test/commands/config-editor.test.ts test/commands/config.test.ts`
  - **PASS: 2 files / 87 tests**, duration 47.58 s.
- Mixed config/effort aggregate:
  - `pnpm exec vitest run test/core/pipeline-registry/effort-resolution.test.ts test/core/effective-config.test.ts test/core/config-keys.test.ts test/commands/config.test.ts test/commands/config-editor.test.ts`
  - **PASS: 5 files / 201 tests**, duration 44.03 s.
- Exact monolithic gate, run once with a hard 35-minute cap:
  - `pnpm test`
  - **FAIL: exit 1 after 1,393.4 s (~23m13s), before the cap.** The five config failures did not recur. `test/commands/pipeline.test.ts:155` timed out at its 60-second per-case limit in the English localized-human-presentation case, then `afterEach` reported `EBUSY` removing `test-pipeline-command-tmp`. The output transport truncated the complete aggregate counts, so none are fabricated.
- Exact failed case in isolation:
  - `pnpm exec vitest run test/commands/pipeline.test.ts -t "localizes representative 'en' paths across all ten subcommands"`
  - **PASS: 1 selected / 98 skipped**, 28.758 s test time, 37.78 s command duration. This narrows the remaining failure to aggregate-load timeout/cleanup contention; it does not turn the red monolithic gate into a pass.
- Lint/build were not rerun by this reviewer: the fixer already recorded both passing after the final test-only delta, and no production or test code changed afterward.

### Remaining / cleanup

- Open canonical Blocker: make the localized pipeline subprocess aggregate reliable under full-suite load, then obtain one complete exact `pnpm test` pass. Task 6.2 remains unchecked.
- Task 6.3 remains unchecked for actual Windows CI. The local Windows isolation audit does not substitute for CI.
- No live Luna/Terra matrix was rerun because no code affecting it changed after round 1.
- Final audit found no process associated with this worktree. `test-pipeline-command-tmp` was absent after the failed full run and isolated reproduction. The exact `C:\Users\Sayo\AppData\Local\Temp\rasen-codex-EawciL` scratch directory stranded by the full-suite parent-death fixture was inspected and removed; no round-2 helper-prefix directory remained.

## Round 3 - pipeline aggregate-timeout fixer record

- Date: 2026-08-04T04:06:45+08:00
- Stage: review-loop, round 3
- Author: fresh Codex fixer leaf `/root/fix_pipeline_timeout_r3`
- Authoritative input: the remaining monolithic-gate Blocker at `test/commands/pipeline.test.ts:155`; **independent non-author re-review and a later complete monolithic pass are still required**.

### Diagnosis

The failure was a too-narrow cumulative case budget plus a teardown race after Vitest timed out the case, not a functional pipeline regression or a material cost added by effort resolution.

- The English case launches sixteen separate built CLI processes in series and asserts every result. Its 60-second timeout covered their cumulative Windows startup, configuration, and filesystem time; each individual `runCLI` invocation already retained its own 30-second hang bound.
- A clean `origin/dev/0.2.0` archive was built inside this worktree and ran the exact English case twice in 24.245 seconds and 28.233 seconds. The branch ran it twice in 25.226 seconds and 26.088 seconds (and the round-2 reviewer measured 28.758 seconds). The two-run averages were 26.239 seconds for baseline and 25.657 seconds for the branch. The branch's effort-layer reads therefore did not materially increase this case's work.
- A focused four-worker load run paired the full pipeline file with `artifact-workflow`, `store-identity-cli`, and `workset`: 4 files / 253 tests passed in 467.88 seconds. The English case stretched to 43.482 seconds, Japanese to 40.060 seconds, and Simplified Chinese to 43.024 seconds. That is about 70% slower than the branch's isolated English average even in a passing focused load; the prior monolithic run supplied the observed >60-second tail.
- The branch-focused 22-file aggregate, including every new Codex runner/lifecycle test and the new effort/config-resolution tests, passed 771 tests in 54.90 seconds after the fix. Together with the earlier mixed config/effort aggregate and static cleanup audit, this found no cross-file state leakage or surviving branch-created worker. The extra files add ordinary parallel process/CPU pressure, not a leaked global or unreaped process prerequisite.
- When Vitest times out an async case it does not cancel the callback's in-flight `runCLI` promise. The old `afterEach` immediately removed `test-pipeline-command-tmp` while that CLI still used it as cwd, explaining the secondary Windows `EBUSY`. The suite-level `terminateActiveCliChildren()` also initiated `taskkill` without awaiting the child's `close` event.

### Fix

- Raised only the sixteen-process localized-human case budget from 60 seconds to the repository's established 120-second journey budget. This preserves every exit-code and localized-output assertion and does not hide a stuck command: every `runCLI` call remains independently capped at 30 seconds.
- Made `terminateActiveCliChildren()` await the exact active child `close`/spawn-error lifecycle after tree termination, with a bounded 10-second wait that surfaces a genuinely unreaped child.
- The pipeline test now awaits that reaper before deleting the child's cwd, and global Vitest teardown awaits the same contract. No production command, effort resolver, assertion, or generic filesystem error handling was weakened.

### Exact verification

Required scope: baseline/branch timing, representative four-worker CLI contention, intentional timeout teardown, the exact failed case, the complete pipeline file, all branch-specific high-risk tests, lint, and build. This covers both halves of the failure: legitimate cumulative runtime and the child-cwd cleanup race.

- Baseline exact case, clean `origin/dev/0.2.0`: PASS twice, 24.245 seconds and 28.233 seconds test time.
- Branch exact case before the fix: PASS twice, 25.226 seconds and 26.088 seconds test time.
- Pre-fix four-worker CLI-heavy aggregate: `pnpm exec vitest run test/commands/pipeline.test.ts test/commands/artifact-workflow.test.ts test/commands/store-identity-cli.test.ts test/commands/workset.test.ts --maxWorkers=4 --reporter=verbose` - PASS, 4 files / 253 tests, 467.88 seconds; localized cases 43.482 / 40.060 / 43.024 seconds.
- Post-fix exact English case: PASS, 1 selected / 98 skipped, 24.872 seconds test time (32.74 seconds total).
- Forced-timeout lifecycle probe: temporarily set the same case to 1 second, then ran it once. Expected FAIL contained only the 1-second timeout; no `EBUSY` occurred, the exact temp cwd was absent after exit, and related process count was zero. The committed working value was restored to 120 seconds before all green gates.
- Full pipeline file: `pnpm exec vitest run test/commands/pipeline.test.ts --reporter=verbose` - PASS, 1 file / 99 tests, 376.59 seconds. Localized cases were 25.526 / 27.172 / 24.698 seconds.
- Branch-focused high-risk aggregate (the 22 files listed in `evidence/review-report.md`): PASS, 22 files / 771 tests, 54.90 seconds.
- `pnpm lint` - PASS, exit 0; only the pre-existing unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139` remains.
- `pnpm run build` - PASS after the final lifecycle/test delta.
- `git diff --check` - PASS; line-ending conversion notices only.

Git evidence target:

- HEAD: `a1306828a23b2c4adc0db81f92b09498a5e92710`
- `git rev-parse 'HEAD^{tree}'`: `0272860dd820c4db0fcb021332ac8d3399340f0c`
- Verification ran against the live uncommitted round-1 through round-3 delta; the HEAD tree hash is recorded as required but does not encode uncommitted files.

### Remaining / bookkeeping

- Task 6.2 remains unchecked exactly as required. This fixer did not run another 20-plus-minute monolithic suite; a later complete exact `pnpm test` pass is still the closure gate.
- The round-3 delta awaits independent non-author review. This fixer does not self-certify the Blocker resolved or the review cycle clean.
- Task 6.3 remains unchecked because no external Windows CI evidence was obtained. Task 6.4 remains checked from the independently reviewed real Luna/Terra matrix.
- Final cleanup removed the verified temporary baseline archive/build, the exact `rasen-codex-7MCuTJ` parent-death scratch directory after inspecting its two fixture files, and this fixer's run-owned test-config/model-home directories. These were ephemeral and are not recoverable. No matching recent temp directory, pipeline temp cwd, or Node/pnpm/cmd/fake-agent process remained.

## Round 3 - independent non-author re-review

- Date: 2026-08-04 (Asia/Shanghai)
- Reviewer: fresh independent leaf `/root/review_pipeline_timeout_r3`
- Mode: dispatched, report-only; no production code or tests edited
- Verdict: **PASS - round clean and overall review clean.** The final aggregate-timeout Blocker is reviewer-confirmed resolved, the sole exact monolithic gate passes, and no open Blocker or Major remains.

### Independent delta audit

- The 120-second value is scoped only to `localizes representative $locale paths across all ten subcommands`, the cumulative case that launches sixteen sequential CLIs. Every assertion remains. `runCLI` retains its independent default 30-second timeout for every spawned CLI; no generic case or child timeout was raised.
- A fresh clean `origin/dev/0.2.0` archive passed the exact English case in 26.173 seconds. The branch passed the same one-worker command in 22.076 seconds. This independently corroborates the fixer's two-run baseline/branch averages and rules out a material feature-branch timing regression.
- `terminateActiveCliChildren()` snapshots only exact `ChildProcess` objects registered by `runCLI`; it performs no PID/system scan. Windows termination remains exact-PID tree kill with `windowsHide`, while POSIX targets the detached child's process group.
- The close/error/timeout paths share one cleanup routine that clears the deadline and removes both one-shot listeners before settling. The wait is bounded at 10 seconds per active child and all active children are awaited concurrently. Pipeline `afterEach` awaits it before deleting the cwd; global teardown awaits it before removing global temp roots.
- A targeted probe reaped the tracked active CLI in 737 ms while an unrelated sentinel process remained alive. The tracked promise settled and a second empty reap returned in 0 ms.
- Static and dynamic cross-platform checks found no shell prompt/path interpolation or broad process enumeration in the round-3 delta. Real PR Windows CI remains unverified and is still task 6.3.

### Exact verification

- `pnpm run build` - PASS, exit 0, 13.8 seconds.
- `pnpm lint` - PASS, exit 0, 17.8 seconds; only the known unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- Branch exact English case - PASS, 1 selected / 98 skipped, 22.076 seconds test time.
- Clean-baseline exact English case - PASS, 1 selected / 98 skipped, 26.173 seconds test time.
- Targeted active-child/unrelated-sentinel cleanup probe - PASS; tracked child reaped, unrelated sentinel alive, no duplicate/lingering reap.
- Complete pipeline file - PASS, 1 file / 99 tests, 350.34 seconds; localized cases 24.385 / 25.328 / 24.187 seconds.
- Sole exact `pnpm test`, hard-capped at 40 minutes - **PASS**, exit 0 after 1,236.8 seconds (~20m36.8s). The output transport truncated the final aggregate-count lines, so no totals are fabricated.
- Live Luna/Terra dispatch - intentionally not rerun because no related production code changed after its clean round-1 verification.

### Bookkeeping and cleanup

- Task 6.2 is checked after the clean lint/build/full-suite gate.
- Task 6.3 remains unchecked for real PR CI.
- Task 6.4 remains checked from the prior independently verified real Luna/Terra matrix.
- Post-run audit found no process associated with this worktree and no `test-pipeline-command-tmp`. The fresh baseline archive was removed. One inspected parent-death `rasen-codex-*` scratch directory and thirty-three current-run `rasen-test-config-*` directories were removed by exact validated paths; these ephemeral files are not recoverable.

## Ship repair - Windows local-runtime exit-code mismatch

- Date: 2026-08-04T06:14:27+08:00
- Stage: ship repair after GitHub Actions run `30854609588`, attempts 1 and 2
- Author: Codex fixer leaf `/root/fix_windows_local_runtime_ci`
- Disposition: the reproducible Windows shard failure is fixed locally with focused cross-layout coverage. This fixer does not claim external CI closure; task 6.3 remains unchecked until a fresh GitHub Actions run passes.

### Diagnosis

- Both CI attempts used Windows x64, Node 20.19.0 from `actions/setup-node@v4`, and pnpm 9.15.9 installed by `pnpm/action-setup@v4` under `PNPM_HOME`. Both attempts failed only `test/scripts/local-version-runtime.test.ts:248`: 141/142 files and 2,411/2,422 tests passed, with the diagnostic's `COMMAND_FAILED` code and `build` phase correct but `exitCode` equal to 1 instead of 7.
- The Node 20.19.0 Windows distribution includes Corepack 0.31.0 at the exact path preferred by `commandInvocation('pnpm')`, so CI took the bundled-Corepack branch and bypassed the action-installed pnpm 9.15.9 command on `PATH`.
- The fixture intentionally has a build script but no `packageManager`. `pnpmIdentity()` records the outer `npm_config_user_agent` version without probing pnpm, while the later bundled-Corepack invocation independently resolves an unpinned package manager from the fixture cwd. An exact local reproduction using the official Node 20.19.0 Windows distribution, an isolated Corepack home, and the CI user-agent reproduced the same `COMMAND_FAILED` / `build` / exit-1 diagnostic. The raw child probe showed Corepack selecting the current pnpm and failing in its loader with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` before `node -e "process.exit(7)"` ran. The `1` was therefore a Corepack bootstrap failure, not legitimate normalization of the fixture's lifecycle exit code.
- Direct probes of the action-style pnpm 9.15.9 `.CMD` shim and Node's `cmd.exe /d /s /c pnpm` fallback both preserved the inner exit code 7. Historical comparison also found commit `7baa8f3b` had intentionally removed the Corepack preference to "resolve pnpm from the active environment"; the current `origin/dev/0.2.0` tree had reintroduced the earlier branch during subsequent history.

### Fix

- `scripts/local-version/local-runtime.mjs` again routes Windows pnpm through `cmd.exe /d /s /c pnpm`, using the active environment selected by setup tooling. npm's adjacent-to-Node resolution and every non-Windows command path are unchanged.
- `test/scripts/local-version-runtime.test.ts` now constructs isolated copied-Node layouts with a fake bundled Corepack entry both present and absent. In both layouts the active pnpm must run, the fake Corepack must remain untouched, and the build diagnostic must preserve exit code 7. The existing full integration test continues to assert the same stable diagnostic contract.

### Exact verification

Required scope: the exact CI assertion, both Windows command-resolution layouts, the complete local-version harness surface, the official CI Node/Corepack layout, lint, build, syntax/diff checks, and strict change validation. This covers the observed process-selection risk without changing Codex dispatch behavior or weakening diagnostics.

- Pre-fix exact official-runtime reproduction: official Node 20.19.0 + Corepack 0.31.0 + isolated Corepack home + CI pnpm user-agent - expected FAIL with `COMMAND_FAILED`, phase `build`, received exit 1 instead of 7.
- Post-fix focused cases: `pnpm exec vitest run test/scripts/local-version-runtime.test.ts -t "preserves a failed build exit code|reports a failed source build with stable command diagnostics" --reporter=verbose` - PASS, 3 selected / 6 skipped.
- Post-fix exact official-runtime reproduction: official Node 20.19.0 running the exact failed test with the CI user-agent and a fresh isolated Corepack home - PASS, 1 selected / 8 skipped; the action-installed pnpm path preserved exit 7.
- Complete file: `pnpm exec vitest run test/scripts/local-version-runtime.test.ts --reporter=verbose` - PASS, 1 file / 9 tests.
- `pnpm run build` - PASS, exit 0.
- `pnpm lint` - PASS, exit 0; only the existing unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139` remains.
- `node --check scripts/local-version/local-runtime.mjs` - PASS.
- `git diff --check` - PASS; line-ending conversion notices only.
- `node bin/rasen.js validate codex-luna-thread-dispatch --strict --json` - PASS, 1 change / 0 failures.

Git evidence target:

- HEAD: `1b58aa310f3a355afe8804de88a446038809b20a`
- `git rev-parse HEAD^{tree}`: `372afe139485679f39d3f238927c99275d5ac88f`
- Verification ran against the live uncommitted ship-repair delta; the HEAD tree hash does not encode the three modified tracked files.

### Remaining / cleanup

- Task 6.3 remains unchecked. Only a fresh successful external Windows CI run can close it; this fixer has not edited `tasks.md` or `evidence/ship-log.md`.
- No `pnpm test` monolithic rerun was performed because the two-line production selection change is bounded by the complete local-version file plus the exact official-runtime reproduction; the previously recorded committed-tree monolithic pass remains unchanged evidence for the rest of the branch.
- The downloaded official Node archive/layout, isolated Corepack homes, action-style pnpm probe, and diagnostic scripts were removed from the exact run-owned ephemera directory after verification. No matching recent `rasen-local-version-*` temp directory or worktree-associated Node/pnpm/cmd process remained.

## Ship repair - independent non-author re-review

- Date: 2026-08-04T06:35:19+08:00
- Reviewer: fresh independent leaf `/root/review_windows_local_runtime_ci`
- Mode: dispatched, report-only; no production code or tests edited
- Verdict: **PASS - repair delta clean.** The Windows CI cause and the repair are independently confirmed; no new Blocker or Major was found. Task 6.3 remains unchecked until this repair passes fresh external PR Windows CI.

### Independent cause confirmation

- GitHub run `30854609588` attempts 1 and 2 both installed pnpm 9.15.9 into `PNPM_HOME`, selected Windows x64 Node 20.19.0, and failed only `test/scripts/local-version-runtime.test.ts:248`: 141/142 files and 2,411/2,422 tests passed; the stable code/phase were correct and only exit 7 became exit 1.
- The independently downloaded official Node 20.19.0 Windows archive reported Corepack 0.31.0 at the removed adjacent path. A fresh no-`packageManager` fixture and isolated Corepack home caused that bundled entry to select pnpm 11.20.0, then fail with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`/exit 1 before the exit-7 build script ran.
- PATH pnpm ran the same space-containing fixture's build script and preserved exit 7. Commit `7baa8f3b` independently corroborates that active-environment selection was an intentional portability fix later lost in merge history.

### Delta audit

- `local-runtime.mjs:180-184,192-215` now uses `%ComSpec% /d /s /c pnpm`, preserves argv array construction, exact cwd, inherited PATH/PATHEXT, stderr, and child status. All pnpm callers pass only fixed tokens; path-bearing npm packing and non-Windows resolution are unchanged.
- An official-Node-20.19 full-harness probe with a fake `pnpm.cmd` in a PATH directory containing spaces recorded the exact source cwd plus `args=run build`, returned the stable `COMMAND_FAILED`/`build`/exit-7 receipt, and published no runtime.
- With an empty PATH the same harness retained cmd's actionable unavailable-command text, returned `COMMAND_FAILED`/`build`/exit 1, and published no runtime. The repair therefore fails closed instead of silently substituting bundled Corepack.
- The copied-node tests use space-containing exact roots, a fake adjacent Corepack sentinel, synchronous child completion, and exact-root `afterEach` cleanup. The Corepack-present fixture fails under the removed behavior and passes only when the active PATH command is used; the absent fixture verifies the ordinary fallback. No parent environment is mutated.

### Exact verification

- Host Node 24 exact failed case - PASS, 1 selected / 8 skipped.
- Host Node 24 copied-node layouts - PASS, 2 selected / 7 skipped.
- Official Node 20.19 exact failed case with CI user-agent - PASS, 1 selected / 8 skipped.
- Official Node 20.19 copied-node layouts - PASS, 2 selected / 7 skipped.
- Complete local-version file - PASS, 1 file / 9 tests.
- `pnpm lint` - PASS, exit 0; only the known unrelated warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- `pnpm run build` - PASS, exit 0.
- `node --check scripts/local-version/local-runtime.mjs` - PASS.
- `git diff --check` - PASS; line-ending conversion notices only.
- Strict change validation - PASS, 1 change / 0 failures.
- PR #134 Greptile query - zero comments.
- Medium-delta read-only external Codex challenge - timed out at five minutes without output; non-blocking per the review skill, with no leaf-agent fallback permitted.

### Evidence boundary and cleanup

- No fresh external CI run includes the live repair. Task 6.3 remains unchecked; neither `tasks.md` nor `evidence/ship-log.md` was edited.
- No monolithic rerun was needed for the bounded selection delta; the affected file, official runtime, PATH, unavailable-tool, lint/build, syntax, and strict-validation gates all pass.
- The review-owned official Node/Corepack probe directory was removed after these checks. No matching recent local-version temp root or worktree-associated Node/pnpm/cmd/Codex process remained.

## Ship repair successor - Windows local-runtime teardown cleanup

- Date: 2026-08-04T07:01:04+08:00
- Author: successor Codex fixer leaf `/root/fix_windows_cleanup_ci_successor`
- Scope: test-only teardown hardening for the transient Windows `ENOTEMPTY` in GitHub Actions run `30859461935`, Windows shard-2 job `91838021207`.
- Disposition: imported the existing `cleanupTempPath` helper with the repository's ESM `.js` convention and replaced only the local-version file's direct recursive `afterEach` removal. Production runtime, task 6.3, `ship-log.md`, `.rasen/`, and unrelated files were not modified.

### Delta and safety boundary

- `test/scripts/local-version-runtime.test.ts` still removes each exact value spliced from `temporaryRoots`; it now passes that same root directly to `cleanupTempPath(root)`.
- The reused helper remains unchanged and calls `fs.rmSync` on only the supplied target with `{ recursive: true, force: true, maxRetries: 15, retryDelay: 200 }`. The retry budget is bounded, and because the helper does not catch or suppress `rmSync` errors, a persistent cleanup failure still propagates.
- Required verification scope: repeatedly exercise the exact Corepack-absent copied-node fixture that failed in CI, then cover both copied-node layouts and the rest of the local-version file, followed sequentially by build, lint, strict validation, diff inspection, and residue audit. This directly covers the observed teardown race without reopening production command selection.

### Exact verification

- `pnpm exec vitest run test/scripts/local-version-runtime.test.ts -t "preserves a failed build exit code when bundled Corepack is absent" --reporter=dot`, repeated sequentially 8 times - PASS, 8/8 iterations; each iteration ran 1 selected test with 8 skipped.
- `pnpm exec vitest run test/scripts/local-version-runtime.test.ts --reporter=verbose` - PASS, 1 file / 9 tests, including both bundled-Corepack-present and bundled-Corepack-absent layouts.
- `pnpm run build` - PASS, exit 0.
- `pnpm lint` - PASS, exit 0; only the known unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139` remains.
- `node bin/rasen.js validate codex-luna-thread-dispatch --strict --json` - PASS, 1 change / 0 failures.
- `git diff --check` - PASS; line-ending conversion notices only.
- Final scoped diff before this evidence append: one test file, 3 insertions / 1 deletion; exactly the helper import and teardown call replacement.

Git evidence target:

- HEAD: `1c430a9223bd6ef31424e71fcce9b3e6ebe0e97a`
- `git rev-parse 'HEAD^{tree}'`: `defcc80477978f07578aef33e4f9a0b853fc2605`
- Verification ran against the live uncommitted test-only successor delta; the HEAD tree hash is recorded as required but does not encode that delta.

### Cleanup and evidence boundary

- Post-run process audit found zero processes whose command line referenced this worktree or a `rasen-local-version-*` root.
- The temp audit found zero `rasen-local-version-*` roots created or modified during this repair. One root, `C:\Users\Sayo\AppData\Local\Temp\rasen-local-version-9fyXAs`, predates this work (`2026-08-01`) and was preserved as unrelated rather than deleted.
- No fresh external CI run includes this successor delta. Task 6.3 remains unchecked, and this fixer does not claim external Windows CI closure.

## Ship repair successor - independent cleanup-delta re-review

- Date: 2026-08-04T07:07:24+08:00
- Reviewer: fresh independent leaf `/root/review_windows_local_runtime_ci`
- Mode: dispatched, report-only; no production code, tests, task state, or ship log edited
- Verdict: **PASS - cleanup delta clean.** No Blocker or Major was found. The retry is exact-root scoped and bounded, exhausted failure still propagates, the ESM import works in Vitest, and assertions plus protected files are unchanged.

### Independent CI and safety confirmation

- GitHub Actions run `30859461935` targets current HEAD `1c430a9223bd6ef31424e71fcce9b3e6ebe0e97a`. Windows shard-2 job `91838021207` failed only after the Corepack-absent fixture assertions completed, when the old direct `fs.rmSync` teardown raised `ENOTEMPTY`; 141 other test files passed.
- `makeTemporaryRoot()` stores the exact `mkdtempSync` return value. `afterEach` splices and forwards only those exact values; `cleanupTempPath` calls `fs.rmSync` only on its supplied target. No parent, glob, relative fallback, or unrelated directory enters the deletion path.
- The unchanged helper retains the prior `recursive: true, force: true` deletion semantics and adds only `maxRetries: 15, retryDelay: 200`. This is a finite retry budget. With no catch or fallback in the helper, a failure surviving that budget throws through the `afterEach` and fails Vitest.
- Only the helper import and teardown call changed in the test. Test bodies and expectations are untouched. The `.js` specifier matches the repository's NodeNext convention and was resolved by every focused and complete-file Vitest run.
- A protected-diff check was empty for `scripts/local-version/local-runtime.mjs`, `tasks.md`, and `evidence/ship-log.md`. Task 6.3 remains unchecked.

### Independent exact verification

- Exact CI-failing fixture repeated sequentially 5 times - PASS, 5/5; each run executed 1 selected test with 8 skipped.
- Complete `test/scripts/local-version-runtime.test.ts` - PASS, 1 file / 9 tests.
- `pnpm lint` - PASS, exit 0; only the known unrelated warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- Strict change validation - PASS, 1 change / 0 failures.
- `git diff --check` - PASS; line-ending conversion notices only.
- PR #134 Greptile re-query - zero review comments, issue comments, or reviews.

### Evidence boundary

- The failing remote run contains the committed production repair but predates this uncommitted test-only cleanup. Fresh external Windows CI is still required before task 6.3 can close.
- This review adds evidence only. It does not broaden deletion scope, hide an assertion, alter production behavior, or claim ship readiness.
