# Ship Log: issue-cross-project-gating

**Date:** 2026-08-20 21:11 local
**Mode:** local
**Branch:** feat/issue-phase3
**Commit:** 8a1a2d3166cb14d52b87c07290d14d1327757500
**Tree:** 6ad71297db3c7512fa56ecca03712956a36a347b
**Status:** Committed (delivery deferred to portfolio level)

Child 2/3 of the Phase 3 portfolio. Delivery happens once at the parent level
after all three children complete; nothing pushed, no PR. Parent commit at
ship: d3c02b0c (issue-target-project-binding archived; ship 1049453b).

## Pre-Flight Results
- Verification: pass - review-report.md is a reviewer FIRST-PASS CLEAN (0 Blocker / 0 Major / 0 Minor / 2 Info, report-only scope: Info-1 notes a shared beforeEach fixture widening in store-issue-status-cli that leaves every prior assertion unchanged and green; Info-2 is verifier-arithmetic on store-family subset selection, CI remains the authority). No fix round existed or was needed. validate green at ship time (positional form).
- Tasks: 18/18 complete
- Mtime audit at ship: no src/test/skill/change file newer than review-report.md

## Test Gate
- Required scope: issue-status projection + blocker-basis vocabulary, issue-execution binding cross-project naming, CLI render segment, store family with digest-golden canonicalization, three-way-sync proof
- Rationale: display-basis switch plus vocabulary widening inside bounded core modules; the reviewer's representative subset covers every implementer-claimed area with the digest golden literals in the green set
- Tests (reviewer-reproduced, real exit codes):
  - pnpm run build exit 0 (type widening compiles clean) first, then fresh vitest batches: binding + projection + blocker-basis-degradation 3f/62; CLI dist pair 2f/14; store family 8f/126; three-way-sync proof 3f/51 - total 16 files / 253 tests / 4x exit 0 (representative subset of the implementer's 27/342 claim, every claimed area covered)
  - Frozen fences empty (pipeline-registry, packages/ui, templates); scenario titles byte-stable (7 new scenarios are pure additions, no RENAMED, no drift)
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) adjudicated by baseline comparison; CI is the authority gate. Reviewer's Info-2 records the same CI-as-authority stance.
- Tree: 6ad71297db3c7512fa56ecca03712956a36a347b

## Commit Contents (8a1a2d31, 33 files, 687 insertions, 46 deletions)
- Blocker basis + shared vocabulary: src/core/issue-status/{types,projection,index}.ts
- Cross-project naming: src/core/issue-execution/binding.ts
- Render segment: src/commands/store-issue.ts (renderStatusNode gains statusById for cross-project lines)
- Tests: new degradation suite (issue-status-blocker-basis-degradation) + 4 prior files extended (start-cli, status-cli, execution-binding, status-projection; prior assertions unchanged per Info-1)
- architecture-index: quick-locate row + spec-store-engine module notes (2 files)
- Change dir: proposal, design, 2 spec deltas (issue-execution-binding, issue-status-projection), tasks, 15 evidence files (11 temp receipts, 3 persistent captures, review report)

## Exclusions (intentional)
- Untracked siblings left for parent-level delivery: rasen/changes/issue-cross-project-execution/, issue-project-grouped-views/
- .rasen/ ephemera (incl. dated mirrors and close-*.json) - not committed
- The persistent store at Reference/rasen-issue-store and the main checkout's tooling writes - expected, outside this commit, untouched

## Next Steps
- Portfolio delivery (LEAD): child 3 completes, then single portfolio-level delivery + full-suite/CI gate
- Retention: rasen-retain issue-cross-project-gating
- Archive: on-merge timing - rasen-archive-change follows portfolio delivery

## Archive
**Date:** 2026-08-20T13:12:21.782Z
**Ship commit:** 8a1a2d3166cb14d52b87c07290d14d1327757500
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-20-issue-cross-project-gating
**Transaction:** 7ddcfb10-fe0f-4af6-93ce-0005cb307c91
