# Portfolio close — issue-autodecompose-uplift (LEAD, 2026-08-21)

Delivery: PR #173 MERGED (merge `23513cd2`, CI green on round 4 after two budget
fixes — Windows shard timeouts 30→40m as suite growth crossed the job budget, and
the archive fault-matrix describe to 60s as three members crossed the per-test
budget; both zero-assertion-failure classes, both fixes committed on the PR).

## Issue #3 golden close (executed by the LEAD directly)

1. Seed: review-flow's archived evidence into the store partition with a properly
   derived v2 identity (deriveChangeInstanceId — the naive ci_<seed> shape caught and
   corrected before commit); store commit `e982cda`.
2. Revision 0004: review-flow intent→change bound to the seeded instance; store
   lineage now 0001→0004, ordinal add-never-rewrite throughout.
3. Visibility: per-child run-states corrected to the archive-done truth, mirrored to
   dated claimant keys, openFindings normalized string→{summary} (the third mirror;
   the claimant-alias keying ownership remains Phase 5's ledger item).
4. Gate → accept: conditions 0001 (four real criteria) → gate 2/2 · waiting-human ·
   0 problems → accept → **done · healthy · 2/2** with the acceptance record
   committed store-side (`a478d37`).

The legacy-seed-reads-fresh finding stood live until the mirrors landed — the
deterministic scheduler (Phase 5) inherits that decision.
