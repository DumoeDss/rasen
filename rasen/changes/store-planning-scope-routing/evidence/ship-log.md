# Ship Log: store-planning-scope-routing

**Date:** 2026-08-07T00:00:00+08:00
**Mode:** local
**Branch:** feat/store-project-partitions-planning-worktrees
**Commit:** SELF (this log is included in the single local ship commit; the literal final SHA is reported by the shipper after Git creates it)
**Tree:** SELF (same self-reference constraint; the literal final tree is reported by the shipper after commit)
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results

- Verification: passed — review-clean after 3 review-cycle rounds (Tier A, Codex native, author != verifier throughout). Round 3's delta was independently re-confirmed with 11 of 12 findings resolved and one carried as a stated non-blocking observation (R3-7).
- Tasks: 56/56 complete.

## Test Gate

- Required scope: whole-repository `pnpm test`, exclusive checkout, no concurrent vitest process alive.
- Result: **5 failed / 6191 passed / 34 skipped (355 files, 733s).**
- Disposition: all five failures are the environmental `%LOCALAPPDATA%\rasen` cluster — `config.test.ts` ×1 and `config-editor.test.ts` ×4 (the two Japanese/Chinese-localization cases among them are the same underlying string surfacing through a different assertion, not locale defects). Proven environmental by controlled experiment: same code, with `TMP`/`TEMP` repointed off `%LOCALAPPDATA%` → 87/87 pass. `planning-home.ts` is byte-unchanged from baseline and `config.ts` is unmodified by this change. Nothing owned by this change is red.
- Progression across the five authoritative whole-repository runs that led here:

  | Run | Tree | Result |
  | --- | --- | --- |
  | 1 | round-1, contaminated by concurrent vitest | 22 failed / 6167 passed |
  | 2 | round-1, exclusive | 18 failed / 6171 passed |
  | 3 | round-2, exclusive | 6 failed / 6189 passed |
  | 4 | round-3, exclusive | 7 failed / 6189 passed (moved 4 pinned template hashes) |
  | 5 | round-3 + re-baseline, exclusive | **5 failed / 6191 passed** |

- Full detail: `evidence/review-cycle-report.md` (final-gate section) and `evidence/review-report-r3.md` §12.6 (conditional sign-off this gate satisfies).

## Review Rounds

Three review-cycle rounds, each with an independent reviewer (author != verifier):

- **Round 1:** initial review against the delta specs and design; fixer resolved the triaged findings, including separating a genuine round-1 contamination artifact (concurrent vitest against a shared `dist/`) from real failures.
- **Round 2:** re-review of the round-1 fix delta; brought the authoritative whole-repository run down to 6 failed / 6189 passed, 0 owned by this change.
- **Round 3:** re-review of the round-2 fix delta, including an ordering-hole fix in `storePermitsProject`, a pinned skill-template-hash re-baseline (82 hashes moved, independently recomputed from source with 0 mismatches — the shared `STORE_SELECTION_GUIDANCE` constant is embedded in ~41 templates and this change rewrites it), and an inverted-test sweep (net-deleted test titles fell from 17 to 8, all accounted for as deletions of retired capabilities, renames, or LEAD-approved refusals). Verdict: **CLEAN**, conditional only on the LEAD's in-flight full run showing solely the five environmental failures — which it did.

## Delivery

Local commit only. No push, pull request, merge, deployment, or archive was performed as part of the implementation commit. The portfolio opens a single PR later, once all children are shipped and archived. This change's archive is performed as a separate, subsequent local commit in the same delivery pass.
