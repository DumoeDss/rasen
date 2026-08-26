# Ship Log: issue-revision-history-preservation

**Date:** 2026-08-22 15:57
**Mode:** local
**Branch:** feat/issue-phase5
**Commit:** c0ace35e6d500706e36c0483c9f79ef7908d5434
**Tree:** babf789bd917c76b5f201156286bb4261b06e847
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass — review-report.md round-1 APPROVE (0 Blocker / 0 Major / 0 minor /
  2 Info; real-store byte-identity corroborated by the reviewer, mutations 2/2), then
  doc-only fix round (2 Minors: local-gates.md 5.2 record-of-authority rename,
  proposal.md Impact enumeration), then round-1 re-review CLEAN — APPROVE stands.
- Tasks: 20/20 complete (0 open)
- Mtime audit: no file under src/, test/, .claude/skills/, or the change dir is newer
  than review-report.md (re-review is the last write)
- validate issue-revision-history-preservation --type change: exit 0 (re-run at ship)

## Test Gate
- Required scope: exclusions-carry on IssueAcceptedRecordV1 (both compatibility
  edges) + continuity/retarget lineage pins + acceptance renderers (localized change
  with reviewer-reproduced gates and mutation checks)
- Tests: skipped at ship — scoped green evidence at evidence/local-gates.md,
  evidence/binned-suite-adjudication.md, evidence/focused-summaries.txt (per dispatch;
  not re-run). Reviewer re-ran the change's own surface solo 25/25 green;
  in-suite + reviewer-executed mutation paths bite (2 + 2).
- Full suite: deferred — LEAD decision 2026-08-17 adjudicates the known 7-file
  machine-state failure cluster (hermes et al.) as local-state, CI is the authority
  gate; portfolio delivery runs CI.
- Tree: babf789bd917c76b5f201156286bb4261b06e847

## Anomalies: evidence normalization for the whitespace gate
Two evidence files tripped `git diff --cached --check` (pre-commit hook; CI runs the
same check), so byte-exact-as-written could not ship. Both normalizations are minimal,
no content words altered; re-derivation = re-append the removed bytes.
1. focused-summaries.txt line 17: one blank line at EOF. Removed exactly one trailing
   newline. Pristine sha256 9c488d14300b2cacb9f45f5866f3ed0492a709bf4e7709b1f2a8fd69ec1471c0
   -> shipped 32aec6510da9e6b6fd9c6c708bbe455ad22c50d409ffc7f25eef3415eff45792.
2. review-report.md line 74 (reviewer-authored): two trailing spaces after
   `issue-multi-change-execution` (3/3),. Both stripped; line ends `(3/3),` now.
   Pristine sha256 8b325696a72f332dcc2543d059662396a756082b78c17556524761e1c1584947
   -> shipped 695f06d60177c0a8398fa9b9ab6e43abfdbda0eaab0a3f500f7b0bb46be8ba5b.

## Brief-vs-reality deltas (minor, non-blocking)
- Dispatch named `src/core/store/issues/{module,records?}.ts`; no records.ts exists —
  the carry lands in module.ts + acceptance.ts + types.ts, plus
  src/core/issue-acceptance/orchestration.ts and the store-issue.ts renderers.
- Reviewer Info-2 honored: new CRLF-on-disk test files added under DEFAULT autocrlf
  (no `-c core.autocrlf=false add`).

## Commit Contents (24 files, +2670/-5)
- Carry: src/core/store/issues/{acceptance,module,types}.ts (IssueAcceptedRecordV1
  exclusions-carry, empty->absent canonicalization) +
  src/core/issue-acceptance/orchestration.ts
- Renderers: src/commands/store-issue.ts (accept seam display)
- Pin suites: revision-continuity, retarget-lineage, superseded-totality,
  store-issue-acceptance-exclusions, store-issue-acceptance-exclusions-cli
- Index: architecture-index spec-store-engine.md
- Change dir: proposal, design, tasks, 2 spec delta files, evidence chain

## Exclusions (expected, untouched)
- Sibling change dirs: issue-cross-project-replanning/, issue-needs-attention/
- .rasen/ ephemera; LEAD's untracked probe files (scripts-tmp-*.py, .rasen/*.json);
  persistent store at Reference/rasen-issue-store; main-checkout tooling writes

## Next Steps
- Portfolio-level delivery (single delivery after all Phase 5 children ship)
- Retention + archive follow merge confirmation (on-merge timing)

## Archive
**Date:** 2026-08-22T07:58:14.055Z
**Ship commit:** c0ace35e6d500706e36c0483c9f79ef7908d5434
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-22-issue-revision-history-preservation
**Transaction:** 560f4394-92ab-482b-993d-ca51a8ede727
