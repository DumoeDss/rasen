# Independent review round 2 - closure (decision-13 rescope)

Change: `ecp-native-process-capsule-closure`
Reviewer role: FRESH NON-AUTHOR (zero prior involvement; the re-grade, the rescope
package, and the implementation were authored by other workers).
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `34111e9c` at review.
Host: Windows (shared worktree). 2026-08-08.

This is the independent confirmation the implementer explicitly left owed (tasks
9.3/9.4/9.5/9.7-9.10 + 12.9/12.10). Author != verifier: every "closed" below was
re-derived on this integrated tree by the reviewer, not trusted from a receipt.
Digests are from committed bytes (`git show HEAD:<path> | sha256sum`).

## Overall verdict

**CLEAN.** 0 Blocker, 0 Major, 0 Minor. SEC-001, RC-004, and RC-005 are each
independently confirmed closed on the integrated tree; the surviving-finding
dispositions are honestly recorded; the delta spec projects with no false claim;
`rasen validate --strict` passes and the change tree is whitespace-clean. Two
non-blocking informational notes are recorded at the end (no action required to
ship).

The cutover fix round landed clean before this review (ancestor confirmed); the
closure's own additions (the shared retention rule across all three maps, the
delta spec re-author, the native-map edit + authorized pin rebaseline) are all
present at HEAD.

## 1. SEC-001 (12.2) - CONFIRMED CLOSED on both shipped scopes

Original finding re-read in full (`evidence/cso-report.md:49-94`): a typed
uncertain native result (controller/control loss before `SCOPE_EMPTY`) becomes an
authoritative clean detach at the next layer, clearing registry process facts and
the writer claim.

### win32 tier - the structure that closes the shape

`hosted-process-scope.ts:26-30` selects `createWin32BestEffortProcessScope` for
win32, which WRAPS the legacy capsule and exposes a resolve-only `state.closed`
promise (`win32-best-effort-scope.ts:215-217`, settled only by `settleTerminal`
at `:223-227`). The transport consumes THIS promise
(`claude-backend.ts:280` `void live.closed.then(...)`), not the capsule client's
rejecting `closed`. On controller loss the capsule client's `closed` rejects
(`native-process-scope.ts:192-199,261-271`), but the wrapper's rejection handler
only latches `state.transportLost` (`win32-best-effort-scope.ts:355-358`) and
never settles `state.closed`. The capsule's PassThrough `output` is likewise not
ended on `fail()` (`native-process-scope.ts:261-271`), so no stdout `'error'`/
`'end'` reaches the transport. Therefore the transport's `closed` promise never
settles on loss, `observeTransportClose` (`host.ts:733`) never fires, and
`current.process` is not cleared.

Three independent guards then make a release-authorising terminal unreachable
even if a later verb runs:

- `transportLost` latch armed on every typed control failure
  (`win32-best-effort-scope.ts:240-253`, from the uncertain receipt at `:277`,
  the activate/abort/terminate error catches at `:339,:377,:434`, and the
  mid-flight re-check at `:283`).
- Latch-independent inspect backstop: an owned ref whose capsule answer is the
  exact "gone" claim returns `LOST_CONTROL_OBSERVATION`
  (`win32-best-effort-scope.ts:392,:409`), covering the pre-latch race window
  (e.g. controller dies during the prepared window before any control verb -
  the F2 case, tested at `win32-best-effort-scope.test.ts:460`).
- `translateTermination` mints a terminal only when `!transportLost &&
  channelAttributed` (`:283`); the resident-vs-probe attribution is carried by
  `receipt.gracefulAttempted` (`:442`), so a one-shot-probe "gone" answer for an
  owned ref yields `LOST_CONTROL_RECEIPT` (uncertain), never a terminal.

`receiptAuthorizesRelease` (`process-scope.ts:222-228`) refuses `uncertain`
regardless of declaration, and the host consumes inspect BEFORE terminate
(`host.ts:707`; terminate gated on `observation.controllable` at `:715`; release
gated on `receiptAuthorizesRelease` at `:717`). For a lost-control owned ref,
inspect returns `uncertain`/`controllable:false`, so `closeDurableProcess`
returns `'live-or-uncertain'` at `host.ts:708-709` and the terminate branch is
never entered.

### POSIX tier - the finding's premise does not apply

`createPosixBestEffortProcessScope` (`posix-best-effort-scope.ts`) is fully
in-process: there is no external control transport and no capsule. Terminals are
minted only by the cancel protocol (bounded by `withPhaseDeadline` at `:524-528`)
and the observed whole-group-emptiness completion watcher (`:308-326`), both
settling `declared-unproven`. A ref from a previous daemon lifetime is `foreign`
(`:495`); daemon death wipes the in-memory state and is decision 11's
`execution-lost` (executor-owned), not a false terminal at this seam.

### Deciding evidence (opened and re-read, not summarized)

- Real-host transport-loss receipt
  `rasen/changes/archive/2026-08-07-ecp-hosted-best-effort-cutover/evidence/win32-real-host-receipts.md`
  Task 7.3 (`:106-164`): controller killed mid-session on a real Windows host;
  `recovered === 0`, `record.process` still defined, no terminal written, valid
  pre-start declaration. The receipt FAILED on its first run (`recovered === 1` =
  released) until fix `0346ba29`, which is both the defect's reality and the
  receipt's own discrimination proof.
- `legacy-freeze-integrity.md:50-56`: the indicted host translation layers
  (`claude-backend.ts` close(error), `host.ts observeTransportClose`) are
  byte-unchanged across the cutover (`git diff --stat b3edf5bc..af21ba8d` over
  those files is empty); the honesty lives below them at the scope seam.
- Deterministic discrimination: `win32-best-effort-scope.test.ts` (22 tests) and
  `cutover-declaration-gated-release.test.ts` (10 tests) green at HEAD; the
  transport-loss / pre-activation-loss cases assert `receiptAuthorizesRelease ===
  false` and uncertain observations.

**SEC-001: CONFIRMED.** Transport/controller loss yields retained typed
uncertainty, never a release-authorising terminal, on both shipped scopes.

## 2. RC-004 (12.7) - CONFIRMED CLOSED (containment + ordering implemented; pins verified)

The park was voided by the cutover (probe reachable by design D4, exercised on a
real host). The cutover fix round contained it; the closure confirms on the
integrated tree.

- Crash-containment half: the one-shot probe's stdout callback is wrapped in
  try/catch and routes any throw (oversized/corrupt length field from
  `CapsuleFrames.push`, `native-process-scope.ts:91-104`) into typed `failProbe`
  (`native-process-scope.ts:351-364,371-396`). This is an EventEmitter callback;
  without the wrap the throw would escape as an uncaught exception. Confirmed.
- Ordering half - IMPLEMENTED, not waived: every non-observation frame is a typed
  protocol failure rather than ignored to the deadline. `OBSERVATION` (len 1)
  resolves (`:375-378`); `ERROR` -> typed `process-authority-uncertain`
  (`:380-385`); any other kind -> typed `Unexpected ProcessCapsule probe frame`
  (`:387-391`). The `settled` latch makes this settle exactly once
  (`:350-353,:376`). A protocol-breaking probe is `SIGKILL`ed across the whole
  catch (`:414`).
- Discriminators: `win32-best-effort-scope.test.ts:421-447` loops
  `oversized-frame | truncated-observation | unknown-frame` and asserts each
  yields an uncertain observation and an uncertain terminate receipt with
  `receiptAuthorizesRelease === false`; `:449-458` covers `duplicate-observation`
  (first wins, no throw). All 22 tests green at HEAD.
- POSIX leg: the POSIX production path never constructs the legacy capsule
  (`hosted-process-scope.ts:26-27`); the probe is unreachable from POSIX hosted
  sessions; the Rust one-shot is frozen history with no 0.2.0 acceptance.

### Pin re-verification (from committed bytes)

`git show HEAD:src/core/session-host/process-capsule/native-process-scope.ts |
sha256sum` = `3e74b2c25bfde89a9db300301b7010f2a7c9521be37283ed73169be4f111b828`.
Both `LEGACY_PROCESS_CAPSULE_INPUTS` lists carry exactly that value with the
two-step lineage (`0848c77b -> a070733c` for RC-004 F1; `a070733c -> 3e74b2c2`
for RC-005 12.8), referencing `git show 8e48ce45:<path>` and
`git show efe834ba:<path>`:

- `test/core/session-host/linux-process-authority-boundary-guards.test.ts:40-41`
- `test/core/session-host/windows-process-authority-package-ci.test.ts:59-60`

Both pin assertions are pure byte-digest checks with NO platform early-return,
so they run and discriminate on this Windows host (the
`linux-...-boundary-guards` file is distinct from the platform-gated
`linux-...-package-ci` pattern). The Rust crate digest and every other pinned
digest in both lists are unchanged. Pin suite green (the linux boundary-guards
file + the windows package-ci file: 21 tests green).

**RC-004: CONFIRMED.** Containment and ordering both implemented; both pin lists
carry `3e74b2c2...` matching committed bytes at HEAD.

## 3. RC-005 (12.8) - CONFIRMED CLOSED (three-map rule; mutations discriminate)

`scope-retention.ts` exports `sweepSettledTerminals(map, isSettledTerminal)`,
called at the start of every `prepare()`. The per-tier predicate is the definite
settled terminal: exact tier `client.state === 'closed'`
(`native-process-scope.ts:428,446`); POSIX `state.terminal !== undefined`
(`posix-best-effort-scope.ts:184,421`); win32 `state.terminal !== undefined`
(`win32-best-effort-scope.ts:210,319`). Live / control-lost / uncertain entries
carry no settled terminal and are retained. The rule covers all THREE maps
(legacy `clients` + POSIX `scopes` + win32 `scopes`), confirmed by reading each
call site and by the 7-test `scope-retention-lifecycle.test.ts` which exercises
all three tiers plus the shared unit block (green at HEAD).

The in-Session replay window is preserved: before any successor `prepare()`, a
cancel followed by re-inspect of the same ref still reads the retained terminal
(`scope-retention-lifecycle.test.ts:131` POSIX; `:201` win32 control-lost
re-inspect stays uncertain/reconcilable).

### Mutation discrimination (run by the reviewer, byte-exact restore)

Helper `scope-retention.ts` working-tree digest `5f92ccc6...` matched committed
before and after both mutations (backup/restore via `cp`, never
`git checkout --`).

- **Mutation R (under-sweep / no-op the release):** 5 of 7 tests RED. Both unit
  tests fail (settled entries not released: `expected ['settled','live'] to
  equal ['live']` and `['closed','live','control-lost'] to equal
  ['live','control-lost']`), and the POSIX/win32/exact integration tests fail at
  the `not.toContain(settled)` release assertions (`:135,:170,:233`). The two
  control-lost-retention tests stay green (correctly - under-sweep retains
  everything). Confirms the sweep is load-bearing for release.
- **Mutation W (over-sweep / delete unconditionally):** 7 of 7 tests RED. The
  unit tests fail (maps emptied), and the retention assertions fail including the
  two control-lost-retention cases (`:198,:260` - control-lost entries wrongly
  dropped, the clean-detach shape the tiers forbid), plus live-scope entries
  wrongly swept (`:166-167,:229-230`). Confirms the predicate is load-bearing for
  retention.

Both directions discriminate. The native-map edit + authorized pin rebaseline
landed (digest `3e74b2c2...` at HEAD, both pin lists updated); the exact-tier
retention block (`scope-retention-lifecycle.test.ts:210-263`) is green.

**RC-005: CONFIRMED.** One shared rule across all three maps; release and
retention are each mutation-discriminated; the replay window is preserved.

## 4. Surviving findings (SEC-002/003, RC-001/002/003) - dispositions honest

Each ORIGINAL finding was re-read (`cso-report.md:96-178`,
`review-report.md:27-126`) and the disposition cross-checked against
`decision13-regrade.md:58-62,107-252`. None is falsely closed by a scope change.

- **SEC-002 (Major, ancestor junction)** - `prior-disposition-stands`,
  superseded by decision 12 (local-attacker path hardening retired; decision 12
  names "symlink/junction redirection" verbatim, `decision13-regrade.md:117-118`).
  No 0.2.0 acceptance; the adjacent-integrity half decision 12 retains is
  receipted by the unchanged pin-list resolver/helper bytes. Re-entry: multi-user
  / hosted deployment. Honest - closed by threat-model decision, not a code-fix
  claim.
- **SEC-003 (Major, cwd re-resolved after publication)** - `prior-disposition-
  stands` on the decision-12 leg. The disposition explicitly flags the
  decision-11 leg as dead/weakened: the raced publication-before-ACTIVATE window
  STILL EXISTS in shipped win32 code and is out of acceptance SOLELY because
  decision 12 retired the attacker class; the decision-11 "window disappears"
  justification is not cited alone (`closure-integration-disposition.md:147-150`,
  `decision13-regrade.md:141-154`). This is the careful, honest wording - it does
  not pretend the code closed the window.
- **RC-001 (Blocker, POSIX group escapability)** - `leaves-with-parked-crates`.
  Its disproof (`setsid()`/`setpgid()` escapes the group) is LOAD-BEARING for the
  best-effort declaration (`scopeEmptyProof: false`) and is preserved verbatim in
  the parked "non-escapable recoverable process authority" requirement body
  (spec.md:232-246). Confirmed no shipped path mints an exact PGID claim
  (`emptiness: 'unproven'` literal in both best-effort scopes). Honest.
- **RC-002 (Blocker, zombie-pinned wait)** - exact leg superseded to the upgrade
  path; the decision-13 residual (natural exit reaches a bounded declared-unproven
  terminal, never an unbounded zombie-pinned wait) is satisfied on the POSIX tier
  (`withPhaseDeadline` at `posix-best-effort-scope.ts:524`; ESRCH-keyed
  zombie-tolerant `groupPresent` at `:74-86`; real-kernel 6.4 receipts cited via
  the cutover). Honest.
- **RC-003 (Blocker, false closed while controller live)** - `leaves-with-parked-
  crates`; replacement-recovery machinery is decision-11 upgrade-path; the POSIX
  one-shot path additionally stops being constructed (`hosted-process-scope.ts:26-
  27`). The retained no-overclaiming invariant is checked under SEC-001 (live) and
  RC-004 (one-shot). Honest.

Nothing 0.2.0-shipping contradicts any of these. No finding is closed-by-scope-
change that shouldn't be.

## 5. Spec delta accuracy + projection self-check - CLEAN

`specs/durable-process-scope-authority/spec.md` was re-authored under Replan 6
with a non-projecting decision-13 banner plus in-body scope markers. Confirmed:

- Each requirement body carries its decision-13 re-scope marker where acceptance
  changed; the kernel-enforced "non-escapable recoverable process authority"
  requirement is marked PARKED ("NOT 0.2.0 acceptance", "No scenario below is a
  0.2.0 gate", spec.md:236-246); the POSIX-replacement requirement is
  "Superseded by architecture replan" (spec.md:106-107); the macOS requirement is
  "Decision-gated" (spec.md:54-55). The 0.2.0 acceptance surface is therefore
  best-effort / declared-unproven only.
- No requirement heading renamed, no scenario deleted (the retained exact and
  macOS contracts stay on record as upgrade-path resumption evidence).

**Projection self-check** (run by the reviewer via `findSpecUpdates` +
`buildUpdatedSpec` against `rasen/specs/`; non-destructive - no archive
performed). The capability is NEW (absent from `rasen/specs/`), so the delta is
pure `## ADDED Requirements`. Result:

```
COUNTS: {"added":10,"modified":0,"removed":0,"renamed":0}  emptied:false
```

Zero `renamed` (no implicit delete), zero `removed`. All 10 requirement headings
project. The PARKED marker, "No scenario below is a 0.2.0 gate",
`scopeEmptyProof: false`, and the `declared-unproven` vocabulary each travel
intact into the projected main spec. The projected main spec ships no false
claim: the kernel-enforced requirement lands WITH its PARKED marker, so it reads
as upgrade-path rather than a 0.2.0 gate.

## 6. General pass - CLEAN

- `node bin/rasen.js validate ecp-native-process-capsule-closure --strict`:
  **passed** (exit 0).
- Whitespace gate on the change tree: no trailing whitespace and no CRLF across
  `rasen/changes/ecp-native-process-capsule-closure/` (the evidence + spec files
  authored outside the repo are clean). `scope-retention.ts` restored byte-exact
  (`5f92ccc6...`) after the mutation runs; working tree clean.
- Targeted vitest runs (deterministic; no real-helper dependency on the
  best-effort/native-fake paths): 50 + 13 = 63 tests green across
  `scope-retention-lifecycle` / `win32-best-effort-scope` /
  `linux-process-authority-boundary-guards` / `windows-process-authority-package-ci`
  / `cutover-declaration-gated-release` / `process-scope-host-closure`.
- No additional severity-worthy defect found in the ProcessScope/host close path,
  the retention lifecycle, the probe containment, or the spec.

## Informational notes (non-blocking, no action required to ship)

1. `closure-integration-disposition.md` was authored at HEAD `079f0063` and
   records the native-map edit as "HOLD pending the pin rebaseline authorization"
   (its STOP event). At HEAD `34111e9c` that edit + rebaseline HAS landed
   (`native-process-scope.ts:446` carries the sweep; digest `3e74b2c2...`; both
   pin lists updated; task 12.8 ticked). The disposition text is stale relative to
   the landed work, but `tasks.md` is current and the landed state was verified
   directly here. No defect; noted so a future reader does not read the STOP
   event as the final state.
2. SEC-001's safety is concentrated at the win32 scope seam: the resolve-only
   `state.closed` plus the PassThrough-buffered stdout together ensure the
   transport never observes a close on controller loss, so `observeTransportClose`
   (`host.ts:733`, which still clears `current.process`) is simply never invoked
   on loss. This is the documented design ("honesty lives at the scope seam"), and
   the deterministic transport-loss tests plus the real-host 7.3 receipt guard it.
   A future change that reintroduces a loss-signalling path at the seam would
   silently reopen the shape; those guards are the regression net.

## Tasks this clears

The independent confirmation owed under 9.3/9.4 (security + code/spec) and the
12.9 re-review precondition is satisfied with 0 Blocker / 0 Major. The change may
proceed to 12.10 (local ship/archive/parent-return) per its local-delivery
boundary. No code change was made by this review; only this evidence file was
added.
