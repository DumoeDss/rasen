# Fix round 1 — issue-revision-history-preservation (implementer, 2026-08-22)

Disposition of reviewer-1's round-1 findings (APPROVE, 2 Minor + 2 Info). No
code, no tests touched — both Minors are documentation-only, exactly as
routed.

- **Minor-1 — FIXED.** `evidence/local-gates.md`: the header no longer
  promises a `bin-summaries.txt` (focused summaries only, as on disk), and
  the task-5.2 section's `BINNED-TABLE-PENDING` placeholder is replaced by a
  pointer to `binned-suite-adjudication.md` (the LEAD-executed record of
  authority) with the implementer's pre-stop box results stated
  (box-01 25/383 exit 0; box-02 25/381+1 skipped exit 0).
- **Minor-2 — FIXED.** `proposal.md` Impact gains the two-file line:
  `src/core/store/issues/module.ts` (the `StoreIssues.accept` seam writing
  the field, empty accounting canonicalized to the absent form) and
  `src/commands/store-issue.ts` (the renderers), matching design D3's
  coverage.
- **Info-1** (task 3.3's `store issue acceptance` naming vs the real record
  surfaces) — already dispositioned in `implementer-findings.md` #3; no
  action.
- **Info-2** (worktree hygiene) — the implementer's own scratch runner
  `scripts-tmp-binned-suite.py` deleted this round; the remaining untracked
  LEAD tooling (`.rasen/run-bins.mjs`, probe JSONs) is left for the shipper's
  pathspec as the reviewer instructs.

Post-fix check: `node bin/rasen.js validate issue-revision-history-preservation`
— exit 0 (`evidence/validate.txt` refreshed).
