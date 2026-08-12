# Ship Log — backport-archive-validate-defects

- **Change:** backport-archive-validate-defects
- **Delivered:** 2026-08-10
- **Delivery mode:** pr
- **PR:** #153 — https://github.com/DumoeDss/rasen/pull/153
- **Branch:** fix/020-archive-validate-defects → dev/0.2.0
- **Ship commit:** a1a372a2
- **Base at ship:** 2a8fa170 (dev/0.2.0; includes merged #151)

## Delivered
Six archive/validate defect fixes (B1, B2, B3, B4, B6) re-implemented on 0.2.0's architecture. B1 and B6 are Blockers; each has a mutation-discriminating guard test.

## Review
Independent review, two rounds: round 1 found 1 Major (B4 missing-required-field gap) → fixed; round 2 clean (0 findings). Report: `evidence/review-report.md`.

## Pre-ship verification
- 20 new tests + existing archive/validation suites green (176 pass, 1 skip).
- `tsc --noEmit` + ESLint clean on touched files.
- `rasen validate --strict` passes on this change's own delta.
- `rasen archive --dry-run` projects `blockers: []`.

## Status
PR #153 open against dev/0.2.0. Archive (`on-merge` timing) proceeds after the PR merges.

## Archive
**Date:** 2026-08-12T08:16:36.004Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\merge-017-into-020\rasen\changes\archive\2026-08-12-backport-archive-validate-defects
**Transaction:** 0b56722d-b334-44c3-95d3-b5c4600905e2
