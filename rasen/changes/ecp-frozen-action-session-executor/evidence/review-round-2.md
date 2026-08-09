# Independent review round 2 - 7.1 driver-face wiring wave (delta on round-1)

Change: `ecp-frozen-action-session-executor`
Reviewer role: FRESH NON-AUTHOR (same reviewer as round-1; zero involvement in
the 7.1 wiring implementation). This is the DELTA re-review of the 7.1 wiring wave
(commits `56b18dcc..501fd203`, HEAD `501fd203`) on top of round-1's CLEAN core.
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`. 2026-08-09.

Round-1 ruling (b) holds: ship core + 7.1 wiring; the 4 environment-gated real
receipts (8.1/10.1/10.2/10.4) defer to ECP-8 with deterministic counterparts as
the 0.2.0 gate. This review confirms the wiring wave itself is clean and does not
falsify that ruling.

## Overall verdict

**CLEAN.** 0 Blocker / 0 Major / 0 Minor. The 7.1 wave is a purely-additive wiring
of the round-1 core to a production driver face. The load-bearing safety property
- the daemon face does NOT mutate the canonical Record - holds. No review defect.

## Item 1 - additivity - CONFIRMED

`git diff --name-only 56b18dcc..HEAD -- src/` returns only: `action-outcome.ts`
(the round-1 Minor label fix), `index.ts` (additive barrel re-export), the NEW
`production-executor.ts`, the NEW `management-api/frozen-action-executor.ts`, and
`management-api/router.ts` (the one additive route). The router diff is purely
additive: one import, one path in `MANAGEMENT_PATHS`, one method-admission line,
and one route handler block - no existing route modified or removed. `index.ts`
adds new re-exports from `production-executor.js` and removes/changes none. No
source outside the executor module + the one route was edited.

## Item 2 - daemon endpoint does NOT mutate Record (load-bearing) - CONFIRMED

`handleFrozenActionDispatch` (`management-api/frozen-action-executor.ts:108-211`)
loads the head Record READ-ONLY via `loadHeadRecord` (`:181` = `fs.readFileSync` +
`decodeCanonicalRunRecord`; no write), cross-checks `changeId` (`:185`), constructs
the production executor bound to the daemon `SessionHost` (`:190-198`), dispatches
via `executor.dispatch` -> `dispatchGrantedAction` (`:199-208`), and returns the
typed `ExecutionDispatchResult` (`:210`). There is no `writeFileSync`, no
`registry.update`, no Record mutation anywhere in the handler.

The production seam (`production-executor.ts`) confirms the same: the hosted seam's
`executeTurn` (`:106-123`) calls only `host.dispatch({op:'execute'})` (a turn) and
maps the outcome; `dispatchGrantedAction` (round-1) validates authority, selects a
backend, drives one turn, reconciles the outcome, and returns - it performs no
completion/Record mutation. Completion stays the canonical Facade `complete` path
the caller drives (the handler comment states this explicitly, `:14-19`). The
daemon face is NOT a second completion writer. CONFIRMED.

## Item 3 - parity gate over the wired production path - CONFIRMED

`production-executor.test.ts` (11 tests) proves: two driver faces dispatching the
same granted Action through the production executor resolve to the same
Run/Action/outcome (`:175`); the production matrix is queryable before any Run
starts (`:213`); a hosted lost-generation turn yields execution-lost through the
wired seam (`:222`); and in-tool launcher disappearance via the liveness probe
yields execution-lost (`:251`). Full executor + mgmt-api suite: 89/89 green.

## Item 4 - 5.4 per-field mutations - CONFIRMED (one re-run by reviewer)

Receipt 9 records 5 per-field mutations in `authority.ts` -> 6 RED (5 per-field + 1
cascade). The `actionId` leg is HONESTLY attributed to the earlier admission check
(`record.actions[actionId]` -> `not-currently-executable`), not `sameActionIdentity`
- it stayed GREEN under the sameActionIdentity mutations for the correct in-depth
reason, recorded as such. The ActorRef-binding leg is HONESTLY attributed to the
Facade completion path's `verifyAttestedCompletion`, covered by the existing
attestation/completion regression suite (task 9.3). Neither leg is falsely claimed
as a new executor mutation.

**Reviewer re-run:** the `policyDigest` (`sameAuthority`) mutation was re-applied
(`granted.policyDigest === committed.policyDigest` -> `true`); it RED'd
`authority.test.ts > a policyDigest mismatch fails closed receipt_conflict`.
Byte-exact restore (`c615294f...` before and after; `git status` clean). Receipt 9
discriminates.

## Item 5 - Minor-label fix - CONFIRMED

`action-outcome.ts` now records `source: 'lost-generation'` (with an updated
message noting the daemon process may still be alive) for the hosted lost-generation
case, and the `source` union type + docstring carry the new value.
`action-outcome.test.ts:33` asserts `expect(outcome.source).toBe('lost-generation')`.
The round-1 Minor is resolved.

## Item 6 - no regression - CONFIRMED

Regression-neighbor run (`test/core/management-api/` + `test/core/change-run/` +
`test/core/session-host/`, the additive route's surface + the Facade/Record the
handler reads + the host the seam drives): **1833 passed | 26 skipped (1859), 166
files passed | 4 skipped (170), exit 0**. The additive route broke nothing. (The 26
skips are the platform-gated real-OS oracles, unchanged.)

## Item 7 - spec delta + projection - CLEAN

The 7.1 wave touched NO spec/proposal/design bytes
(`git diff --name-only 56b18dcc..HEAD -- specs/ proposal.md design.md` empty). The
delta remains `## ADDED Requirements` for one new capability. `rasen archive
ecp-frozen-action-session-executor --dry-run --json`: spec-sync `blockers: []`
(ADDED-only, no scenario rename, no heading rename). The dry-run's only top-level
blocker is "4 task(s) are incomplete" (8.1/10.1/10.2/10.4) - the expected
ECP-8-deferred receipt gate, NOT a spec defect. The driver-face requirement
(`spec.md:159`) and the "real receipts" requirement (`:190`) still frame real-receipt
acceptance as forward; the change does not claim acceptance 6 is operationally met.
`validate --strict` passes; `tsc --noEmit` 0 errors; eslint clean; whitespace clean.

## Findings

None (0 Blocker / 0 Major / 0 Minor).

## Ship-readiness

Round-1 ruling (b) is upheld and the wiring wave is clean. The change is ready for
the LEAD's ship+archive with ledger reconciliation ticking the 4 ECP-8-deferred
tasks (8.1/10.1/10.2/10.4) with disposition notes. No code change was made by this
review; only this evidence file was added.
