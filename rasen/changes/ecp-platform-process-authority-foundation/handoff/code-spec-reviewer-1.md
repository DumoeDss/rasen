# Code/spec reviewer 1 handoff

## Verdict

`CODE/SPEC REVIEW VERDICT: FAIL — Blocker: 4, Major: 5, Minor: 0, Trivial: 0`

Fresh report-only review B completed over all 8 requirements, 38 scenarios, 8 product modules, 9 focused tests, 2 shared helpers, all Change evidence/handoffs, and the compatibility seam. No implementation, test, task, runstate, Direction, portfolio, native/OS, delivery, stash, or retained-temp mutation was made.

## Canonical findings

- **B-001 Blocker:** non-empty provider registries/coordinators accept exact dispatch with no manifest binding.
- **B-002 Blocker:** provider-reference reuse can receive a stale authentic exact-empty receipt without provider inspection.
- **B-003 Blocker:** provider settlement is accepted after the recorded monotonic deadline when the timer callback is delayed.
- **B-004 Blocker:** the unchanged conformance suite never exercises prepared abort and can falsely pass a non-conforming future provider.
- **M-001 Major:** valid recovered `published-inert` is converted to `control-loss` and has no recovery transition.
- **M-002 Major:** control outcomes may report statusless `root-exited`; the coordinator synthesizes null status.
- **M-003 Major:** the adapter's durable `publishAuthority` callback is outside the common deadline and can hang forever.
- **M-004 Major:** prepare timeout/control loss is rewritten as `authority-unavailable` and adapter `containment-unsupported`.
- **M-005 Major:** mutable/unbounded prepare/control inputs can diverge from ledger identity or throw before typed settlement.

Exact file:line citations, concrete failure paths, actions, requirement mapping, probe results, and exclusion/package findings are in `evidence/code-spec-review-round-1.md`.

## Next owner

Route all nine items to a non-author fixer, then rerun affected RED/GREEN discriminators and tasks 9.1-9.8 before a fresh code/spec re-review. Do not advance task 9.11, ship, archive, OS-provider claims, native ProcessCapsule closure, Mac status, or parent terminal return from this FAIL verdict.
