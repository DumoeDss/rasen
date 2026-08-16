# Ship Log: converge-projectid-mint-with-registry

**Date:** 2026-08-16 21:58 +0800
**Mode:** pr
**Branch:** fix/converge-projectid-mint-with-registry
**Commit:** a2cc71f0582a388962d3b13616f02ceaca83a830
**Tree:** a82a53833d26c79073dc569363052e438261a775
**Base:** dev/0.2.0
**PR:** https://github.com/DumoeDss/rasen/pull/164
**Status:** PR Created

## Pre-Flight Results
- Verification: pass — `evidence/review-report.md` present (review loop); LEAD-run verification recorded in run-state
- Tasks: 19/19 complete
- Working tree: shared and dirty with unrelated files; committed by explicit pathspec only (17 paths), unrelated dirt untouched
- Whitespace gate: `git diff --cached --check` clean against the staged diff (mixed-endings file `test/core/init.test.ts` introduced no CR on added lines)
- Diff scan: no debug output, secrets, or leftover TODO markers on added lines; 1231 insertions / 20 deletions across 17 files

## Test Gate
- Required scope: 7 identity suites (project-config, project-registry, project-home, init, space-selector, learned-skills/context, config-api/project-addressing) + lint + tsc --noEmit + build
- Rationale: change is localized to project identity mint/reconcile in `src/core/` with regression tests in the five touched suites; scope covers the delivered risk
- Tests: skipped at ship — scoped green evidence from LEAD-run verification recorded in run-state: 7/7 files, 345/345 tests passed in a single combined invocation (default timeouts, 368s); lint exit 0; `tsc --noEmit` exit 0; build exit 0. Gate policy off; no code changed after that evidence (review Major+Minor fixes precede it).
- Review: 0 Blocker / 1 Major / 1 Minor / 1 Trivial → Major+Minor fixed, re-reviewed RESOLVED by non-author; Trivial + two calibration notes accepted-known (`evidence/review-report.md`)
- Tree: a82a53833d26c79073dc569363052e438261a775

## Delivery
- Pushed `fix/converge-projectid-mint-with-registry` to origin (upstream tracking, no force)
- PR #164 opened against dev/0.2.0; body from `proposal.md` (Why / What Changes) + verification summary; PR/commit footer carries the Co-Authored-By line
- Base branch was in sync (origin/dev/0.2.0 = HEAD base 9aa2b9e4); merge pre-validation was a no-op

## Deployment
Status: Pending — on-merge timing: retain (`rasen-retain`) next, then `rasen-archive-change` after PR #164 merges

## Archive
**Date:** 2026-08-16T15:03:43.256Z
**Ship commit:** a2cc71f0582a388962d3b13616f02ceaca83a830
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\archive\2026-08-16-converge-projectid-mint-with-registry
**Transaction:** 63918d5c-d45d-4d7e-bb1e-b1d2a9d07dd9
