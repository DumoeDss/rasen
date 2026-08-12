# Ship Log: archive-and-validate-defects

**Date:** 2026-08-09T12:41:20Z
**Mode:** pr
**Branch:** fix/archive-transaction-recovery-follow-up
**Commit:** 56656aec56bdc89b325f6a6336c87380f713b6de
**Tree:** 2e85eb7bfce251f6988f7b0f61fae66f7d0c1d09
**Base:** dev/0.1.7
**PR:** https://github.com/DumoeDss/rasen/pull/148
**Status:** Draft PR Created (verification blocked)

## Pre-Flight Results

- Verification: blocked — required repository test gate remains non-green; review evidence is recorded in `review-cycle-report.md`
- Tasks: 77/78 complete — Windows CI evidence remains pending

## Test Gate

- Required scope: TypeScript, lint, full repository tests, focused archive/reconciliation/guard regressions, and Windows CI
- Rationale: the delivered change spans archive transaction persistence, validation, project registry ownership, management finalization, workflow templates, localization, and cross-platform path behavior
- Passed: `pnpm exec tsc --noEmit`
- Passed: `pnpm lint`
- Passed: focused workspace Git verb, planning path source, vocabulary, spec reconciliation, and archive destination checks
- Failed: `pnpm exec vitest run test/core/archive-engine-finalization-seams.test.ts --reporter=dot` — 10 passed, 5 failed; Store v2 fixtures are rejected with `archive_plan_path_unauthorized`
- Last full run: `env -u ZSH pnpm test` — 417 test files passed, 9 failed; 4,640 tests passed, 15 failed, 2 skipped (run before the latest focused fixture updates)
- Tree: 2e85eb7bfce251f6988f7b0f61fae66f7d0c1d09

## Deployment

Status: Blocked pending green verification and owner review
