# Ship Log: externalize-artifacts-machine-home

**Date:** 2026-07-09
**Mode:** local
**Branch:** main
**Commit:** ed1adbd8b30856bebb34f1d35aebf8234a055efd
**Tree:** 141ca0c9ee6a260f3feebd0176f0a853d08ba3f0
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results
- Verification: pass (review-report.md present in change directory)
- Tasks: complete (per tasks.md at commit time)

## Test Gate
- Tests: ran green — 122 files / 2230 passed / 0 failed / 22 skipped (full `npx vitest run`, after `node build.js` rebuild), tree `141ca0c9ee6a260f3feebd0176f0a853d08ba3f0`
- Rationale for re-run: prior green evidence (122 files / 2222 passed) was recorded against tree `a15a915f4c5d2ffb8d558030820209653bc72664`; a review-fix round modified 8 tracked files and added 2 untracked source files after that, invalidating the fingerprint. Re-ran full suite per evidence rules.

## Commit Verification
- Committed with explicit pathspec (shared working tree with a concurrent session's in-progress work).
- `git show --stat` confirms exactly 29 files changed, matching the change's declared file set — no foreign files swept in.

## Deployment
Not applicable (local mode) — delivery (push/PR) happens once at the portfolio/parent level after all sibling changes complete.
