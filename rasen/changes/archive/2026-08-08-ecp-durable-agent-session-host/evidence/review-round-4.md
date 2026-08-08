# Independent review round 4 - host against the shipped best-effort cutover

Change: `ecp-durable-agent-session-host`
Reviewer role: FRESH NON-AUTHOR (reviewer of `ecp-native-process-capsule-closure`
immediately prior; zero involvement in this host Change's own authoring/strategy work).
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `21f584d9` at review.
Host: Windows (shared worktree). 2026-08-08.

This is the fresh independent review owed under Architecture Replan 6 (the host
DAG's terminal review). It rules on each of S1-S5 against the integrated tree now
that the prerequisite `ecp-hosted-best-effort-cutover` is shipped+archived and
`ecp-native-process-capsule-closure` is terminal. Every verdict was re-derived on
this tree by reading host code and re-running the relevant suites; none is trusted
from a receipt.

## Overall verdict

**CLEAN.** 0 Blocker, 0 Major, 0 Minor. The host may ship LOCALLY as-is with the
recorded dispositions. No host-side fix round is required.

- S1 and S3 leave 0.2.0 with the parked crates (honest, re-entry recorded).
- S2 (conditionally-closed) is now satisfied on the integrated tree: no shipped
  path translates a backend-root exit into whole-scope closure, and release stays
  gated on an observed (declared-unproven) terminal.
- S4 (the LEAD flagged as most likely to need a host fix) is CONFIRMED: every
  reachable control phase on the host's consumption path is bounded with typed
  phase-specific uncertainty that retains authority. The host adds NO unbounded
  await of its own; it delegates to scope verbs that are each bounded. No host
  fix needed.
- S5 is narrowed (byte reproducibility retired by decision 12; manifest-adjacent
  integrity receipted by the cutover pin-list task).

The host's own release-gate code is fail-closed everywhere: every catch handler in
the prepare/activate/abort flow substitutes a conservative `uncertain` /
`closed:false` value that never authorizes release, and release is gated on
`receiptAuthorizesRelease` / `termination.closed`.

## Per-finding verdicts

### S1 (macOS ABI) - leaves-with-parked-crates - CONFIRMED

Original (`review-report.md:570-582`): the 40-byte `UniqueInfo` cannot satisfy the
56-byte XNU ABI, so macOS exact-birth fails closed. Re-grade verdict:
leaves-with-parked-crates; the best-effort tier consumes no kernel birth identity
on any OS.

Confirmed on the integrated tree. `hosted-process-scope.ts:26-30` selects the POSIX
best-effort scope for darwin/linux (process-group mechanics; no birth identity) and
the win32 best-effort scope for win32 (Job mechanics; the wrapper re-declares every
terminal declared-unproven and consumes no birth identity for its declaration). The
defective-then-repaired `mac_birth` lives in the parked Rust crate, reached only by
the exact-tier capsule on platforms that carry no support claim. The repaired 56-byte
binding is retained in git as upgrade-path provenance and is not independently
confirmed on a real macOS host (honestly recorded). No 0.2.0 consumer. No work owed
at ship beyond the recorded upgrade-path oracle obligation.

### S2 (root-exit scope-close) - CONFIRMED satisfied (was conditionally-closed) - no residual in host code

Original (`review-report.md:530-551`): a backend-root `EXIT` was misreported as
whole-scope closure; `observeTransportClose` cleared durable authority while a
detached descendant survived. Re-grade: conditionally-closed-pending-cutover-
verification. The cutover shipped; this review performs the named independent
confirmation.

The three exact checks owed are each satisfied on the integrated tree:

1. **POSIX root-exit mints declared-unproven only, after whole-group teardown.**
   `posix-best-effort-scope.ts:308-326` (`watchNaturalCompletion`) records root-exit
   on `state.rootExit` but settles a terminal ONLY after the whole group is observed
   absent, and the terminal is `declared-unproven` with `emptiness: 'unproven'`. A
   surviving detached descendant keeps the group present, so no terminal is minted
   until group-empty (and even then it is unproven, never a proven scope-empty).
2. **win32 never mints the capsule's proven scope-empty.** The win32 wrapper exposes
   a resolve-only `state.closed` (`win32-best-effort-scope.ts:215-227`) that settles
   ONLY via `settleTerminal` into a `declared-unproven` receipt
   (`:285-291,:346-354`); the capsule's exact `closed` vocabulary is never surfaced.
   Job `KILL_ON_JOB_CLOSE` teardown is receipted (cutover 7.1/7.2).
3. **No shipped path translates root `EXIT` into whole-scope closure.** In
   `claude-backend.ts:266-279` `live.rootExited.then` sets `rootExitedState` and
   fails the active turn but does NOT call `close()`; `send()` (`:290`) then refuses
   new turns while the transport stays open (`closedState` false). The transport
   closes only when the scope's `live.closed` settles (`claude-backend.ts:280-286`),
   which (per check 2) is a declared-unproven outcome, never a raw root-exit. So
   `observeTransportClose` (`host.ts:733`) is not reachable from a root-exit, and
   `current.process` is not cleared on root-exit.

Empirical: `process-scope-host-closure.test.ts` (3/3) - "emits one natural
scope-empty receipt after the last backend member exits" and "retains a live
controllable scope until the last descendant is empty". `cutover-declaration-gated-
release.test.ts` (10/10) green.

**S2: CONFIRMED satisfied.** No residual in host's own code.

### S3 (POSIX replacement cleanup) - leaves-with-parked-crates; harm re-classified - CONFIRMED

Original (`review-report.md:553-568`): POSIX one-shot replacement cleanup kills only
the controller and can orphan the group. Re-grade: criterion-4 machinery that left
under decision 11; decision 13 re-classifies the surviving-tree harm as a declared
known limitation (`scopeEmptyProof: false`).

Confirmed. Replacement-recovery machinery is parked; under decision 11 a replacement
daemon never inspects a stored ref (daemon death = scope death + `execution-lost`,
owed downstream). Both shipped tiers declare `scopeEmptyProof: false`
(`posix-best-effort-scope.ts:44`, `win32-best-effort-scope.ts:79`), so the
surviving-descendant limitation is declared pre-start, not hidden. The finding's
disproof value (a POSIX group is escapable via `setsid()`/`setpgid()`) is
load-bearing for that declaration and is preserved verbatim in the closure delta
spec's parked "non-escapable recoverable process authority" requirement. No 0.2.0
work; the real Linux/macOS replacement oracles travel to the upgrade path.

### S4 (unbounded activate/abort) - CONFIRMED - every reachable phase bounded; NO host fix needed

Original (`review-report.md:584-594`): `activate()` and `abort()` in the legacy
capsule TypeScript client awaited without timers (`native-process-scope.ts:361-382`),
so a wedged controller/pipe could block publication recovery or shutdown
indefinitely. Re-grade: narrows; every control phase reachable in the shipped scope
implementations must be bounded with typed phase-specific uncertainty.

The LEAD flagged this as the finding most likely to need a host-side fix. It does
not. The original defect was in the capsule client, not host code, and the closure
repair (`awaitControl`) bounds every capsule phase; the host's consumption path
delegates to those bounded verbs and adds no unbounded await of its own.

#### S4 phase enumeration (from host code, independently)

The host invokes these scope control verbs (call sites in `host.ts` +
`claude-backend.ts`); each delegates to a scope implementation that bounds it with a
typed `ProcessScopeError` carrying the specific phase + code (timeout/control-lost):

| # | Phase | Host call site | Scope-side bound | Typed outcome on timeout/loss |
| --- | --- | --- | --- | --- |
| 1 | prepare | `host.ts:442`, `claude-backend.ts:491` | capsule `awaitControl('prepare')` (`native-process-scope.ts:461`); POSIX sync + validation | `process-control-timeout`/`prepare` |
| 2 | activate | `host.ts:501`, `claude-backend.ts:513` | capsule `awaitControl('activate')` (`:485`); POSIX `withPhaseDeadline('activate')` (`posix-best-effort-scope.ts:472`) | `process-control-timeout`/`activate` |
| 3 | abort (prepared) | `host.ts:472,485,566,1441`, `claude-backend.ts:521` | capsule `awaitControl('abort')` (`native-process-scope.ts:501`); POSIX `cancel` -> bounded `runCancelProtocol` | `process-control-timeout`/`abort` |
| 4 | inspect | `host.ts:707` | capsule one-shot `awaitControl('inspect')` (`:406`); POSIX synchronous (no await) | `process-control-timeout`/`inspect` |
| 5 | terminate (live transport) | `host.ts:621`, `claude-backend.ts:333` | capsule `awaitControl('scope-empty')` (`:539`); POSIX `withPhaseDeadline('terminate')` (`posix-best-effort-scope.ts:527`) | `process-control-timeout`/`scope-empty` |
| 6 | terminate (durable close) | `host.ts:716` (`closeDurableProcess`) | same as #5 | same |
| 7 | closed / rootExited observers | `claude-backend.ts:266,280`, `host.ts:517` | fire-and-forget `void ...then(...)`; not a blocking control verb | n/a - never blocks a verb; pending-on-loss = retention (SEC-001) |

All five host-invoked scope verbs (rows 1-6; #5 and #6 are the same verb at two call
sites) are bounded. The host AWAITS each without adding its own deadline, which is
correct: the bound lives at the scope seam and the host trusts the scope's typed
contract. The fire-and-forget observers (row 7) are not control verbs and cannot
hang a host operation - on transport loss they simply never settle, leaving
authority retained (the SEC-001 seam behavior confirmed in closure review-round-2).

Critically, the host's catch handlers preserve the fail-closed property even when a
scope verb's typed uncertainty is thrown: each substitutes a conservative value that
does NOT authorize release - `prepared.abort(...).catch(() => ({ state: 'uncertain',
... }))` (`host.ts:472,485,568`) and `transport.terminate(...).catch(() => ({ closed:
false, ... }))` (`host.ts:547`) - and release is then gated on
`receiptAuthorizesRelease` (`:490,573`) / `termination.closed` (`:550`). So a bounded
timeout retains authority, which is exactly S4's acceptance.

Empirical: `process-capsule-control-deadline.test.ts` (3/3) - "bounds ACTIVATE
uncertainty, retains the ref, and never activates twice" and "bounds prepared abort
uncertainty and allows later exact reconciliation". These are the precise phases S4
originally indicted. Green at HEAD.

**S4: CONFIRMED.** Every reachable control phase is bounded with typed phase-specific
uncertainty that retains authority. No host-side fix.

### S5 (helper reproducibility) - narrows - CONFIRMED

Original (`review-report.md:596-605`): source-identical Windows builds produced
distinct helper SHA-256 values, so the reproducibility provenance claim was unproven.
Re-grade: narrows; byte reproducibility retired by decision 12; manifest-to-adjacent-
binary integrity stays, receipted by the cutover pin-list task.

Confirmed. The narrowed provenance wording (compiler/source digest as build-input
provenance, not a reproducible-build promise) is in the closure delta spec. The
retained manifest-adjacent hash/length integrity is receipted by the cutover's two
`LEGACY_PROCESS_CAPSULE_INPUTS` pin suites - both pure byte-digest checks, no platform
early-return, run and pass on this Windows host (verified green in closure
review-round-2; the resolver/helper bytes are pinned and unchanged). No 0.2.0 work
beyond the recorded narrowing.

## Ship-readiness ruling

**Ship-ready (local).** The host's cumulative tree satisfies every live acceptance
item: S2 and S4 are satisfied on the integrated tree (not just structurally promised),
and S1/S3/S5 carry honest recorded dispositions with their re-entry conditions on the
ledger. `rasen validate --strict ecp-durable-agent-session-host` passes (exit 0). The
host's own code is fail-closed at every release gate. The host spec delta
(`## ADDED Requirements`) is consistent with the best-effort tier - it uses "attempt"
graceful/forced termination, releases "only after observed close", and records the
cancel outcome "cancelled or ambiguous according to observed backend evidence"; it
makes no kernel-proven-exact-emptiness claim that the best-effort tier would falsify.

The host may proceed to local ship/archive. No implementation work is owed from this
review.

## General pass

- `node bin/rasen.js validate ecp-durable-agent-session-host --strict`: **passed**.
- Whitespace gate on `rasen/changes/ecp-durable-agent-session-host/`: clean (no
  trailing whitespace, no CRLF).
- Targeted vitest (deterministic): 16 tests green across `process-capsule-control-
  deadline` (S4), `process-scope-host-closure` (S2), `cutover-declaration-gated-
  release` (release gate). (`dist/cli/index.js` confirmed present before runs; no
  scope mutation performed in this review - closure review-round-2 already
  mutation-discriminated the retention rule and the SEC-001 latch.)
- No additional severity-worthy defect found in the host close/release paths, the
  control-phase consumption, or the spec.

## Informational notes (non-blocking, no action required to ship)

1. The host spec's recovery scenario "Unattachable surviving tree is cleaned before
   recovery" (`spec.md:94-96`) phrases cleanup as "terminates and awaits that exact
   tree". Read literally against the pre-cutover exact-authority design this could
   mislead, but it is satisfied by the shipped behavior (signal the recorded group,
   await its observed declared-unproven close) and requirement 6's "attempt" +
   "observed close" + "cancelled or ambiguous according to observed backend evidence"
   wording is explicitly best-effort-honest. The kernel-exact nuance lives in the
   process-scope spec (`durable-process-scope-authority`, with its PARKED exact
   requirement). No false claim ships; a future doc pass could cross-reference the
   best-effort declaration here for clarity, but it is not a 0.2.0 gate.
2. The host awaits scope verbs without its own deadline wrapper (rows 1-6), trusting
   the scope's `awaitControl`/`withPhaseDeadline` bound. This is correct as long as
   the scope seam keeps bounding every phase; the deterministic control-deadline and
   declaration-gated-release suites are the regression net for that contract.

## Tasks this clears

This satisfies the host DAG's fresh independent review (Architecture Replan 6) with
0 Blocker / 0 Major. The host may proceed to local ship/archive per its delivery
boundary. No code change was made by this review; only this evidence file was added.
