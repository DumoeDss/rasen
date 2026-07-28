# Planning context — pr88-ci-residue

LEAD-seeded context for the planner/implementer. Read this FIRST, then research only what is missing.

## User intent (verbatim)
"把残留的这些问题都进行修复（包括M6的残留）" — Fix ALL remaining CI residue failures (the M6 stabilization), on branch `feat/pr88-review-fixes` (worktree `OpenSpec-code-pr88-review`), delivered via PR #88 (remote head `feat/store-context-portable-knowledge`).

## Goal
Make CI green: the review's acceptance condition #6 ("3 consecutive green CI") = this change. PR #88 head is `e3532d00` = this worktree's HEAD. The residue is ~6 failing tests across the matrix; once they pass, the aggregator gate jobs (`Test`, `All checks passed`) stop fast-failing too.

## The 6 failures — CI ground truth (linux-bash job 90170370758, run 30325638605, commit e3532d00)
linux-bash: **4 test files failed | 308 passed (312)**, 5 tests. UI Package Build job: **1 file failed | 47 passed (48)**, 2 tests (same commit).

| # | File:line | Failing test | CI assertion (verbatim) | Nature |
|---|---|---|---|---|
| 1 | `test/commands/pipeline-store-root-selection.test.ts:296` | `pipeline command store root selection > agents writes a runtime config instance under the store root (no YAML copy)` | `expected { runtime: 'codex', …(2) } to deeply equal { runtime: 'codex', …(2) }` — runtime matches, 2 hidden fields differ (suspected `dispatchMode`: test expects `exec-bridge`, code yields `legacy-fallback`) | assertion/contract mismatch — decide which side is correct |
| 2 | `test/core/management-api/audits-api.test.ts:230` | `management audit API > terminates incomplete upload sockets after declared oversize and early validation rejection` | `Error: Test timed out in 30000ms` (socket hang) | **REAL concurrency bug** — `importStream` does not reject a DECLARED oversized upload before reading body → incomplete upload hangs to 30s |
| 3 | `test/core/store/bootstrap-obtain.test.ts:551` | `Store-first apply flow (design D4) > registers the Store checkout during apply` | `expected undefined to be true // Object.is equality` | round-2 child #5 MODIFIED this file (added B7/M1 tests) — registration returns undefined under CI parallel load (passes locally isolated, integration 536/0) |
| 4 | `test/core/store/bootstrap-obtain.test.ts:1227` | `B3 — concurrent clone race on the same absent target > exactly one publish succeeds when two obtains race on the same target` | `expected 'not-acted' to be 'obtain-failed'` | round-2 child #5 MODIFIED this file — contract question: when two obtains race and one wins, should the loser report `obtain-failed` (test) or `not-acted` (code)? |
| 5 | `test/core/token-audit/management.test.ts:325` | `audit management core > lists only direct valid regular reports and safely reads exact basenames` | `expected error to be instance of AuditServiceError` | code throws a different Error class than the test expects (or test expects AuditServiceError where code legitimately throws plain Error) |
| 6 | `test/components/board-page.test.tsx:247,285` (packages/ui) | `BoardPage > New change submission > successful submit…` AND `error path: dialog stays open…` | `expected '…' to contain 'submitted-change'` / `to contain "Change 'dup-change' already exists"` — post-submit textContent shows the un-refetched board | jsdom async timing (refetch not awaited); round-2 NEVER touched `packages/ui` — pre-existing |

## Root-cause hypotheses (from prior LEAD handoff — verify, don't trust blindly)
- #2 is a confirmed real bug in pre-existing HTTP body handling. Find via `grep -rn importStream src/`. The audits service must reject a DECLARED oversized upload (Content-Length / declared size) BEFORE reading the body, so an incomplete upload can't hold the socket. Key files: `src/core/management-api/router.ts:591-636` + the audits service `importStream`.
- #1: codex `dispatchMode` resolves from the `--store` config (NOT env). The suite's dispatchMode assertions are individually runtime-dependent + inconsistent (some expect exec-bridge, some legacy); no single `RASEN_AGENT_RUNTIME` env value satisfies all. **Do NOT set `RASEN_AGENT_RUNTIME` globally on CI** (already tried + reverted in `e3532d00` — it broke 4 pipeline show/agents tests). Per-test env only, if any.
- #3/#4: bootstrap-obtain passes locally (integration 536/0) but fails on CI under full-suite parallelism. #3 (`undefined` registration) smells like an un-awaited registration under load; #4 (`not-acted` vs `obtain-failed`) is a contract call on the B3 race loser. Because child #5 touched this file, INVESTIGATE whether #5 introduced the gap vs pure CI flakiness — reproduce under parallel load (`pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts` repeated, or with other files / `--pool=forks --poolOptions.forks.singleFork=false`).
- #5: determine whether the code should throw AuditServiceError (test right) or whether the test over-constrains (a plain Error / different class is legitimate).
- #6: packages/ui jsdom — the submit handler's refetch isn't awaited in the test, or the component doesn't expose a loading/post-success state the test can wait on. Round-2 never touched packages/ui; this is pre-existing timing debt.

## For each failure, decide: fix the TEST or fix the CODE
This is the core planning question. Some are clearly code bugs (#2), some are test/contract mismatches where the test may be wrong (#1, #5 possibly), some need investigation (#3, #4, #6). Document the decision per failure in design.md.

## Constraints / decisions already made (do NOT re-litigate)
- **Cross-platform is non-negotiable**: `path.join()`/`path.resolve()` only, never hardcoded slashes; Windows CI (`windows-pwsh`) is in the matrix and currently also red. The project `rasen/config.yaml` rules require Windows path-handling scenarios.
- **Round-2 fixes are correct + verified locally** (integration 536/0, each child review-clean). The residue is pre-existing M6 debt exposed because child #8 (M7) made CI actually run on `dev/0.1.5` for the first time — these were invisible before. Do not "fix" by reverting round-2 work.
- **Do NOT set `RASEN_AGENT_RUNTIME` globally on CI.** Per-test env only.
- `rasen archive` adds a trailing blank line at EOF to synced specs → `git diff --check` fails; strip if you touch specs. (Likely no delta specs needed here — these are test/bug fixes, not new capabilities. The audits-api socket fix changes runtime behavior but the test already encodes the contract.)
- **PR head branch ≠ worktree branch**: local `feat/pr88-review-fixes`, remote PR head `feat/store-context-portable-knowledge`. Ship pushes with `git push origin feat/pr88-review-fixes:feat/store-context-portable-knowledge`.
- **1M-window context probe**: `rasen agent context --latest` (no `--limit`) misreports on Opus 5 [1m]; always use `--limit 1000000`.

## Local reproduction notes
- Some failures (bootstrap-obtain #3/#4) do NOT reproduce in isolated single-file runs — they need full-suite parallel load. Reproduce with parallel runs or reason statically from the code.
- The audits-api socket hang (#2) and the assertion mismatches (#1, #5) SHOULD reproduce in isolated single-file runs.
- The UI failures (#6) are in `packages/ui` — run via the UI package's own test command, not the root suite.

## Working set (prior session)
- Commits on `feat/pr88-review-fixes`: round-2 fixes `34987ed0..e3532d00` (already pushed to origin/feat/store-context-portable-knowledge).
- Prior LEAD handoff: `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\pr88-acceptance-fixes\work\handoff\lead-1.md`
- Evidence doc: `docs/audits/pr88-round2-evidence-reconciliation.md`
- Acceptance review: `docs/audits/pr-88-acceptance-review-2026-07-28.md`
