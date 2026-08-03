# Pre-Landing Review: codex-luna-thread-dispatch

**Verdict: PASS - the Windows local-runtime ship repair is independently clean. The Node 20.19/Corepack cause is reproduced, PATH pnpm preserves the lifecycle exit code, every requested local gate passes, and no open Blocker or Major exists in the repair delta. Task 6.3 remains open until fresh external PR Windows CI passes.**

- Mode: dispatched, report-only independent non-author reviewer
- Branch: `feat/codex-luna-thread-dispatch`
- Base: `origin/dev/0.2.0`
- Review date: 2026-08-04T06:35:19+08:00
- Scope read: the complete `rasen-review` skill, checklist, and Greptile triage reference; `test/AGENTS.md`; change artifacts; `evidence/review-report.md`, `evidence/review-cycle-report.md`, and `evidence/ship-log.md`; PR #134; GitHub Actions run `30854609588` attempts 1 and 2; the complete repair diff and both full relevant files; and commit `7baa8f3b` history.
- Scope check: CLEAN. The repair removes only Windows pnpm's bundled-Corepack preference and adds focused copied-node regression fixtures; npm resolution, non-Windows invocation, package preparation, diagnostic classification, and the Codex dispatch implementation are unchanged.
- Fix-first disposition: no finding to route. This reviewer changed no production code or tests and left `tasks.md`/`ship-log.md` untouched; only canonical review evidence was updated.

## Open canonical findings

None.

## Ship repair independent disposition

### SR-1. [Resolved CI Blocker] Node 20.19 bundled Corepack bypassed the active pnpm and failed before the fixture script

- GitHub Actions attempts 1 and 2 independently show `pnpm/action-setup@v4` installing pnpm 9.15.9 under `C:\Users\runneradmin\setup-pnpm\node_modules\.bin`, `actions/setup-node@v4` selecting Windows x64 Node 20.19.0, and the same sole failure: 141/142 files and 2,411/2,422 tests passed while `COMMAND_FAILED`/`build` reported exit 1 instead of the fixture's exit 7.
- The official Node 20.19.0 Windows archive contains Corepack 0.31.0 at the exact formerly preferred adjacent path. With a source manifest that has a build script but no `packageManager` and a fresh isolated Corepack home, direct bundled invocation selected pnpm 11.20.0, attempted to add `packageManager`, and failed with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`/exit 1 before `node -e "process.exit(7)"` ran.
- Under the same space-containing fixture, PATH pnpm executed the build script and returned exit 7. This establishes that CI's received 1 was a Corepack bootstrap failure, not exit-code normalization by the harness.
- Commit `7baa8f3b` contains the same removal with the explicit rationale "Resolve pnpm from the active environment instead of preferring Node's bundled Corepack." Later merge history reintroduced the older branch; this repair restores that deliberate behavior.

### SR-2. [Resolved portability risk] PATH resolution is bounded, quoted safely for current callers, and fail-closed

- `scripts/local-version/local-runtime.mjs:180-184` invokes `%ComSpec% /d /s /c pnpm`; `runCommand()` passes argv as an array, retains the exact `cwd`, copies the current environment, and preserves `spawnSync.status` in the stable `COMMAND_FAILED` receipt (`:192-215`). This honors setup tooling's PATH/PATHEXT-selected `pnpm.CMD` rather than a Node-adjacent package manager selected independently of the environment.
- Every pnpm argument at this boundary is a fixed token: `--version`, `install --frozen-lockfile`, or `run build` (`:220-225,389-395`). Filesystem paths with spaces are carried in `cwd`, not interpolated into the command string. npm's path-bearing `pack` call still runs the Node-adjacent npm CLI directly and is outside this change.
- A full official-Node-20.19 harness probe put a fake `pnpm.cmd` in a PATH directory containing spaces. The marker recorded the exact space-containing source cwd and `args=run build`; the final receipt remained `COMMAND_FAILED`/`build`/exit 7 and no runtime was published.
- The same full harness with an empty PATH failed promptly with cmd's actionable "pnpm is not recognized" text, `COMMAND_FAILED`/`build`/exit 1, and no runtime publication. Removing the bundled fallback therefore respects an explicitly unavailable tool rather than silently switching package-manager implementations.
- The adjacent npm branch and every non-Windows branch are byte-for-byte unchanged. The production delta is the deletion of one Windows-only preference, not a new cross-platform command path.

### SR-3. [Resolved test-risk audit] Copied-node fixtures are isolated, Windows-portable, and regression-sensitive

- `createIsolatedNodeExecutable()` copies only the current standalone `node.exe` into roots named `node with corepack` / `node without corepack`, adds the minimum npm manifest needed to keep fingerprinting local, and creates a sentinel Corepack entry only for the present case (`test/scripts/local-version-runtime.test.ts:101-119`). The paths deliberately contain spaces.
- `runPrepare()` accepts the copied executable and an environment overlay without mutating the parent process environment (`:121-156`). Each case sets the CI user-agent identity, requires exit 7, rejects the sentinel Corepack stderr, and asserts that no runtime was published (`:288-324`). The present layout fails under the removed implementation because the sentinel exits 1; the absent layout confirms the ordinary PATH fallback. Together they cannot pass merely from the copied executable existing.
- Every case owns one `mkdtemp` root registered immediately at creation and `afterEach` removes only those exact roots (`:33-39,188-192`). All children are synchronous before cleanup. The official Node 20.19 versions of both fixtures pass, and no recent `rasen-local-version-*` root or worktree-associated Node/pnpm/cmd process remained after verification.

## Repair coverage

```text
CODE PATH COVERAGE
==================
[+] Windows commandInvocation('pnpm')
    [+ TESTED] Bundled Corepack present -> ignored; active PATH pnpm returns exit 7
    [+ TESTED] Bundled Corepack absent  -> active PATH pnpm returns exit 7
    [+ PROBED] PATH pnpm unavailable    -> stable COMMAND_FAILED/build/exit 1; no publication
    [+ PROBED] PATH directory + cwd contain spaces -> exact pnpm.cmd and args selected
[+] runCommand failure boundary
    [+ TESTED] COMMAND_FAILED code, build phase, and child exit 7 remain stable
[+] npm and non-Windows resolution
    [+ STATIC] Unchanged by the repair delta

USER FLOW COVERAGE
==================
[+] Local source runtime prepare on Windows
    [+ TESTED] Exact CI failure case
    [+ TESTED] Complete 9-test local-version integration file

COVERAGE: all changed behavior and observed failure paths verified; no E2E/eval gap.
```

## Ship-repair verification evidence

- Exact repaired failure case on the host Node 24.14.0: PASS, 1 selected / 8 skipped.
- Both copied-node resolution fixtures on Node 24.14.0: PASS, 2 selected / 7 skipped.
- Exact repaired failure case on official Node 20.19.0 with the CI user-agent: PASS, 1 selected / 8 skipped.
- Both copied-node resolution fixtures on official Node 20.19.0: PASS, 2 selected / 7 skipped.
- Complete `test/scripts/local-version-runtime.test.ts`: PASS, 1 file / 9 tests.
- Official Node 20.19.0 + Corepack 0.31.0 causal probe: expected pre-repair behavior reproduced, exit 1 with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`; PATH build returned 7.
- Explicit PATH/cwd-spaces full-harness probe: PASS, marker `args=run build`, stable exit-7 receipt, no runtime publication.
- Empty-PATH full-harness probe: PASS, actionable unavailable-command stderr, stable exit-1 receipt, no runtime publication.
- `pnpm lint`: PASS, exit 0; only the known unrelated unused-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- `pnpm run build`: PASS, exit 0.
- `node --check scripts/local-version/local-runtime.mjs`: PASS.
- `git diff --check`: PASS; line-ending conversion notices only.
- `node bin/rasen.js validate codex-luna-thread-dispatch --strict --json`: PASS, 1 change / 0 failures.
- Greptile: no line-level or top-level Greptile comments on PR #134.
- Medium-delta external Codex adversarial pass: timed out at the skill's five-minute bound without output; non-blocking, and no fallback subagent was permitted by the dispatched-leaf contract.

## Ship-repair evidence boundaries

- No fresh external CI run contains this uncommitted repair, so task 6.3 remains unchecked and the PR is not yet shippable on CI evidence alone.
- No monolithic `pnpm test` rerun was performed for this two-line selection change; the previously reviewed committed-tree full-suite pass remains the branch-wide evidence, while the complete affected file plus exact Node 20.19 reproduction bound this delta.
- HEAD remains `1b58aa310f3a355afe8804de88a446038809b20a` / tree `372afe139485679f39d3f238927c99275d5ac88f`; verification covered the live uncommitted repair.

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
