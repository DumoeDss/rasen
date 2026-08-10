# R1 Concurrency Fix Re-Review: teacher-consultation-runtime

Verdict: **PASS — 0 Blocker, 0 Major, 0 Minor, 0 Trivial**

Review timestamp: `2026-08-10T13:32:48+08:00`

Mode: dispatched, report-only, same formal non-author reviewer session

Branch: `feat/teacher-advisor-workflow`

Base/HEAD snapshot: `91d71d6c4bf1e35b4c7575bffabbdcafe547d38c`

This reviewer changed only this canonical report. Task 12.3 remains unchecked for LEAD after PASS.

## Scope Check

**Scope Check: REQUIREMENTS MET**

Intent: close R1 by making simultaneous repair of one valid journal-first projection gap idempotent, while retaining every differing or unreadable durable union without advice, release, duplicate work, or generic failure.

Delivered: the persistence seam now rereads after `stale-generation` / `registry-busy`, accepts only the exact journal projection, reuses the same immutable-authority/frontier classifier for disagreement, and terminates after a fixed retry count. The Module coalesces same-process canonical requests, while an independent-registry test exercises the cross-daemon registry lease/CAS path without relying on that coalescing. Real HTTP coverage proves one canonical recovery settlement and identical responses for simultaneous callers.

## Standards

No Blocker, Major, Minor, or Trivial standards findings remain.

K1 is resolved. The inline comment now accurately states that the retry cap is 32 attempts with up to 320 ms of requested backoff **plus registry I/O** (`src/core/frozen-action-executor/exact-teacher-attempt-persistence.ts:31-35`). The constants and executable logic are unchanged, so the prior concurrency, fail-closed, and termination evidence remains valid.

Standards axis: **0 findings — 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

## Spec

No Blocker, Major, Minor, or Trivial spec findings remain.

The previous P1 is resolved. Restart recovery now safely reconciles the exact persisted attempt, simultaneous identical projection repair returns the same durable frontier, disagreement remains typed and fail-closed, and production-level duplicate HTTP recovery emits one canonical settlement without duplicate Teacher work or advice delivery. This satisfies the restart/idempotency requirements in `specs/frozen-action-session-executor/spec.md:103-120` and `specs/ecp-consultation-runtime/spec.md:144-165`.

Spec axis: **0 findings — 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

## R1 Fix Delta Disposition

| Required property | Disposition | Evidence |
| --- | --- | --- |
| Both repair callers read the same pre-CAS snapshot | **PASS** | The test wrappers stop both callers at `registry.update()` before releasing either underlying CAS; reaching that barrier requires both to have read and classified the original revision-5 `activated` Session against the revision-6 `request-sent` journal (`exact-teacher-attempt-persistence.test.ts:466-543`). |
| RED was one success plus raw stale failure | **PASS** | The prior current-source reproduction recorded one fulfilled `request-sent` result and one rejected `SessionHostRegistryError { code: "stale-generation" }`; the deterministic test now observes the underlying stale/busy registry code while both public outcomes fulfill. |
| Bounded stale/busy reread and fail-closed exhaustion | **PASS** | The loop is capped at 32 attempts, backs off 10 ms for lease contention, rereads after every retryable CAS failure, and ends typed rather than optimistic (`exact-teacher-attempt-persistence.ts:148-210`). The adjacent comment accurately distinguishes requested backoff from registry I/O. |
| Exact journal projection is idempotent success | **PASS** | `sameFacts()` returns the latest Session immediately; same-instance and independent-instance barrier cases both fulfill with revision 6 / `request-sent` (`exact-teacher-attempt-persistence.test.ts:466-543`). |
| Different identity, optional facts, future/illegal frontier, malformed journal | **PASS** | The immutable identity, exact one-step phase/revision, and monotonic optional-fact checks remain narrow; persistence and repeated real HTTP matrices retain without rewriting durable state (`exact-teacher-attempt-persistence.ts:83-146`; `consultation-facade-journey.test.ts:2737-3022`). |
| Same-instance single-flight does not mask cross-daemon CAS | **PASS** | Module single-flight is independently proven once (`exact-teacher-attempt-module.test.ts:321-429`); the persistence matrix separately uses two registry instances over one state directory and observes the real `registry-busy` lease path (`exact-teacher-attempt-persistence.test.ts:478-527`). |
| Simultaneous real HTTP produces one canonical result | **PASS** | Both request bodies are flushed before the recovery gate releases; responses are byte-identical 200 `canonical-advice-settled`, contain no generic conflict, and the Record has one advice commit plus one continuation grant (`consultation-facade-journey.test.ts:2440-2735`). |
| No duplicate prepare/activation/send/settlement | **PASS** | The HTTP journey retains the preexisting single transport/input/workload counts during recovery and reaches one canonical settlement; downstream simultaneous phase projection also fulfills twice after observing stale CAS (`exact-teacher-attempt-persistence.test.ts:545-605`). |
| Timeout/reread failures never become optimistic success | **PASS** | Registry reread errors map to `durable-session-state-unavailable`; missing state and retry exhaustion remain typed retained. Reviewer fault injection exercised reread failure and exhaustion; neither returned recovery success. |
| Unsafe/unresolved cases emit no advice or release | **PASS** | Module converts typed load/commit failures to `authority-retained`; HTTP conflict cases preserve journal, registry, Record, Session, both reservations, transport/input/workload counts, and exclude advice/continuation transitions. |
| Seven replacement phases, B2, and M6 | **PASS** | All seven production replacement frontiers, delayed-writer final fence, and canonical Record-backed limits remain green/inspected in the reviewer suite. |

## Concurrency Coverage

```text
VALID JOURNAL-FIRST GAP
  two callers reach the same pre-repair CAS
    -> same registry instance: stale-generation observed
    -> independent instances: registry-busy lease observed
    -> reread exact projection: both fulfill identically

DIFFERING OR UNREADABLE REREAD
    -> typed retained
    -> zero optimistic success / advice / release

SIMULTANEOUS REAL HTTP
    -> one recovery flight
    -> one advice commit + one continuation grant
    -> identical canonical responses, no generic conflict
```

## Verification Evidence

Executed by this reviewer against the current worktree:

- R1 reviewer suite: **5 files, 59/59 tests passed**. The handoff's `58/58` count is stale by one; collection currently contains 59 and all pass.
- Related exact-authority/SessionHost/management suite: **11 files, 118/118 tests passed**.
- Targeted Vite-loaded fault injection: busy exhaustion = **32 updates + 32 rereads, typed conflict, 502 ms**; stale exact projection = success; stale differing projection = typed conflict; reread failure = typed unavailable.
- `pnpm exec tsc --noEmit`: **passed**.
- `pnpm lint`: **passed** for full `src/`, `test/`, and Vitest configuration.
- `node bin/rasen.js validate teacher-consultation-runtime --strict --json`: **1/1 passed, 0 issues**.
- `git diff --check`: **passed**; only existing LF-to-CRLF working-copy warnings were emitted.
- K1 comment-only delta: **exact wording inspected; strict UTF-8/no-BOM/mojibake/trailing-whitespace check passed**. No behavior changed, so behavioral suites were not rerun for this inline documentation fix.

The report-only reviewer did not run the write-producing build.

## Documentation and Scope Drift

No new implementation scope drift, stale public behavior, documentation issue, or frontend/design concern was found. K1's internal retry-budget wording is now accurate.

## Canonical Summary

| Unique ID | Standards | Spec | Severity | Disposition |
| --- | --- | --- | --- | --- |
| R1 | resolved | resolved | — | **CLOSED — simultaneous exact repair is typed and idempotent** |
| K1 | resolved | — | — | **CLOSED — comment now distinguishes requested backoff from registry I/O** |

Pre-Landing Review: **0 findings (0 Blocker, 0 Major, 0 Minor, 0 Trivial).**

Final verdict: **PASS.** R1 is closed. Task 12.3 remains unchecked for LEAD to account after this PASS.
