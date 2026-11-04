# Ship Log: issue-needs-attention

**Date:** 2026-08-22 19:34
**Mode:** local
**Branch:** feat/issue-phase5
**Commit:** 60366c1fae5df61145e31577cfc83108dc8fbe54
**Tree:** c0657d7d7843df6cece8eed9d578c65473787d86
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass — review-report.md FIRST-PASS PASS, 0 Blocker / 0 Major / 0 minor /
  3 Trivial (reviewer live-verified against the store; mutations 2/2). All three
  Trivials dispositioned no-action-for-ship: (1) local-gates.md family-row file
  count 17 vs actual 18 — correct if the table is ever revisited; (2) no dedicated
  invalid-archive-record pin feeding deriveIssueAttention — directness gap, not
  truth gap (projection side pinned in legacy-archive-ruling test); (3) --issue
  refusal keyed on listIssues membership = honest under unsearched-refs visibility,
  Phase 6 semantics note. Reviewer bottom line: "Ship-ready from this review's side."
- Tasks: 17/17 complete (0 open)
- Mtime audit: no file under src/, test/, .claude/skills/, or the change dir is newer
  than review-report.md
- validate issue-needs-attention --type change: exit 0 (re-run at ship)

## Test Gate
- Required scope: five-kind attention vocabulary over the projection + store
  attention read verb reusing show's composition seams + CLI (localized change with
  reviewer-reproduced gates, mutation checks, and the Issue #4 dogfood receipts)
- Tests: skipped at ship — scoped green evidence at evidence/local-gates.md and
  evidence/binned-suite-adjudication.md, corroborated by the six Issue-4 receipts
  (receipt-1 authoring, receipt-2 confirm, receipt-3 inflight json+txt, receipt-4
  show, receipt-5 staged-close, receipt-6 temp-store failure), each matching the
  live store byte-for-byte per the reviewer. New suites: issue-attention (13) +
  store-attention-cli (6).
- Full suite: deferred — LEAD decision 2026-08-17 adjudicates the known 7-file
  machine-state failure cluster (hermes et al.) as local-state, CI is the authority
  gate; portfolio delivery runs CI.
- Tree: c0657d7d7843df6cece8eed9d578c65473787d86

## Anomalies
1. Evidence normalization for the whitespace gate: proposal.md line 21 carried one
   trailing space after "(parked stages)," — `git diff --cached --check` (pre-commit
   hook; CI runs the same check) rejected it. Stripped the trailing space only; no
   content words altered. Pristine sha256
   f7e78d6f5415f004ba6954db1a6ce9950e3e31a5b98d258a0c60ced5956c42e2 -> shipped
   2fc7e665a77d928557146ce084236a2b7a76cec5f627c4b088b58b2fba24ae06.
   Re-derivation = re-append one space before the line-21 newline.
2. Untracked e2e residue directory .rasen-e2e-complex-O4jdJ9/ (205K,
   complete-apply.json / complete-propose.json / control-* / global-data) sits in
   the worktree root — test-run fixture residue, NOT part of the change. Left
   untouched, excluded from the commit. LEAD may want it cleaned.

## Commit Contents (38 files, +2839/-9)
- Vocabulary: src/core/issue-status/attention.ts (new) + types.ts + index.ts
  (five-kind derivation, purely read-side)
- Verb + CLI: src/commands/store.ts (store attention verb, reuses show composition
  seams) + export-only seams in store-issue.ts + completions/command-registry.ts
  + locales en/ja/zh-cn
- Suites: issue-attention.test.ts (13) + store-attention-cli.test.ts (6) new;
  command-registry.test.ts + issue-status-read-only-guard.test.ts extended
- Index: architecture-index cli-commands.md + spec-store-engine.md + quick-locate.md
- Change dir: NEW-capability spec delta, proposal, design, tasks, evidence chain
  incl. the six Issue-4 receipts

## Exclusions (expected, untouched)
- Sibling change dir: issue-cross-project-replanning/
- .rasen/ ephemera; LEAD's untracked probe files (scripts-tmp-*); e2e residue dir
  (see Anomaly 2); persistent store at Reference/rasen-issue-store; main-checkout
  tooling writes

## Next Steps
- Portfolio-level delivery (Phase 5 finale child shipped — portfolio ready once
  issue-cross-project-replanning completes)
- Retention + archive follow merge confirmation (on-merge timing)

## Archive
**Date:** 2026-08-22T11:35:42.498Z
**Ship commit:** 60366c1fae5df61145e31577cfc83108dc8fbe54
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-22-issue-needs-attention
**Transaction:** b52ad762-a3c3-4484-b558-9ed9dd2a904a
