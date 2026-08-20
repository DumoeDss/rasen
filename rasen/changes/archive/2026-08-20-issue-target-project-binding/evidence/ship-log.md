# Ship Log: issue-target-project-binding

**Date:** 2026-08-20 19:29 local
**Mode:** local
**Branch:** feat/issue-phase3
**Commit:** 1049453bb5c1552f7b9223adc39f5b37c7653d10
**Tree:** 6571a20fcbc7d241a65112e165ce2bb9897faffe
**Status:** Committed (delivery deferred to portfolio level)

Child 1/3 of the Phase 3 portfolio. Delivery happens once at the parent level
after all three children complete; nothing pushed, no PR. Parent commit at
ship: 24d7f58e (issue-multi-change-execution archived; PR #171 merged).

## Pre-Flight Results
- Verification: pass - review-report.md is a reviewer FIRST-PASS CLEAN - SHIP (0 Blocker / 0 Major / 0 Minor / 3 Info, none requiring action: Info-1 interface-letter divergence from tasks/design wording with intent honored, Info-2 one retained scenario THEN-body widened with title unchanged, Info-3 cosmetic refusal-diagnostic redundancy). No fix round existed or was needed. validate green at ship time.
- Tasks: 18/18 complete
- Mtime audit at ship: no src/test/skill/change file newer than review-report.md

## Test Gate
- Required scope: affected src files plus their families - plan-node schema + membership validation (store/issues), IssueReferenceCatalogs shape + constructors, node-line format (store-issue CLI), status projection degradation, migration replay callers, three-way-sync trio
- Rationale: schema + validation change inside the store issue core with a CLI format contract change; the reviewer's batch set covers every touched src file plus families, with mutations proving the intended tests discriminate
- Tests (reviewer-reproduced, real exit codes, dist freshness verified):
  - Total re-run: 24 files / 278 passed + 2 pre-existing skips / 0 failed / all exit 0 (new unit 8; CLI 20; family 137+1 skip; trio 70+1 skip; migration replay 43)
  - Mutations: 3/3 caught with clean discrimination (knowledge-only gate tests; byte pin alone; all digest literals)
  - Persistent store: byte-stability triple-proven - sha256 identical across an independent read; receipt-vs-live node-set, plan digest, revision hash all agree
- Full local suite: DEFERRED to portfolio delivery by LEAD decision (2026-08-17). Basis: the known pre-existing machine-state failure cluster (7-file hermes state leak) adjudicated by baseline comparison; CI is the authority gate. The reviewer's report records the same deferral.
- Tree: 6571a20fcbc7d241a65112e165ce2bb9897faffe

## Commit Contents (1049453b, 42 files, 2956 insertions, 28 deletions)
- Schema + validation: src/core/store/issues/{types,module,reference-verification}.ts - plan-node target-project field, planning-membership refusals, IssueReferenceCatalogs projects[] with roles
- Migration: src/core/store/layout-migration/plan.ts (target-project through migration replay)
- Projection: src/core/issue-status/{projection,types}.ts (per-node target projects in both forms)
- CLI node-line format: src/commands/store-issue.ts (no new options - no locale/completions entries needed)
- Tests: 3 new suites (schema 8 incl. degradation, CLI) + 3 prior CLI suites updated for the format contract change (strength-preserved) + extended family suites + fixture helper
- architecture-index: spec-store-engine module note + quick-locate row
- Change dir: proposal, design, 3 spec deltas (issue-plan-publication, issue-status-projection, store-issue-resources), tasks, 17 evidence files (11 temp-store receipts, 4 persistent read-only captures, persistent summary, review report)

## Exclusions (intentional)
- Untracked siblings left for parent-level delivery: rasen/changes/issue-cross-project-execution/, issue-cross-project-gating/, issue-project-grouped-views/
- .rasen/ ephemera incl. this change's ephemera/research dogfood script and auto-run.json (their intent-to-add markers were cleared before commit; never staged, never committed)
- The persistent store at Reference/rasen-issue-store and the main checkout's tooling writes - expected, outside this commit, untouched

## Ship-stage anomaly (recorded)
The working tree arrived with intent-to-add markers (git add -N) on the new files rather than real staging; two .rasen ephemera files carried markers too. Markers on ephemera were cleared, evidence/review-report.md (untracked at ship start) was added, and the intended 42-file set was staged fresh before the narrow-pathspec commit.

## Next Steps
- Portfolio delivery (LEAD): children 2-3 complete, then single portfolio-level delivery + full-suite/CI gate
- Retention: rasen-retain issue-target-project-binding
- Archive: on-merge timing - rasen-archive-change follows portfolio delivery; archive sync should expect Info-1's interface-letter divergence and Info-2's widened THEN body (titles stable)

## Archive
**Date:** 2026-08-20T11:30:15.630Z
**Ship commit:** 1049453bb5c1552f7b9223adc39f5b37c7653d10
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-20-issue-target-project-binding
**Transaction:** 1376bbb9-f4cf-40f1-8eca-bf03a24683dd
