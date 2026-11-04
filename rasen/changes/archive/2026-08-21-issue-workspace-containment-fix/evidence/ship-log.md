# Ship Log: issue-workspace-containment-fix

**Date:** 2026-08-21 14:36 local
**Mode:** local
**Branch:** feat/issue-phase4
**Commit:** d3f60e8c517241fc0145cebe6dc188ba7e3f936f
**Tree:** add5de3e666d26bf95a3373a26fe34ee12e2b25e
**Status:** Committed (delivery deferred to portfolio level)

Child 1/3 of the Phase 4 portfolio (autodecompose line). Delivery happens once
at the parent level after all three children complete; nothing pushed, no PR.
Parent commit at ship: 40551f92 (merge of origin/dev/0.2.0, close push).

## Pre-Flight Results
- Verification: pass - review-report.md APPROVED for ship (0 Blocker / 0 Major / 1 Minor / 2 Info; all gates green under the reviewer's own runs). Minor-1 (applicable surface widens to any repository's main checkout, incl. one nested inside another repo's checkout) accepted as recorded with a RECOMMENDED PORTFOLIO-LEDGER LINE for the g-002/g-003 planning context rather than action in this child - no fix round. validate green at ship time.
- Tasks: 11/11 complete
- Mtime audit at ship: no src/test/change file newer than review-report.md

## Test Gate
- Required scope: workspace plan veto site + its plan/apply suites, the full store family (shared containment vocabulary), workspace CLI, locale structure
- Rationale: a one-case exemption at a veto call site inside the workspace planner; the reviewer closed the full store family plus the named set and confirmed one-case discipline by code reading and mutations
- Tests (reviewer-run, real exit codes):
  - pnpm run build exit 0
  - Full store family test/core/store/: 80 files / 1484 passed + 2 pre-existing skips (both in untouched files), sharded into 4 batches after a 10-min single-run timeout, comm-verified zero files missed, all exit 0
  - Named set reproduced independently: workspace-plan 24, workspace-cleanup 26, workspace-apply 19, workspace-windows-paths 23, workspace-cli 14 - 106/106 green
  - Locale leg 50 passed; candidate trio suites (finalize-scope, store-planning, workspace-migration, workspace-manifest) 62 green
  - One-case discipline CONFIRMED: exemption keyed at plan.ts:595-598; identity.ts byte-untouched; mutations A/B/C applied to working copies, run, restored; plan.ts hash 66039447 re-verified; final tracked diff = the exact pre-review 3-file fingerprint
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) adjudicated by baseline comparison; CI is the authority gate.
- Tree: add5de3e666d26bf95a3373a26fe34ee12e2b25e

## Commit Contents (d3f60e8c, 14 files, 94 insertions, 5 deletions)
- The one-case exemption: src/core/store/workspace/plan.ts (blessedMainCheckout keyed to side === execution + facts.linked === false + samePath(root, repositoryRoot); strictly-inside paths still vetoed; planning side keeps the equality veto)
- Tests: workspace-plan.test.ts (+47, strengthened applicability assertions + both-direction pins), workspace-apply.test.ts (+29)
- Change dir: proposal, design, 1 spec delta file (store-planning-worktree-bindings), tasks, 6 evidence files (5 dogfood receipts temp-pair-* moved to evidence/ during review at their tasks-3.x home + review report)

## Exclusions (intentional)
- Untracked siblings left for parent-level delivery: rasen/changes/issue-autodecompose-uplift/, issue-autodecompose-graph/, issue-autodecompose-review-flow/
- .rasen/ ephemera (incl. leg4/close/pair JSONs, archive-probe) - not committed
- architecture-index: NOT touched by this change (conditional resolved to no; no .claude/skills modification existed)
- The persistent store and the main checkout's tooling writes - outside this commit, untouched

## Handoff notes
- Minor-1 portfolio-ledger line recommended for g-002/g-003 planning context (nested-repository main-checkout surface) - LEAD to carry at portfolio close
- Info-1: the linked === false key is behaviorally redundant in every reachable state and kept as fail-closed defensive keying per design D2 - recorded so archive review does not re-derive
- Info-2: direction-1 dogfood receipt incidentally demonstrates the Windows-alias (separator) scenario end to end

## Next Steps
- Portfolio delivery (LEAD): children 2-3 complete, then single portfolio-level delivery + full-suite/CI gate
- Retention: rasen-retain issue-workspace-containment-fix
- Archive: on-merge timing - rasen-archive-change follows portfolio delivery

## Archive
**Date:** 2026-08-21T06:38:19.876Z
**Ship commit:** d3f60e8c517241fc0145cebe6dc188ba7e3f936f
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-21-issue-workspace-containment-fix
**Transaction:** da9e6c81-757a-4dcc-8d10-ae3332160ea9
