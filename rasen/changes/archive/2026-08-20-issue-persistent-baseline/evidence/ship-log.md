# Ship Log: issue-persistent-baseline

**Date:** 2026-08-20 15:29 local
**Mode:** local
**Branch:** feat/issue-phase2
**Commit:** 889f1ef7285730bae134b20291898cab64f416c8
**Tree:** deed192137691e2c7a1c4643c3ddd21907be2be3
**Status:** Committed (delivery deferred to portfolio level)

Child 3/3 (finale) of portfolio issue-multi-change-execution. Delivery happens
once at the parent level now that all three children are committed; nothing
pushed, no PR. Parent commit at ship: 0788fc51 (issue-node-lifecycle archived).
Siblings shipped: g-001 bfb63865, g-002 31d0b644.

## Pre-Flight Results
- Verification: pass - review-report.md round-1 PASS (0 Blocker / 0 Major / 2 Minor, both receipt-documentation only) with round-1 re-review CLEAN, no new findings; validate green at ship time (rasen validate issue-persistent-baseline)
- Tasks: 14/16 complete. The two open items (4.3, 4.4) are the LEAD's portfolio-close loop steps by design - 4.3 IS this ship/archive drive, 4.4 is the portfolio-close gate evaluation + store issue accept; neither is closable before this commit exists. M2's sequencing guard applies: run both from the worktree BEFORE any cleanup/reset (terminal observations depend on worktree-local, never-committed dated mirrors + undated sources)

## Test Gate
- Required scope: store-family focused suites (store setup path, workspace-root scaffolding, completions registry, locale structure, new CLI suite)
- Rationale: one bounded option on an existing command plus a scaffolding branch in ensureOpenSpecRoot; no module moves; the affected set bounds the risk
- Tests (green chain, reviewer-reproduced; fix round touched evidence files only, so gate results stand for the code tree):
  - Affected set: 19 files / 273 tests, exit 0
  - Prior tests zero-touched; issue trio 34/34; fences (pipeline-registry / packages/ui / package.json) 0 bytes
  - Fix round 1: two one-sentence evidence edits (5-1-durability.md, 4-issue-loop.md) - no code, tests, or re-runs required; re-review verified both CLEAN and re-checked fences
  - Mtime audit at ship: no src/test file newer than the re-review
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) was adjudicated by baseline comparison on 2026-08-17; CI is the authority gate. Same deferral as g-001/g-002. The portfolio-level full-suite run is now due (all three children committed).
- Tree: deed192137691e2c7a1c4643c3ddd21907be2be3

## Commit Contents (889f1ef7, 30 files, 1882 insertions, 6 deletions)
- --layout 2 flag: src/commands/store.ts (fail-fast parse, store_setup_layout_invalid refusal), src/core/store/operations.ts, src/core/workspace-root.ts (layout-2 scaffold: no flat planning tree, no anchors)
- Completions registry layout flag + option-level locale entries in en/ja/zh-cn
- New CLI suite: test/commands/store-setup-layout-cli.test.ts
- architecture-index: NO update needed - tasks.md records the rationale (no module moves; one option on an existing command); reviewer raised no disagreement
- Change dir: rasen/changes/issue-persistent-baseline/ (proposal, design, 1 spec delta store-planning-layout-v2, tasks, 17 tracked evidence files)

## Exclusions (intentional)
- rasen/changes/issue-multi-change-execution/ (parent) - left for the portfolio-level delivery
- .rasen/ ephemera incl. the dated run-state mirrors (2026-08-20-issue-node-lifecycle/, 2026-08-20-issue-plan-publication/) - machine-local by design, never committed (see M2)
- evidence/5-2-gates.log - repo .gitignore line 3 (*.log); not force-added; remains on disk for the archive engine's content-addressed payload
- The persistent store at Reference/rasen-issue-store and the main checkout's tooling writes (config.yaml hint, .rasen-store/) - expected, outside this commit, untouched

## Next Steps (portfolio close - LEAD)
- Tasks 4.3/4.4 from the worktree BEFORE any cleanup: capture the 3/3 + review projection receipt, evaluate the gate, rasen store issue accept, confirm the Issue reads resolved and done, commit the acceptance record on the store
- Single portfolio-level delivery (push/PR) + full-suite/CI gate (deferral consumed here)
- Retention: rasen-retain issue-persistent-baseline; archive: on-merge timing - rasen-archive-change follows portfolio delivery

## Archive
**Date:** 2026-08-20T07:34:13.817Z
**Ship commit:** 889f1ef7285730bae134b20291898cab64f416c8
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-20-issue-persistent-baseline
**Transaction:** 2ef78ca0-ca97-4bcb-88a2-51660aca8719
