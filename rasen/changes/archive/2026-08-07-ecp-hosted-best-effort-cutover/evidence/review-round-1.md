# Independent review round 1 - ecp-hosted-best-effort-cutover

Role: non-author REVIEWER (author of the decision13-regrade accounting and the spec Purpose
fix; zero lines of this change's code). Date: 2026-08-08. Worktree
`OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`, branch
`wip/ecp-shared-bounded-loop-lifecycle-resume`, reviewed tree at HEAD `50c15be0` (change
artifacts at `b3edf5bc`; implementation commits `88ffc08b`, `1576b264`, `b33a4f84`,
`af21ba8d`, `b00dc64e`, `0346ba29`, `6f35121e`; concurrent rebaseline `0f7eda09`).

Method: every receipt named below was opened and read, not trusted from its summary; the
guard suites were re-run by this reviewer on this host (`dist/cli/index.js` confirmed present
first); one mutation the implementer did not supply was run by this reviewer with byte-exact
backup/restore (never `git checkout --`, per the recorded autocrlf trap).

## Checklist verdicts

### 1. D4 <-> RC-004 ruling (park verdict replaced)

My earlier re-grade parked RC-004 conditional on the one-shot probe being UNREACHABLE from
the shipped win32 path. That condition failed: the probe is reachable by design (D4), proven
on a real host (7.2b, and the first 7.3 run travelled through it). The park verdict is void.

RC-004's original text was re-read in full (closure `evidence/review-report.md:97-112`): the
one-shot data callback does not catch `CapsuleFrames.push` failures; "An oversized frame
throws from an EventEmitter callback and can escape as an uncaught exception during startup
reconciliation. Unknown or out-of-order frames are silently ignored until close/timeout
rather than being rejected as a typed protocol failure."

Verified against the pinned adapter as shipped: `native-process-scope.ts:346-351` - the
one-shot `stdout.on('data')` callback runs `parser.push(chunk)` with NO try/catch, while the
resident client wraps the identical call and routes failure into typed `fail()`
(`native-process-scope.ts:176-182`). A throw from `push` (oversized/corrupt length field)
escapes the stream event handler as an uncaught exception - the wrapper's try/catch around
`await capsule.inspect/terminate` is not on that path and cannot contain it.

**Ruling: RESURFACED as 0.2.0 acceptance, Major (original canonical severity), with a
concrete task.** The `transportLost` latch does not touch this defect: the latch governs
terminal minting; RC-004 is parser containment. What IS safe and bounded about the remaining
probe-translation window: the probe call is deadline-bounded (`awaitControl` at `:361-365`,
probe child SIGKILLed on timeout `:371-373`), unknown frames are ignored but resolve to typed
rejection on close/timeout (`:352-358`), and terminal minting from probe answers is gated
(checklist 2). Only the uncaught-throw crash path survives.

Concrete task: mirror the resident client's containment in `oneShotProbe` - wrap the data
callback, reject `result` with a typed `ProcessScopeError` (phase `inspect`/`terminate`) -
and add oversized/truncated/duplicate/unknown-frame discriminators through the existing
`fake-process-capsule.ts` probe seam, proving the daemon survives with typed uncertainty.
This edits one byte-pinned TypeScript adapter file (never the Rust crate), so it requires a
LEAD-authorized rebaseline of `native-process-scope.ts` in both `LEGACY_PROCESS_CAPSULE_INPUTS`
lists with lineage, exactly per the `0f7eda09` precedent. Venue: this change's fix round -
this change made the probe production-reachable, and the test seam to discriminate the fix
already lives here. The closure `decision13-regrade.md` RC-004 entry must be updated from its
conditional park to this ruling either way. Exploitability note for severity calibration: the
probe child is our own hash-verified helper, so the trigger requires our own defect - which
is precisely the decision-12 threat model this obligation defends against.

### 2. D3 fix audit - the transportLost latch

Failure chain re-traced and confirmed from code, not the receipt alone: killing the capsule
controller fires `CapsuleClient.fail()` (`native-process-scope.ts:184-199,260-270`), which
rejects `closed` AND clears `controlAvailable`; KILL_ON_JOB_CLOSE (proven live by 7.2)
destroys the Job; subsequent capsule calls for the ref fall through to the one-shot probe
(`:481`, `:513`), which answers "gone"; the pre-fix wrapper applied the D4 translation and
minted a releasing terminal. That is SEC-001's literal shape and it existed in shipped code
until `0346ba29`.

Both consumption paths verified:

- **inspect()-after** (the leg the always-green deterministic guards missed, because
  `closeDurableProcess` calls inspect first - `host.ts:707`): guarded twice. The latch
  (`win32-best-effort-scope.ts:327`) and, independently of latch timing, the backstop at
  `:339-344` - an owned ref whose capsule answer is the exact "gone" claim can only have come
  from the probe, and returns `LOST_CONTROL_OBSERVATION`. The backstop also covers the
  pre-latch race window.
- **terminate()'s return**: the latch at `:363`. Verified reachable-callers: `processScope.
  terminate` has exactly ONE call site in the host (`host.ts:716`), gated on
  `observation.controllable` (`host.ts:715`), so the probe-closed-for-owned-ref answer cannot
  reach `translateTermination` through the host (inspect returns uncertainty first). Residual
  recorded as finding F2 (Minor): the guarantee rests on that call-structure invariant rather
  than on the wrapper itself.

Regression-guard discrimination: the implementer's mutation wave (`af21ba8d`) predates the
latch fix (`0346ba29`), so the new guard had no RED counterpart. This reviewer supplied it:
with `state.transportLost = true` replaced by a no-op (byte-exact backup taken; module hash
`76bf15cb...` before and after restore), the suite failed EXACTLY at "never lets a post-loss
probe turn a scope we owned into a terminal" (1 failed | 18 passed), through the re-terminate
leg; the inspect leg stayed protected by the `:344` backstop, which is the two-layer defence
working as designed. Restored byte-exact; suite 19/19 green; `git diff --numstat -- src/
test/` empty.

**Verdict: fix verified, discriminating, with one Minor hardening residual (F2).**

### 3. Tier honesty assertions

Confirmed at `host.ts:652-661`: `toHostedProcessTerminal` writes `emptiness: 'unproven'` as a
hardcoded literal - Record-level assertions structurally cannot detect a lying scope, exactly
as the implementer found by mutation on the real kernel (6.2/6.3 stayed green against a
proven-empty-claiming module until strengthened). Verified the strengthening: 6.2 and 6.3 now
also assert the scope's own `live.closed` receipt and all three real-kernel tests fail against
the mutation (`linux-real-kernel-receipts.md`). On win32 the scope-receipt assertions live in
`win32-best-effort-scope.test.ts` and are proven by mutations (a) and (f) - both receipts
re-read, RED counts and named failing tests present.

**Ruling on `darwin-declaration-gated-release.test.ts` (same weakness, pre-existing):
record-and-defer.** Justification: that suite's subject is host release gating, which is
tier-agnostic host code discriminated per-path by mutations (d1)/(d2) through the cutover
suite; POSIX tier honesty itself is discriminated by mutation (e), which fails 8 tests across
`darwin-best-effort-scope.test.ts` and `darwin-live-close-terminal.test.ts` including
scope-receipt assertions on the identical shared module. Strengthening the darwin release
suite would re-prove code paths already discriminated elsewhere and belongs, if anywhere, to
the macOS change's ECP-8 receipts wave.

### 4. SEC-001 conditional check

The check my re-grade named: transport/controller loss on BOTH shipped scopes must yield
retained typed uncertainty, never a release-authorising terminal, with facts persisting until
a genuine protocol outcome.

- win32: decided by `evidence/win32-real-host-receipts.md` 7.3 - controller killed mid-session
  on the real host, `recovered === 0`, `record.process` still defined, no terminal written,
  despite a valid pre-start declaration - plus the four deterministic loss guards, mutation
  (b), the per-path release mutations (d1)/(d2), and this reviewer's own latch mutation.
- POSIX: no external control transport exists in-process; no loss path constructs a terminal
  (terminals are minted only by the cancel protocol and the observed-empty completion watcher;
  `closed` settles only via `settleTerminal`). Daemon death is decision 11's `execution-lost`,
  owed by the executor change, not this seam.

**Verdict: the structural closure the cutover promised is CONFIRMED on this tree.** The
deciding evidence lines are the 7.3 receipt quoted above and the latch-mutation RED. Two
bounds on this confirmation: F1 (RC-004 crash path) is a separate, open defect on the same
probe plumbing, and F2's hardening residual stands. Formally closing SEC-001 remains the
closure re-review's act, per my own accounting file; this review supplies its evidence.

### 5. RC-002 residual

Verified in `posix-best-effort-scope.ts`: `terminate` is bounded by `withPhaseDeadline`
(`graceMs + finalObservationMs + controlTimeoutMs`, `:512-522`) with a typed timeout receipt;
the cancel protocol's two waits are each budget-bounded (`pollGroupEmpty` `:213-221`);
natural completion settles from an observed group absence with zombie-tolerant semantics
(ESRCH-only absence, `:74-86` - an unreaped member keeps the group visible and the poll simply
continues; the leader zombie is reaped by Node before `exit` fires). The real-kernel 6.4
receipts prove both natural-exit legs (exit code 23; SIGTERM) reach bounded declared-unproven
terminals. No caller-facing unbounded wait exists; the background completion watcher runs only
while group members genuinely live, which is honest non-termination, and stops on
terminal/cancel. **Satisfied.**

### 6. S2

- POSIX root-exit: `root-exited` is a distinct phase and rootExit fact (`:383-394`); the
  completion terminal is minted only from observed group emptiness (`:300-318`); 6.4 receipts
  carry exact code XOR signal, both with `emptiness: unproven`.
- win32 never mints the capsule's proven claim: wrapper translation (checklist 2), source-scan
  guard, and mutation (f) - the narrowed guard (`state:` vs `phase:` spelling) was re-proven
  by that mutation, which is the correct discipline for a narrowed guard.
- Job teardown receipted: 7.2 (daemon death, real chain, every link observed - controller died
  on stdin EOF, workload AND detached descendant gone) and 7.1 (cancel path, workload pid
  really gone via tasklist).

**Satisfied.** Note: no real-host receipt exercises win32 natural root-exit with a surviving
Job member (the closed promise simply stays unsettled until Job accounting empties); the
structure is verified deterministically and the case is not required by the delta spec.

### 7. S4 enumeration on the win32 delegation (owed to this review by name)

Every control phase reachable from the shipped win32 path, enumerated from
`native-process-scope.ts` + the wrapper, with its bound and typed outcome:

| # | Phase | Bound | Typed outcome |
| --- | --- | --- | --- |
| 1 | prepare (resident) | `awaitControl('prepare', controlTimeoutMs)` `:411`; child SIGKILLed on timeout | `containment-prepare-failed` / propagated typed error |
| 2 | activate | `awaitControl('activate', controlTimeoutMs)` `:435`; abort signal honoured | typed timeout/loss, phase `activate` |
| 3 | prepared abort | `awaitControl('abort', controlTimeoutMs)` `:451` | `uncertain`, failure phase `abort` (wrapper: `uncertainFromError`) |
| 4 | inspect (resident) | synchronous local-state read - no control wait exists | n/a |
| 5 | inspect (one-shot) | `awaitControl('inspect', controlTimeoutMs)` `:361`; probe SIGKILLed on timeout `:371-373` | `process-authority-uncertain` / timeout, wrapper maps to typed uncertain observation |
| 6 | terminate (resident) | `awaitControl('scope-empty', max(controlTimeoutMs, graceMs + controlTimeoutMs))` `:489-493` | `uncertain`, failure phase `scope-empty` |
| 7 | terminate (one-shot) | `awaitControl('terminate', controlTimeoutMs)` via `oneShotProbe` `:513` | typed uncertain per probe outcome |

The wrapper adds no wait of its own; the deliberately never-settling `state.closed` after
transport loss is retained authority, not a control phase, and is guarded ("leaves the hosted
terminal unsettled"). POSIX tier equivalents (activate `:460`, terminate `:512`, abort via
`graceMs: 0` cancel) are likewise bounded. **Enumeration size 7; all bounded with typed
phase-specific uncertainty. S4's narrowed residual is satisfied on this tree** (independent
confirmation for the host change's own ledger still travels with its fresh review).

### 8. Both release paths and mutation coverage

`mutation-receipts.md` audited receipt-by-receipt: (d1) breaks only the observation path and
fails exactly the two observation-path refusal guards on both tiers with the receipt-path
guards green; (d2) is the disjoint mirror. Per-path discrimination is proven; a single-path
suite could not produce that pair. (a), (b), (c), (e), (f) all name their RED tests with
counts and are followed by byte-exact restore and a green wave (58/58 then; 80/80 in this
reviewer's re-run including both pin suites).

Guards WITHOUT a demonstrated failing counterpart, flagged per the delta spec's own
acceptance scenario (finding F3): "leaves the hosted terminal unsettled after transport loss"
(recorded honestly by the implementer; no mutation targets it); the cutover suite's
projection and activation-gate guards (2 of its 10); win32 real-host 7.1/7.2b (7.3's organic
first-run failure demonstrates that suite can fail; the Linux real-kernel suite re-ran its
mutation on the real kernel, the win32 real suite did not). The D3 regression guard was in
this set and was closed by this reviewer's own mutation run (checklist 2).

### 9. Pin rebaseline (concurrent worker)

Landed as `0f7eda09`. Verified by this reviewer: lineage comments present at both pin sites;
the moved digest is exactly the one pin (`rasen/specs/process-authority-provider/spec.md`,
`05257eb1... -> 359db6d9...`); cause commit `2961848b` is the sole commit touching that spec
in history; the new hash matches COMMITTED bytes (`git show HEAD:rasen/specs/
process-authority-provider/spec.md | sha256sum` = `359db6d9f268700bce6591cc26067c6b79025a87
e99d3fc48042f76e71452ef9`, computed by this reviewer); the conformance-helper pin and all
twelve `LEGACY_PROCESS_CAPSULE_INPUTS` digests are untouched; both suites pass in this
reviewer's run (2 + 19 tests). **Verified correct.**

### 10. General pass

- Fresh gates by this reviewer: seven suites - win32 wrapper (19), cutover release (10),
  darwin behavioural (17), darwin live-close (5), darwin release (8), both pin guards (2+19)
  - 80/80 green.
- Whitespace/encoding on committed bytes: `git diff --check b3edf5bc..HEAD` clean; CR scan
  over the committed blobs of the change directory and all process-capsule modules: zero
  matches.
- Design-vs-implementation drift: only the two anchor corrections the implementer recorded
  (receipt path opens `host.ts:715`; fourth declaration gate `host.ts:766`) - both verified
  in code, neither changes a decision.
- Spec delta accuracy: requirements match the implementation and receipts; the one
  conformance gap is F3 (its own "guard discrimination is proven by mutation" scenario is not
  yet true of four guards).
- POSIX move: equivalence receipt is mechanical and complete (one additive comment hunk); the
  no-shim decision held; repointed source-scan guards proven live by mutation (e).
- `hosted-process-scope.ts` POSIX arm drops the options object (`:27`) - same shape as the
  pre-change darwin arm, so no drift; noted only because a future caller passing a `spawn`
  seam for linux will silently not reach the POSIX tier.
- Zero edits confirmed to `host.ts`, `router.ts`, `claude-backend.ts`, registry, and every
  pinned/frozen file (`legacy-freeze-integrity.md` digests from the COMMIT, plus empty
  `git diff --stat` over `native/`).

## Findings

### F1 [Major] RC-004 is live on the shipped win32 path: one-shot probe parser can crash the daemon

- Location: `src/core/session-host/process-capsule/native-process-scope.ts:346-351` (contrast
  `:176-182`); reachable via `win32-best-effort-scope.ts` delegation (D4) - reachability
  proven on a real host (`win32-real-host-receipts.md` 7.2b and the first 7.3 run).
- Scenario: during stale-record reconciliation (or any probe fallback), a malformed/oversized
  frame on the probe's stdout makes `CapsuleFrames.push` throw inside the `data` callback;
  the exception escapes the EventEmitter as an uncaught exception and can kill the daemon
  instead of producing typed uncertainty. Our-own-defect trigger (corrupt install shape,
  future protocol drift), which is the decision-12 threat model.
- Required fix: contain the callback, reject the probe deferred with a typed
  `ProcessScopeError`, add the four malformed-frame discriminators through the existing fake
  capsule probe seam, and perform a LEAD-authorized lineage-recorded rebaseline of the
  `native-process-scope.ts` digest in both pin lists (Rust crate untouched). Recommended
  venue: this change's fix round; update the closure `decision13-regrade.md` RC-004 entry to
  match this ruling.

### F2 [Minor] The transport-loss guarantee on terminate() rests on host call structure, not the wrapper

- Location: `src/core/session-host/process-capsule/win32-best-effort-scope.ts:224-242`
  (`translateTermination` never re-checks `state.transportLost` after the await) and
  `:284-297` (the latch is armed only inside `activate()`, so pre-activation controller death
  never arms it).
- Scenario: any future caller invoking `scope.terminate` on an owned ref without the
  `observation.controllable` gate (today's sole call site `host.ts:715-716` has it) could
  receive a minted terminal from a probe answer in the pre-latch or pre-activation window -
  the D3 violation shape, currently unreachable but structurally possible.
- Required fix: re-check `state.transportLost` in `translateTermination` after the await, and
  treat a probe-derived `closed` for an owned ref as lost control there too (mirror of the
  inspect backstop at `:339-344`); one deterministic guard for the pre-activation leg.

### F3 [Minor] Four guards lack the demonstrated failing counterpart the delta spec requires

- The delta spec's acceptance scenario ("Guard discrimination is proven by mutation") is not
  yet true of: the transport-loss "terminal stays unsettled" guard (implementer-recorded),
  the cutover suite's projection and activation-gate guards, and the win32 real-host
  7.1/7.2b receipts (no real-path mutation; the Linux side did re-run its mutation on the
  real kernel). Fix: one mutation each, or an explicit recorded waiver narrowing the spec
  scenario to release/honesty guards.

### F4 [Minor] Both new tier modules reproduce the RC-005 retention shape

- Location: `posix-best-effort-scope.ts:177` (`scopes` map, entries never deleted) and
  `win32-best-effort-scope.ts:198` (same). Terminal replay is deliberate, but a long-lived
  daemon accumulates one entry per session forever - the exact shape RC-005 (Minor, open
  0.2.0, closure task 12.8) recorded against the legacy client map.
- Required fix: fold into closure 12.8 so one lifecycle rule covers all three maps (legacy
  `clients`, POSIX `scopes`, win32 `scopes`); no separate fix here if closure lands it.

## Overall verdict

**CHANGES_REQUIRED - Blocker: 0, Major: 1 (F1), Minor: 3 (F2, F3, F4).**

The change is otherwise strong: the honest-terminal structure is real, discriminated, and
receipted on both real kernels; the one Major is a narrow, concrete parser-containment task
that this change's own reachability decision (D4) promoted from parked to live. Tasks
9.x-equivalent ship/archive actions must wait for the fix round and a delta re-review of F1
(and F2 if taken now). The SEC-001 evidence package (checklist 4) is ready for the closure
re-review regardless, since the F1 crash path cannot mint a terminal or release authority.
