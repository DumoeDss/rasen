# Ship Log: issue-project-grouped-views

**Date:** 2026-08-20 23:35 local
**Mode:** local
**Branch:** feat/issue-phase3
**Commit:** 3dbf7ffc4647e60d73dc6b706ee13d18007c06e6
**Tree:** c4ce731aa5f5efdf86470ea6a08f04b59369a44d
**Status:** Committed (delivery deferred to portfolio level)

Child 3/3 (Phase 3 finale). Delivery happens once at the parent level now that
all three children are committed; nothing pushed, no PR. Parent commit at
ship: 0ae54a56 (issue-cross-project-gating archived; ship 8a1a2d31).
Phase 3 siblings shipped: g-001 1049453b, g-002 8a1a2d31, g-003 3dbf7ffc.

## Pre-Flight Results
- Verification: pass - review-report.md is a reviewer FIRST-PASS CLEAN (0 Blocker / 0 Major / 0 Minor / 3 Info: Info-1 an untracked machine-local byproduct of a sanctioned mutation - kept out of the commit pathspec by construction; Info-2 verifier arithmetic on batch selection, CI the authority; Info-3 the lane-omission render branch is design-verified by inspection, not test-pinned - cosmetic failure mode). No fix round existed or was needed. validate green at ship time.
- Tasks: 18/18 complete
- Mtime audit at ship: no src/test/skill/change file newer than review-report.md

## Test Gate
- Required scope: the finale's essence - live-loop verification over the persistent store plus the full affected core (store family, issue-status with both new suites, CLI family on dist)
- Rationale: project lanes + progressOver + list summaries touch the shared projection surface; the reviewer re-verified the full store family and re-drove the live loop read-only
- Tests (reviewer-reproduced, real exit codes, dist fresh after build incl. native capsule rebuild):
  - Full store family 80 files / 1482 passed + 2 skipped, exit 0
  - issue-status dir incl. both new suites 8 files / 55, exit 0; acceptance+execution+publication 6 files / 77, exit 0
  - CLI family on dist 7 files / 42 + 1 timeout flake adjudicated by isolated re-run (5/5, exit 0)
  - Reviewer equivalent batches total 104 files / 1710 + 2 skips + 1 adjudicated flake, every implementer-claimed area covered
  - Live loop re-driven read-only: two-lane projection, cross-project gate still holding, byte-stable degradation exactly as the receipts claim; staged close leaves remaining legs honest (no acceptance record exists)
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) adjudicated by baseline comparison; CI is the authority gate. The portfolio-level full-suite run is NOW DUE (all Phase 3 children committed).
- Tree: c4ce731aa5f5efdf86470ea6a08f04b59369a44d

## Commit Contents (3dbf7ffc, 33 files, 317 insertions, 22 deletions)
- Project lanes + progressOver: src/core/issue-status/{types,projection,index}.ts
- Lane rendering + list summary + json: src/commands/store-issue.ts (renderIssueList lane segment with omission branch)
- Tests: 2 new suites (issue-status-project-lanes, issue-status-project-lane-degradation) + 1 appended CLI scenario block in store-issue-status-cli.test.ts (+141)
- architecture-index: quick-locate row + spec-store-engine module note
- Change dir: proposal, design, 1 spec delta (issue-status-projection), tasks, 18 evidence files (Issue #2 loop set, Issue #1 degradation captures, store-widening receipts, summary, staged-close.md, review report)

## Exclusions (intentional)
- rasen/config.yaml (storeMemberships tooling hint) - expected tooling write, left modified and uncommitted, untouched
- .rasen-store/ and .rasen/ ephemera (incl. dated mirrors, close-*.json) - not committed
- rasen/changes/issue-cross-project-execution/ (parent) - left for the portfolio-level delivery
- The persistent store's 5 new commits incl. Issue #2 and the main checkout's hint writes - outside this repo commit, untouched

## Next Steps (portfolio close - LEAD)
- staged-close.md legs: complete the staged close from the worktree (acceptance record on the store) per its sequencing
- Single portfolio-level delivery (push/PR) + full-suite/CI gate (deferral consumed here)
- Retention: rasen-retain issue-project-grouped-views; archive: on-merge timing - rasen-archive-change follows portfolio delivery

## Archive
**Date:** 2026-08-20T15:43:44.047Z
**Ship commit:** 3dbf7ffc4647e60d73dc6b706ee13d18007c06e6
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-20-issue-project-grouped-views
**Transaction:** 9efaf0e5-efc5-452c-bef2-e8627e0fb47e
