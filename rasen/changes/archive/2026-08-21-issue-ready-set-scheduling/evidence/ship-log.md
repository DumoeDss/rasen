# Ship Log: issue-ready-set-scheduling

**Date:** 2026-08-22 07:20
**Mode:** local
**Branch:** feat/issue-phase5
**Commit:** 3f06549614ad5e738cd9a3ed33c5f17be552df24
**Tree:** f825cd0a848609ca27dcacff32df1f2206e25519
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass — review-report.md round-1 (NOT CLEAN, Major 5 only, one-clause
  spec wording) -> round-1b CLEAN; fix-round-1.md closed 0 Blocker / 2 Major / 2 Minor.
  Reviewer re-ran validate (exit 0) on the round-1b delta.
- Tasks: 20/20 complete (0 open)
- Mtime audit: no file under src/, test/, .claude/skills/, or the change dir is newer
  than review-report.md (post-review tree untouched)
- validate issue-ready-set-scheduling --type change: exit 0 (re-run at ship)

## Note 6 Resolution (single commit vs pin-first split)
- Decision: ONE commit. Repo history shows every child change ships as a single
  conventional commit (one feat()/fix()/test() per child, archive chore follows at
  portfolio level); no precedent for a pin/refactor two-commit split. The pin-first
  discipline is carried by the suite structure (issue-ready-set.test.ts pins precede
  the equivalence suite) and the review evidence, not by commit granularity.

## Test Gate
- Required scope: ready-set derivation + binding/confirm refactor + read-side ruling +
  ready CLI (localized change with regression suites and reviewer-reproduced gates)
- Tests: skipped at ship — scoped green evidence at evidence/local-gates.md and
  evidence/bin-summaries.txt (per dispatch; not re-run). Reviewer re-ran after
  round-1+1b: equivalence 12/12, issue-execution family 4 files/67 tests, ready CLI
  8/8, its own 4-bin store family 83 files/1506 tests, zero-mirror independently
  reproduced. Gates 0 Blocker / 0 Major / 0 minor open.
- Full suite: deferred — LEAD decision 2026-08-17 adjudicates the known 7-file
  machine-state failure cluster (hermes et al.) as local-state, CI is the authority
  gate; portfolio delivery runs CI.
- Tree: f825cd0a848609ca27dcacff32df1f2206e25519

## Anomaly: evidence normalization for the whitespace gate
- bin-summaries.txt ended with a doubled newline (one blank line at EOF), which the
  pre-commit hook rejected via `git diff --cached --check` (line 18); CI runs the
  same check, so byte-exact-as-written could not ship. Removed exactly one trailing
  newline (content lines untouched).
- Pristine sha256: 1064c723ee93b623606fe34629aeed3cec5f61c726f4b3ebb6a3e2203f876671
- Shipped sha256: f0c0f538d5b52126121f00b457cd5ab38b8a2af024a911a054037203234ef54e
- Re-derivation of pristine: re-append one trailing newline to the shipped file.

## Commit Contents (38 files, +3935/-61)
- Shared derivation: src/core/issue-status/ready-set.ts (new); binding.ts / confirm.ts
  refactored onto it; index.ts / projection.ts / types.ts extended
- Read-side legacy ruling: src/core/store/query/module.ts + types.ts (basis split)
- Ready CLI: src/commands/store-issue.ts + completions/command-registry.ts +
  management-api/wire-types.ts + locales en/ja/zh-cn
- Suites: issue-ready-set, issue-ready-set-equivalence, store-issue-ready-cli,
  issue-status-legacy-archive-ruling, store-archive-outcome-basis (new);
  binding/confirm/read-only-guard extended
- Index: architecture-index spec-store-engine.md + quick-locate.md
- Change dir: proposal, design, tasks, 3 spec deltas (ready-set NEW, projection
  MODIFIED, execution-binding MODIFIED), evidence chain

## Exclusions (expected, untouched)
- Sibling change dirs: issue-cross-project-replanning/, issue-revision-history-preservation/,
  issue-needs-attention/
- .rasen/ ephemera; persistent store at Reference/rasen-issue-store; main-checkout
  tooling writes (config.yaml hint, .rasen-store/) — outside this worktree's commit

## Next Steps
- Portfolio-level delivery (single delivery after all Phase 5 children ship)
- Retention + archive follow merge confirmation (on-merge timing)

## Archive
**Date:** 2026-08-21T23:21:10.521Z
**Ship commit:** 3f06549614ad5e738cd9a3ed33c5f17be552df24
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-21-issue-ready-set-scheduling
**Transaction:** 123fe60c-f17a-42a9-a2a3-3a601afdbbb8
