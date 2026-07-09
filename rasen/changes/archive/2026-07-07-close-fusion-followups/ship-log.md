# Ship Log: close-fusion-followups

**Date:** 2026-07-07
**Mode:** push
**Branch:** dev-harness
**Commit:** bd3d7fa6e7c1bbcb7a217a728b8a6fc5a838e865
**Tree (post-commit `HEAD^{tree}`):** 49d2e2a0f612dc1138630690ab94a9bd4310b4bf
**Status:** Pushed (`252230b..bd3d7fa dev-harness -> dev-harness`, fast-forward, no force)

## Pre-Flight Results
- Verification: pass — `review-report.md` APPROVE (0 Blocker, 0 Major, 1 optional Minor); `review-cycle-report.md` CLEAN (round 1 terminated).
- Tasks: 17/17 complete (1.1-1.5, 2.1-2.3, 3.1-3.4, 4.1-4.4, 5.1).

## Test Gate

**Tests: ran green** (fresh, twice — see below). The recorded review evidence fingerprint (`5a1d585`) was the *prior* commit's tree and did not include this change's content; per the F2 evidence-based test gate this change itself sharpens, a tree mismatch means "no green evidence for the current code state" → RUN, not skip.

### Run 1 — initial post-commit gate (commit `01dfdb3`, pre-rebase)
- `pnpm test` → **2093 passed, 0 failed, 22 skipped** (2115 total), 202.55s. Clean green, no flake.
- Post-commit tree at the time: `9f7099868255074c7bd26c9e5af5536beb28a66e` (differs from `5a1d585` → fresh run was required and passed).

### Remote integration — rebase onto `origin/dev-harness`
- Initial push was **rejected** (non-fast-forward): remote `dev-harness` had advanced by one commit, `252230b feat(profiles): add 'full' profile and make it the default install`, pushed after this change's review evidence was recorded. No file overlap between the two commits (profiles commit touches config/init/profiles/docs; this change touches archive/specs-apply/templates/tests), so rebase applied cleanly with no conflicts.
- Rebased `01dfdb3` onto `252230b` → new commit `bd3d7fa`, tree `49d2e2a`. This tree now includes the profiles content, which Run 1's evidence did **not** cover → per F2, a second fresh run was required.

### Run 2 — post-rebase gate (commit `bd3d7fa`, integrated with profiles commit)
- `pnpm test` → **2095 passed, 1 failed, 22 skipped** (2118 total), 218.25s. The single failure was `test/commands/validate.test.ts > errors on ambiguous item names and suggests type override` (10000ms timeout + `EBUSY: resource busy or locked, rmdir 'test-validate-command-tmp'`).
- **Flake isolation:** `test/commands/validate.test.ts` is **untouched** by both this change and the profiles commit (verified: not in the integrated range `0ca96dc..bd3d7fa`). The EBUSY-rmdir-on-fixed-name-temp-dir pattern is the documented Windows spawn/temp-dir flake class (memory: Windows test flakiness — `spec.test.ts` timeout / `artifact-workflow.test.ts` EBUSY).
  - First isolate rerun also tripped EBUSY but on a **different test** (`resolves and validates a scaffolded change…`), 13/14 — the varying-test signature of a nondeterministic handle race, not a logic failure.
  - After cleaning the stale `test-validate-command-tmp` dir and a brief handle-release pause, a clean isolate rerun of `test/commands/validate.test.ts` → **14/14 green** (both previously-failing tests passed in ~2s).
- **Conclusion:** integrated state is green modulo the confirmed Windows temp-dir EBUSY flake on an untouched file. Push proceeded.

## Deployment
Status: Pushed to `origin/dev-harness`. No PR (repo convention: direct commit + push on the working branch). No merge of any base branch.
