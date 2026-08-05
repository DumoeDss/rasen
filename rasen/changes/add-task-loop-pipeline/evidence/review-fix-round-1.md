# Review Fix Round 1 — `add-task-loop-pipeline`

- Change: `add-task-loop-pipeline`
- Review report: `evidence/review-report.md` (9 findings: F1–F9; 3 Blocker, 3 Major, 3 Minor)
- Fixer runtime handoff: round 1 began under `codex` (handoffs `fixer-1/2/3.md`, each cut short by compaction). The deterministic full-suite matrix and this evidence file were completed under `claude` taking over the fixer role. No self-review/certify, commit, ship, or archive was performed by the fixer.
- Date: 2026-08-02 / 2026-08-03

## F1–F9 disposition

| ID | Sev | Finding | Disposition | Evidence |
|---|---|---|---|---|
| F1 | Blocker | Unrelated/stale evidence could authorize delivery | **Fixed** | `task-loop.ts`: judge result now carries per-criterion `evidenceDigests`; every committed evidence ref is bound to change/run/action/schema/`treeDigest`; work `beforeTree`/`afterTree` + delta + actor attestation revalidated; whole history rechecked against the current workspace at delivery (`validateCommittedWork`, `validateCommittedJudge`, `assertTaskLoopMayDeliver`). Negative coverage added. |
| F2 | Blocker | Launch input + artifact targets lacked physical path authorization | **Fixed** | `safe-path.ts` walks physical components, rejects symlink/reparse roots; `input-reader.ts` uses `lstat`/open/`fstat` identity, `O_NOFOLLOW` where available, bounded read, post-read identity + second safe-path check; hidden `--input-file` accepted only from the resolved change ephemera root. Outside-root, symlink/junction, directory-leaf, oversize tests added. |
| F3 | Blocker | Repository test gate not conclusive | **Closed this round** | Deterministic 32-shard matrix run to completion (single worker, no file parallelism, `TEMP` redirected). Every failure triaged: 2 branch-caused (fixed, re-verified green), 6 environmental (proven non-task-loop, reproduced in isolation). See matrix section below. |
| F4 | Major | Critic freshness not session/role bound | **Fixed** | Critic admission requires reviewer role + runtime; critic `sessionIdentityDigest` must differ from the builder and every prior critic session; full identity still compared as an anti-spoof invariant. Same-builder-session, wrong-role, wrong-runtime negatives added. |
| F5 | Major | Launch digest caller-trusted + legacy-incompatible | **Fixed** | Runtime derives launch identity from normalized pipeline/engine/inputs; caller digest is only a consistency assertion; record-derived intent compared on reuse; legacy empty-input records stay compatible via the narrow empty-input path. Changed-pipeline, spoofed-old-digest, key-order, legacy coverage added. |
| F6 | Major | TaskLoop selected by shadowable name only | **Fixed** | CLI refuses `task-loop` unless resolution provenance is the package built-in; runtime asserts the exact lowered built-in plan shape (iterate→ship→archive), node identities/profiles/dependencies/access/loop variant/outcomes, absence of gates, and the implicit completion condition. Project + user same-name shadowing and malformed-plan negatives added. |
| F7 | Minor | Task-only fields widened generic evaluate results | **Fixed** | Generic evaluate decoding stays strict; `largestGap`/`passCondition` are projected only in task-loop plan-aware mode. Strict-generic negative + task-loop projection tests added. |
| F8 | Minor | Report lacked raw refs + robust regeneration | **Fixed** | Report serializes criterion evidence digests, raw reference/action/tree binding, pass/gap state, deterministically sorted raw evidence. Facade regenerates on start/reuse/resume/inspect and after every successful task-loop completion; write failures surface as `run_store_unavailable` without rolling back the canonical commit. Missing/stale/edited/write-failure tests added. |
| F9 | Minor | README stale | **Fixed** | `README.md` documents `rasen-auto task-loop <task>` and `--pipeline task-loop`, explicit-only selection, no classifier routing, frozen ephemera input, resume semantics, no conversion/fallback, no planning artifacts. |

All 9 findings are resolved. F3 (the only one not closeable by code alone) is closed by the conclusive matrix below.

## Focused gates (re-verified this round under `claude`)

- `pnpm run build` — **PASS** (TypeScript 5.9.3, exit 0).
- Focused TaskLoop suite — **PASS, 4 files / 69 tests**:
  `test/core/change-run/task-loop.test.ts`, `test/core/change-run/facade-runtime.test.ts`, `test/core/change-run/goal-cycle.test.ts`, `test/commands/pipeline-start-input.test.ts` (`--maxWorkers=1 --minWorkers=1 --no-file-parallelism`).
- Repaired shards re-verified green: shard 3/32 (14 files / 358 passed / 7 skipped) and shard 7/32 (14 files / 151 passed) — the two shards codex repaired mid-matrix.

## Full-suite matrix — method

Vitest reports 423 test files. The matrix is 32 sequential shards (`ceil(423/32)=14` files each; shard 31 holds the final 3, shard 32 is empty) run with:

```text
pnpm exec vitest run --shard=N/32 --maxWorkers=1 --minWorkers=1 --no-file-parallelism --reporter=dot
```

On this Windows machine `TEMP`/`TMP` are redirected to `C:\Windows\Temp` before each shard, because temp projects created under the default `C:\Users\Sayo\AppData\Local\Temp` discover the unrelated ancestor rasen root at `C:\Users\Sayo\AppData\Local\rasen` and fail falsely. The runner is resumable (skips shards already recorded in `matrix-results.md`), so an interruption resumes cleanly. Per-shard logs are under `evidence/matrix-logs/shard-N.log`; the summary table is `evidence/matrix-results.md`.

## Full-suite matrix — results

All 31 content shards run this session under `claude`, single worker, `TEMP=C:\Windows\Temp`. Shard 32 is empty (`--passWithNoTests`). Vitest exit 0 = every test in that shard passed. Totals: **6,760 passed / 8 failed / 34 skipped** across 423 files. The 8 failures live in 4 shards (15, 26, 29, 30); every other shard is exit 0.

| Shard | Exit | Dur | Disposition |
|---|---|---|---|
| 1/32 | 0 | 58s | pass |
| 2/32 | 0 | 183s | pass |
| 3/32 | 0 | 54s | pass (re-verified — codex's profile-leak repair) |
| 4/32 | 0 | 228s | pass |
| 5/32 | 0 | 117s | pass |
| 6/32 | 0 | 155s | pass (TEMP redirect avoided codex's config-editor env failures) |
| 7/32 | 0 | 34s | pass (re-verified — codex's refusal-ordering repair) |
| 8/32 | 0 | 38s | pass |
| 9/32 | 0 | 44s | pass |
| 10/32 | 0 | 33s | pass |
| 11/32 | 0 | 55s | pass |
| 12/32 | 0 | 26s | pass |
| 13/32 | 0 | 89s | pass |
| 14/32 | 0 | 92s | pass |
| 15/32 | 1 | 177s | 322 pass / 3 skip / **1 env** — version-guard stamp (see #3) |
| 16/32 | 0 | 139s | pass |
| 17/32 | 0 | 78s | pass |
| 18/32 | 0 | 31s | pass |
| 19/32 | 0 | 327s | pass |
| 20/32 | 0 | 28s | pass |
| 21/32 | 0 | 52s | pass |
| 22/32 | 0 | 97s | pass |
| 23/32 | 0 | 36s | pass |
| 24/32 | 0 | 62s | pass |
| 25/32 | 0 | 90s | pass |
| 26/32 | 1 | 90s | 206 pass / **1 branch-caused → FIXED** (see #1) |
| 27/32 | 0 | 58s | pass |
| 28/32 | 0 | 155s | pass |
| 29/32 | 1 | 86s | 331 pass / **1 branch-caused → FIXED** (see #2) |
| 30/32 | 1 | 44s | 110 pass / 2 skip / **5 env** — threshold config + ui dist (see #4–#8) |
| 31/32 | 0 | 10s | pass (3 files) |

Branch-caused failures (shards 26, 29) were fixed and re-verified green in isolation (2 files / 36 tests). The 6 environmental failures (shards 15, 30) reproduce deterministically in isolation and are on code paths the change does not touch.

## Failure attribution (8 failures across shards 7–31)

### Branch-caused by this change — FIXED (2)

Both stem from one intended design decision (task 3.4 / `builtins.ts:145`): auto-command's `requires.skills` changed from `['rasen-review']` to `['rasen-review','rasen-task-loop']` so that a project selecting auto materializes the internal `rasen-task-loop` runner it dispatches. This is correct by design — parallel to how `rasen-review` and the internal `rasen-retain` already appear in auto's install closure, and confirmed by `verification.md` ("generated installations contain `rasen-task-loop` while it remains internal and non-user-invokable"). The fix in both cases is a stale test expectation/fixture, not a code change.

1. **Shard 26 — `test/core/workflow-registry/selection.test.ts:74`** (exact `toEqual`). Expected `['auto-command','retain-command','review']`; received `[…,'task-loop']`. **Fixed**: added `'task-loop'` to the expected closure. Re-run: 2 files / 36 passed.
2. **Shard 29 — `test/commands/config-profile.test.ts` "keep action should not warn when project files are already synced"**. The synced fixture materialized auto's internal deps (`rasen-retain`) but not the new `rasen-task-loop`, so `hasToolProfileDrift` (`profile-sync-drift.ts:140-162`) correctly reported drift. **Fixed**: added `'rasen-task-loop'` to `setupSyncedCoreBothArtifacts`'s skill dirs (sidecars handled by the existing catalog loop). Re-run: 2 files / 36 passed.

### Environmental — proven non-task-loop (6), reproduced deterministically in isolation

The task-loop diff does **not** touch version-guard, threshold/scheme, global-config, agent-command context, or ui-package resolution code (`git diff --name-only` confirmed). Each failure reproduces in isolation (single-file run), so it is a deterministic environment state, not a shard-load transient.

3. **Shard 15 — `test/cli-e2e/basic.test.ts` "localizes pipeline human output"** (asserts `stderr === ''`). The version guard emits `警告：已安装的技能由 rasen v0.1.6-dev.local.2 生成；当前运行的 CLI 版本为 v0.1.6` — installed skills stamped by the user's global dev-local build mismatch `package.json`'s `0.1.6` (which the change does not modify). Isolation rerun: **reproduced** (same warning).
4–7. **Shard 30 — `test/core/commands/agent-command.context.test.ts`** (4 tests). Expect thresholds `0.05`/`0.5`/`{remainingTokens:60000}` with `thresholdSource:'global'`; resolved to `0.7` with source `project`. Source: the repo's own `rasen/config.yaml:40-41` (`handoff.threshold: 0.7`), a pre-existing user edit (6-line change, present before this work per the handoffs). The threshold/scheme resolution code is untouched by this change. Isolation rerun: **reproduced** (4 failed).
8. **Shard 30 — `test/core/config-api/ui-package.test.ts` "returns null when the UI package is not installed"**. `resolveUiPackageDir()` returns `packages\ui\dist` because a built UI dist is present in this checkout. `packages/ui/dist` is `.gitignore`d (a build artifact; the CLI `build.js` does not even build the UI), so the test passes on a clean checkout. Isolation rerun: **reproduced** (1 failed).

These six are environment/version-management state, not logic defects in the change. Per `version-discipline`, version strings and the dev-local build are the user's to manage, so they were not modified to green the matrix.

## Residual limitations

- The six environmental failures remain as long as the environment carries: a dev-local skill stamp (`0.1.6-dev.local.2`), `rasen/config.yaml`'s `handoff.threshold: 0.7`, and a built `packages/ui/dist`. They are not caused by this change and are not reproduced by any task-loop code path.
- Pure Node filesystem checks cannot make every mutation race mathematically impossible (F2); the implementation performs pre-open, descriptor, bounded-read, post-read, and post-path checks.
- `selection.test.ts:40` (closure without `includeSkillDependencies`) and `:64` (`arrayContaining`) were inspected and correctly remain unchanged.

## Diff-tree fingerprint

- Base: `dev/0.2.0` @ `a1306828` (HEAD; uncommitted working-tree implementation).
- Modified tracked: **43 files**, +1340 / −79 (`src/`, `test/`, `README.md`, locales, fixtures).
- New untracked: **6 files** — `pipelines/task-loop/pipeline.yaml`, `src/core/change-run/internal/task-loop.ts`, `src/core/templates/workflows/task-loop.ts`, `test/core/change-run/task-loop.test.ts`, `test/core/templates/task-loop.test.ts`, `test/commands/pipeline-start-input.test.ts`.
- Unrelated user work preserved untouched: `rasen/config.yaml`, `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, `rasen/specs/billing/`.
- Two test-expectation updates made this round (the branch-caused fixes): `test/core/workflow-registry/selection.test.ts:74` and `test/commands/config-profile.test.ts` `setupSyncedCoreBothArtifacts` — both adding `task-loop` to auto's now-correct install closure.

## Conclusion

All F1–F9 findings resolved. The deterministic full-suite matrix is complete with 0 remaining branch-caused failures (the 2 found were fixed and re-verified green). The 6 residual failures are conclusively attributed to pre-existing environmental state (version stamp, threshold config, UI build artifact), each reproduced in isolation and each on a code path untouched by this change. Build and the focused TaskLoop suite (69 tests) are green.
