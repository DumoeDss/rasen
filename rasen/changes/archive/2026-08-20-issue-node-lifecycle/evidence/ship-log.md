# Ship Log: issue-node-lifecycle

**Date:** 2026-08-20 13:54 local
**Mode:** local
**Branch:** feat/issue-phase2
**Commit:** 31d0b6440a453a128af29b900329c5389e52cf30
**Tree:** b780034c392ffc051e387ccc4d5319d23c247920
**Status:** Committed (delivery deferred to portfolio level)

Child 2/3 of portfolio issue-multi-change-execution. Delivery happens once at
the parent level after all three children complete; nothing pushed, no PR.
Parent commit at ship: 010dcf70 (issue-plan-publication already archived).

## Pre-Flight Results
- Verification: pass - review-report.md round-1 PASS (0 Blocker / 0 Major / 2 Minor / 3 informational) with round-1 re-review CLEAN; validate green at ship time (rasen validate issue-node-lifecycle)
- Tasks: 19/19 complete

## Test Gate
- Required scope: store-family focused suites (schema extension under src/core/store/issues/, issue-status projection, issue-acceptance gate, issue-execution binding, prior CLI tests, completions/locale untouched per D5)
- Rationale: in-place extensions of four bounded core modules with no new CLI surface; the touched modules' suites plus the prior-test zero-edit/zero-diff checks bound the delivered risk
- Tests (green chain, no code changed after the last run):
  - Store-family affected set: 20 files / 236 tests, exit 0 (evidence/affected-set-gate.log with the R1-corrected binding-file count 29 = 24 prior + 5 new; independently-verified digest pin included)
  - Prior CLI untouched: 5/34 zero-edit; issue trio 34/34 zero-diff (reviewer-reproduced)
  - Fix round 1 (evidence correction + delta prose/scenario + one pin row in this change's own new suite; tracked diff byte-identical to round 1 per re-review): pnpm run build exit 0; vitest issue-status-lifecycle + issue-status-projection -> 2 files / 31 tests, exit 0
  - Round-1 re-review: CLEAN - 31/31 re-run green, validate green, delta title discipline verified two-directionally (zero renames, zero drops)
  - Mtime audit at ship: no src/test/skill file newer than the 13:52 re-review
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) was adjudicated by baseline comparison on 2026-08-17; CI is the authority gate. Same deferral as sibling g-001 (ship bfb63865).
- Tree: b780034c392ffc051e387ccc4d5319d23c247920

## Commit Contents (31d0b644, 31 files, 3374 insertions, 67 deletions)
- Schema extension: src/core/store/issues/plans.ts + types.ts (lifecycle field + reason refusal)
- In-place extensions: src/core/issue-status/ (projection, types), src/core/issue-acceptance/ (gate, index, types), src/core/issue-execution/ (binding, types)
- src/commands/store-issue.ts: presentation-only rendering of lifecycle/reason/exclusions in existing show output - no new command, option, or flag (D5 holds)
- Tests: 4 new suites (store schema 10, CLI 4, gate-lifecycle 6, status-lifecycle 9 incl. R2 pin) + 2 prior files touched (binding +159, projection +7; strength arguments in gate log G)
- architecture-index: SKILL.md map + spec-store-engine detail + quick-locate row (3 spots)
- Change dir: rasen/changes/issue-node-lifecycle/ (proposal, design, 4 spec deltas, tasks, evidence minus the .log below)

## Exclusions (intentional)
- Untracked siblings left for parent-level delivery: rasen/changes/issue-multi-change-execution/, issue-persistent-baseline/
- .rasen/ ephemera (all changes) - not committed
- evidence/affected-set-gate.log - repo .gitignore line 3 (*.log); zero tracked .log files repo-wide, not force-added; remains on disk for the archive engine's content-addressed payload

## Next Steps
- Portfolio delivery (LEAD): child 3 (issue-persistent-baseline) completes, then single portfolio-level delivery + full-suite/CI gate
- Retention: rasen-retain issue-node-lifecycle
- Archive: on-merge timing - rasen-archive-change follows portfolio delivery

## Archive
**Date:** 2026-08-20T05:56:26.013Z
**Ship commit:** 31d0b6440a453a128af29b900329c5389e52cf30
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-20-issue-node-lifecycle
**Transaction:** 0e13db78-6356-410e-aaa8-4f36a43dd24c
