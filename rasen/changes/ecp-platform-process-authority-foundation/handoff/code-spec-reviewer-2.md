# Code/spec reviewer handoff: round 2

## Result

**FAIL — 4 Blocker, 5 Major, 0 Minor, 0 Trivial.**

The round-1 fix closed inert recovery, actual publisher bounding, typed prepare
failures, and public reference redaction, and it improved fulfilled deadline
handling and shared-suite breadth. The Change still cannot pass task 9.10.

## Open Blockers

- **B-001:** a public registry subclass can call `super([])`, override
  `select()`, and dispatch a raw provider without a manifest.
- **B-002:** references first observed through replacement recovery never enter
  the lifecycle tombstone ledger; a retired recovered reference can be prepared
  again and receive its stale exact-empty receipt.
- **B-004:** the unchanged conformance suite exercises only negative/ignored or
  pre-dispatch-timeout abort outcomes; a provider that never completes abort can
  still pass without demonstrating exact recursive abort.
- **B-005:** the coordinator rereads a mutable `providerPrepared.reference`;
  abort can control B while the coordinator mints an authentic exact-empty
  receipt for public reference A.

## Open Majors

- **M-002:** root exit with `{code:null, signal:null}` is accepted as complete.
- **M-005:** alternating prepare/termination getters defeat the claimed single
  validated snapshot and can dispatch unchecked data or reject during identity
  serialization.
- **M-006:** provider rejection after the monotonic deadline reports
  `control-loss`, not `timeout`.
- **M-007:** concurrent prepare can oversubscribe the 1,024-entry tombstone
  ledger because capacity is checked without reservation.
- **M-008:** a mismatched publisher acknowledgment resets to `prepared-inert`
  and permits a second durable publisher callback.

## Fresh evidence

- Exact 12-file focused command: **156/156 tests passed**.
- Public/read-only probes reproduced every runtime finding above except B-004,
  which follows directly from the complete shared suite's abort assertions.
- The detailed failure paths, exact lines, round-1 closure matrix, and complete
  8-requirement / 49-scenario audit are in
  `evidence/code-spec-review-round-2.md`.

## Next owner

Return to a non-author fix/re-review loop. Add public discriminators for forged
registry provenance, recovery reuse, immutable prepared results, null/null root
status, alternating getters, late rejection, concurrent capacity, publisher
retry, and positive prepared/published abort. Do not mark tasks 9.10-9.14
complete, ship, archive, or unblock platform providers from this result.

This reviewer changed only the round-2 evidence and handoff files. No product,
test, task, runstate, Direction, portfolio, commit, ship, or archive state was
changed.
