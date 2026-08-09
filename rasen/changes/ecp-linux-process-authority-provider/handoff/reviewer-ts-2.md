# Reviewer handoff: Linux process-authority TypeScript round 2

Verdict: **FAIL - 4 Majors, no Blockers or Minors.** Detailed evidence is in `evidence/review-report-ts-round-2.md`.

## Closed from round 1

- B-001: exact non-subclassable, frozen, non-virtual ledger capability rejects the hostile subclass/prototype chain.
- B-002 original structural-injection chain: public production factories accept exact `{ stateRoot }`, own the resolver/native assembly, and do not re-export the `ForTesting` seams from the Linux index.
- M-001: reordered/rehashed private-reference aliases reject.
- M-002 single-entry loss: the independent publication head retains `ledger-missing`.
- m-001/m-002: closed Linux root status and launch snapshot bounds/canonical environment.

## Must-fix findings

1. **M-003:** helper + companion manifest + package trust can all be replaced with one valid alternate hash/source/compiler identity and are accepted as `package-integrity`. The current test leaves trust unchanged, so it does not exercise this chain.
2. **M-004:** leaf dirfd pinning is real, but the production/ledger roots do not validate the full ancestor/full-mode chain or construct sibling publication-ledger exclusion from the same-UID workload. Deleting both head and entry after a real commit returns `prepared-inert`.
3. **M-005:** `exactProductionChildDirectory()` unconditionally calls `mkdirSync`; the second factory on the same state root throws `EEXIST`, so replacement cannot assemble/reopen durable state.
4. **M-006:** a runtime bridge that sends ready then exits code 0 before exact terminal proof leaves `rootExited`/`exactScopeEmpty` pending instead of retained control loss.

## Fresh probe summary

- canonical alias rejected: yes
- ledger subclass rejected: yes
- prototype mutation rejected: yes
- delete entry only: `authority-uncertain/ledger-missing`
- rewrite helper + manifest + trust: accepted as `package-integrity` (failure)
- construct production factory twice: second throws `EEXIST` (failure)
- delete both publication head + entry: `prepared-inert` (failure under unisolated-root threat)
- structural production injection: rejected
- production broker: typed `authority-unavailable`, no implicit primary fallback

## Gates

- Linux TS: 82/82 passed.
- Common conformance/prepare-unavailable: 51/51 passed.
- TypeScript noEmit, focused ESLint, and strict Rasen validation passed.

No product/test/task/run-state file was changed and no commit was created. Next action is a non-reviewer fix round followed by fresh TypeScript re-review.
