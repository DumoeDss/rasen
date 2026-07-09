# Ship Log: upstream-cherrypick-batch1-win-flake

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** fdb4dc8465ba2c55b27dab3c84d3389df1da2303
**Tree:** a6d791aa8ce81e17b75caae05a53d73fc0a60599
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: passed (review-report.md — adaptive verify COMPLEX, reviewer APPROVE, 0 Blocker / 0 Major / 0 minor / 1 Trivial note-only)
- Tasks: 24/24 complete

## Test Gate
- Tests: skipped for this ship — green evidence already recorded: full suite at `VITEST_MAX_WORKERS=2` -> 2186 passed / 22 skipped / 0 failed, **zero EBUSY** (the historical Windows CLI-spawn flake is gone); targeted 9-file run 128/128 pass; reviewer independently re-ran `store-lifecycle` + `capstone-journeys` 10/10. No code changed since that evidence was recorded, so no re-run was needed for this commit.

## Notes
Port of upstream 296ecbc (Windows CI flake hardening): `cleanupTempPath` retry-on-rmdir helper, `taskkill`-based process-tree teardown in `test/helpers/run-cli.ts`, always-on spawn timeouts with tail-output diagnostics, and CI matrix consolidation (`test_pr` job removed in favor of a single `test_matrix` + `test_pr_required` gate, per-OS `vitest_workers` caps with Windows capped at 2).

Staged and committed exactly the change's touch-set: `.github/workflows/ci.yml`, `vitest.setup.ts`, `test/helpers/run-cli.ts`, `test/helpers/temp-cleanup.ts` (new), and the 9 CLI-spawning test files, plus the OpenSpec change directory. Verified via `git diff --cached --stat` before commit and `git status --porcelain` after — no foreign files (no `telemetry-backend/`, no `store-fix` change dir, no `src/`) were swept in. `auto-run.json` stayed untracked (gitignored) as expected.

Local mode: no push, no tag, no PR. Delivery to the shared integration point happens once at the portfolio/parent level after all sibling children complete.
