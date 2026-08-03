# Pre-Landing Review: codex-luna-thread-dispatch

**Verdict: PASS - round 3 is independently clean. The aggregate-only pipeline timeout Blocker is resolved, the required exact monolithic gate passes, and no open Blocker or Major remains across the total delta.**

- Mode: dispatched, report-only independent non-author reviewer
- Branch: `feat/codex-luna-thread-dispatch`
- Base: `origin/dev/0.2.0`
- Review date: 2026-08-04 (Asia/Shanghai)
- Scope read: the complete `rasen-review` skill and checklist; `test/AGENTS.md`; every change artifact and both prior evidence reports; the round-3 diff and full relevant files; and the retained round-1/round-2 canonical dispositions.
- Scope check: CLEAN. Round 3 changes only the cumulative timeout for one 16-process test journey and makes test-process teardown awaitable; production behavior and assertions are unchanged.
- Fix-first disposition: no open finding to route. This reviewer changed no production code or tests; only task bookkeeping and canonical evidence were updated.

## Open canonical findings

None.

## Round 3 independent disposition

### R3-1. [Resolved Blocker] The aggregate localized-pipeline case is bounded without masking per-process hangs

`test/commands/pipeline.test.ts:160-305` still performs and asserts all sixteen CLI calls for each locale. Only that cumulative `it.each` case changed from 60 seconds to 120 seconds (`:301-305`). The shared child limit remains `DEFAULT_CLI_TIMEOUT_MS = 30_000` in `test/helpers/run-cli.ts:12`, and `runCLI()` still applies it independently to every spawn at `:192-223`. No other case timeout or command timeout was raised.

The baseline/branch evidence is independently reproducible and shows no material feature regression:

| Surface | Clean `origin/dev/0.2.0` | Feature branch | Result |
|---|---:|---:|---|
| Fixer two-run test average | 26.239 s | 25.657 s | branch 0.582 s faster |
| Fresh reviewer exact English test | 26.173 s | 22.076 s | branch 4.097 s faster |

The fresh baseline was built from a clean `git archive origin/dev/0.2.0` using the same installed dependencies and the same one-worker Vitest command. The branch therefore does not explain the prior >60-second monolithic tail; the fixer's four-worker evidence (43.482 / 40.060 / 43.024 seconds for the three localized cases) and the prior monolithic timeout establish aggregate Windows process/filesystem contention.

### R3-2. [Resolved cleanup race] Active CLI teardown is exact, single-settlement, and bounded

- Exact ownership: `activeCliChildren` contains only `ChildProcess` objects created by `runCLI()` (`test/helpers/run-cli.ts:34,193-214`). The reaper snapshots that set and never enumerates system PIDs (`:160-163`). Pipeline cases are not concurrent, and Vitest uses per-file fork isolation, so the pipeline `afterEach` cannot reach another file's CLI child.
- Process-tree scope: Windows uses `taskkill /pid <exact-child-pid> /t /f` with `windowsHide: true`; POSIX workers are spawned detached and teardown signals only the exact child's process group (`:104-123,193-210`).
- Close/error race: the reaper installs one-shot `close` and `error` listeners before termination. Its shared `finish()` clears the deadline and removes both listeners before settling (`:131-157`), so whichever terminal signal wins prevents the other path or timer from settling the wait again.
- Bounded teardown: each active child has a 10-second close deadline (`:13,146-152`), children are awaited concurrently, the pipeline `afterEach` awaits reaping before deleting its exact cwd (`test/commands/pipeline.test.ts:143-148`), and global teardown awaits the same helper before its own temp cleanup (`vitest.setup.ts:43-46`). The targeted active-child probe completed in 737 ms; a second empty reap completed in 0 ms.
- Unrelated-process regression: an independently spawned sentinel remained alive after the tracked CLI child was reaped. The tracked promise settled, the unrelated PID remained addressable, and the sentinel was then terminated explicitly by the probe cleanup.

### R3-3. [Resolved gate] The exact full suite passes

The sole permitted exact `pnpm test` attempt exited 0 after 1,236.8 seconds (~20m36.8s), before the hard 40-minute cap. Neither the round-1 outside-project failures nor the round-2 pipeline timeout/`EBUSY` cleanup recurred. The command-output transport truncated the final aggregate-count lines, so this report does not fabricate totals; exit 0 is the canonical gate result.

## Retained prior-round dispositions

- Round 1 provider schemas: resolved. Provider-facing leaf/evaluate schemas require every property with nullable optional values; strict normalization remains fail-closed. The clean real Luna/Terra matrix remains canonical.
- Round 1 assembled prompt/stdin: resolved. Final assembled bytes are checked pre-spawn; early EOF/EPIPE produces one bounded failure and process-tree teardown.
- Round 1 sandbox provenance: resolved. Fresh state records creation-time sandbox, exact resume reports the stored value, and legacy state omits unknown sandbox.
- Round 2 outside-project isolation: resolved. The helper avoids ambient ancestor `rasen/` markers without changing production root detection or weakening inside-project assertions.

## Standards axis

- Race conditions / concurrency: PASS for the round-3 delta. Reaping is scoped to exact active child objects, listeners are installed before termination, and cleanup waits before removing the cwd.
- Magic numbers / coupling: PASS. The 120-second journey bound is local to the one cumulative case; reusable per-process and reaper bounds are named constants.
- Dead code / consistency: PASS. Both consumers await the now-async reaper and lint reports no error.
- Test gaps / completeness: PASS for the target regression. Independent baseline/branch timing, unrelated-process survival, the exact case, all 99 pipeline tests, and the monolithic suite cover the observed failure modes.
- Cross-platform behavior: PASS in local/static evidence. Windows tree kill remains hidden and PID-scoped; POSIX uses the detached process group; native path handling and exact cwd deletion are unchanged. Actual PR Windows CI remains a separate delivery gate.

## Spec axis

- `codex-exec-runtime`: PASS (retained round-1 code and live evidence; no related production code changed in rounds 2-3).
- `codex-lifecycle`: PASS (retained exact-thread/one-writer/sandbox evidence; no related production code changed in rounds 2-3).
- `config-resolution`: PASS (retained focused/full-suite evidence).
- `opsx-orchestration`: PASS (retained template/parity evidence).
- Cross-platform task 6.2: PASS. Lint, build, and exact full suite are green.
- Cross-platform task 6.3: OPEN by design. Local Windows execution is not real PR CI evidence.

## Verification evidence

- `pnpm run build` - PASS, exit 0, 13.8 seconds.
- `pnpm lint` - PASS, exit 0, 17.8 seconds; only the pre-existing unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- Fresh branch exact English case - PASS, 1 selected / 98 skipped, 22.076 seconds test time (31.129 seconds measured wall time).
- Fresh clean-baseline exact English case - PASS, 1 selected / 98 skipped, 26.173 seconds test time (34.967 seconds measured wall time).
- Targeted active-process reaper probe - PASS: tracked child was pending, reap completed in 737 ms, the runCLI promise settled, unrelated sentinel survived, and a second reap took 0 ms.
- Full `test/commands/pipeline.test.ts` - PASS, 1 file / 99 tests, 350.34 seconds. Localized cases: 24.385 / 25.328 / 24.187 seconds.
- Sole exact `pnpm test` - PASS, exit 0, 1,236.8 seconds, before the hard 40-minute cap.
- Live Luna/Terra dispatch - not rerun, as required, because its independently clean round-1 production code did not change.

## Evidence boundaries and cleanup

- No external PR Windows CI run was obtained; task 6.3 remains unchecked.
- No process with this worktree in its command line remained after the monolithic run.
- `test-pipeline-command-tmp` and the reviewer baseline archive were absent after verification.
- One intentionally stranded `rasen-codex-*` scratch directory was inspected (only its named schema and last-message files), then removed. Thirty-three current-run `rasen-test-config-*` directories were also removed. These ephemeral directories are not recoverable.

## Task bookkeeping

- Task 6.2 is checked: lint, build, and the sole exact monolithic suite all pass.
- Task 6.3 remains unchecked for real PR CI.
- Task 6.4 remains checked from the independently reviewed real Luna/Terra matrix.
