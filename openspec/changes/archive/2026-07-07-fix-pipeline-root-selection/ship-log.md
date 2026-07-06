# Ship Log: fix-pipeline-root-selection

**Date:** 2026-07-07
**Branch:** dev-harness
**Repo:** E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code
**Mode:** Direct commit + push (this fork's convention — no PR, no merge; dev-harness is the long-lived work branch, main tracks upstream)

## Pre-Flight Results

- Verification: review-report.md present, final verdict **APPROVE**, 0 open findings (round-1 re-review; round-0 had 1 Major + 1 Minor, both confirmed resolved).
- Tasks: 9/9 top-level tasks (all sub-tasks) marked complete in tasks.md, including verify tasks 6.1–6.3.
- Git status pre-ship: 9 modified files + 2 untracked (change directory + new test file), matching the reviewed diff exactly. Clean otherwise.

## Gate Results

| Gate | Result | Detail |
|---|---|---|
| `pnpm build` | PASS | Skill docs regenerated (31 skills), TypeScript compiled clean, "Build completed successfully". |
| `pnpm test` (full suite) | PASS | **115 test files passed (115), 2076 tests passed, 22 skipped (2098 total), 0 failed.** Duration 185.12s. No flakes observed on this run (the review-report's earlier run had noted 10 unrelated Windows-flaky failures in untouched files `spec.test.ts` / `artifact-workflow.test.ts`; this ship run was fully green with no re-run needed). |
| `openspec config list` | PASS | Real global config (`%APPDATA%\openspec\config.json`) unpolluted: normal profile (`custom`/`both`), standard workflow list, existing telemetry anonymousId — no ghost stores, no test artifacts. |
| `openspec validate fix-pipeline-root-selection --json` | PASS | 1 item, 1 passed, 0 failed. |

## Commit

- Hash: `4251e5952ded264bebd67bdb09de08018a2a6ca3` (short: `4251e59`)
- Message: `fix(pipeline): migrate pipeline command group to root-selection semantics with --store support`
- Files: 18 changed, 704 insertions(+), 59 deletions(-)
  - Modified: `src/cli/index.ts`, `src/commands/pipeline.ts`, `src/core/completions/command-registry.ts`, `src/core/templates/workflows/_orchestration.ts`, `src/core/templates/workflows/auto.ts`, `src/core/templates/workflows/store-selection.ts`, `test/commands/pipeline.test.ts`, `test/core/completions/command-registry.test.ts`, `test/core/templates/skill-templates-parity.test.ts`
  - Added: `test/commands/pipeline-store-root-selection.test.ts`, and the full `openspec/changes/fix-pipeline-root-selection/` artifact set (`.openspec.yaml`, `design.md`, `planning-context.md`, `proposal.md`, `review-report.md`, `tasks.md`, `specs/opsx-orchestration/spec.md`, `specs/opsx-pipeline-registry/spec.md`)
  - **Note:** `openspec/changes/fix-pipeline-root-selection/auto-run.json` exists on disk but is excluded by the repo's own `.gitignore` (`openspec/changes/**/auto-run.json`, line 163) — it has never been tracked anywhere in this repo's history. Left untracked and unedited per that established, repo-wide convention rather than force-added.

## Push

- `git push origin dev-harness` — succeeded, fast-forward `ab6b78c..4251e59 dev-harness -> dev-harness`.
- No force-push. No other branches touched. No PR created, no merge performed (per repo convention: dev-harness is the fork's long-lived work branch; main tracks upstream).

## Status

**Shipped.** Ready for `/opsx:archive fix-pipeline-root-selection` at the team's discretion.
