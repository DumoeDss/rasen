# activate -> reference-invalid: root cause on the TypeScript coordinator path

Date: 2026-08-07\
Author: debugger (successor to the Section 12 implementer), leaf worker.\
Question: why `activate` never reaches `live` through the TypeScript coordinator path, and whether
that is a product defect or a test defect.

## Verdict, stated first

Five distinct defects were found. They are not the same defect and they do not have the same owner.
Defects 1, 3 and 5 are test defects and are fixed here; defects 2 and 4 are product defects in the
frozen crate and are reported, not touched.

| # | Defect | Where | Class | Fixed here |
| --- | --- | --- | --- | --- |
| 1 | The oracle's daemon fixture activates a scope whose runtime bridge was never opened. The guardian refuses that, correctly. | `test/fixtures/linux-process-authority-daemon-lifetime-daemon.mjs` | **TEST** | **Yes** |
| 2 | On `activate` the control client returns its own `InvalidData` for any guardian `Failure` frame, destroying the guardian's typed failure code before it can be read. | `native/linux-process-authority/src/primary.rs:294-299` | **PRODUCT** | **No - crate frozen at `89f6c1d5`** |
| 3 | The same fixture held its liveness on a pending promise, which is not an event-loop handle, so the daemon exited 13 silently the moment the bridge's helper was killed. | same file | **TEST** | **Yes** |
| 4 | `open-runtime` parses `--deadline-ms` and discards it, so a long-lived streaming socket inherits the 2 s control read timeout and the runtime bridge dies after 2 s of workload silence. | `main.rs:141` with `primary.rs:114-120` | **PRODUCT** | **No - crate frozen at `89f6c1d5`** |
| 5 | The oracle read three markers written on three independent clocks at the instant the first of them landed. Intermittently RED on `escaped-doublefork`. | `test/core/session-host/linux-process-authority-daemon-lifetime.test.ts`, the escape-marker assertion after `root-completed` | **TEST** | **Yes** |

Defect 1 is the whole of the reported RED. Defect 2 is why that RED named the reference instead of
the missing bridge. Defects 3, 4 and 5 were found downstream, by fixing defect 1 and watching what
the oracle did next; defect 4 in particular is a live product defect on the same never-crossed path.
Defects 3 and 5 had never been observable, because the case that reaches them could not run.

## The exact producer that fires

```text
primary.rs:298   Err(invalid_response("activation-ready"))
primary.rs:2588  invalid_response -> io::ErrorKind::InvalidData
protocol.rs:179  from_control_error: InvalidData -> NativeFailureCode::ReferenceInvalid
main.rs:217-231  helper writes Frame(Failure, [0,1,7]) and exits 70
native-assembly.ts:495   7 -> ['authority-unavailable', 'reference-invalid']
outcomes.ts:48-50,92-103 -> "Linux process authority is retained (reference-invalid)."
```

`control_on_until` checks the shape of the **first** activate response before it checks whether that
response is a `Failure` frame:

```rust
if operation == ControlOperation::Activate {
    if response.kind != FrameKind::ActivationReady
        || response.payload != deadline.absolute_ns()?.to_be_bytes()
    {
        return Err(invalid_response("activation-ready"));   // primary.rs:294-299
    }
    ...
}
if response.kind == FrameKind::Failure {                     // primary.rs:315-318
    let failure = NativeFailure::decode(&response.payload)?;
    return Err(io::Error::other(failure.code.diagnostic_code()));
}
```

For every other verb the `Failure` branch at `:315` is reached and the guardian's own code survives
the trip, because `from_control_error` matches the diagnostic string exactly (`protocol.rs:163-175`).
For `activate` the branch at `:294` returns first, so it is unreachable, and every guardian refusal
- whatever its cause - arrives at the caller as `reference-invalid`.

## Root cause of the RED

The guardian refuses to activate a scope whose runtime bridge is not open:

```rust
ControlOperation::Activate => {
    if self.runtime.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::NotConnected,
            "runtime bridge must open before activation",
        ));                                                  // primary.rs:1283-1289
    }
```

`self.runtime` is `None` at guardian construction (`primary.rs:877`) and is set at exactly one place:
a successful `OpenRuntime` control operation (`primary.rs:1233`).

**Production honours that order.** `process-scope-adapter.ts:184-216` does
`publish -> openRuntime -> activate`, and aborts the scope if the bridge cannot be opened.

**Every native oracle honours it too** - `linux_primary_contract.rs:533-534` and `:576-577`, and
Section 12's own `linux_daemon_lifetime_contract.rs:495-496`, all call `open_runtime()` on the line
before `activate()`. That is why the crate's activate is green and the TypeScript path is red: they
were never driving the same sequence.

**The daemon fixture did not.** It drove `coordinator.prepare -> prepared.publish ->
published.activate()` and opened no bridge, so it asked the guardian for something the guardian is
built to refuse. The first end-to-end test of a never-tested path found a defect in the test.

The guardian's error there is `NotConnected`, whose own typed code is `Uncertain` (2) - read off
`from_control_error`'s fallthrough (`protocol.rs:176-186`), not measured, because defect 2 destroys
it before it can be observed. Defect 2 is what turned it into `ReferenceInvalid` (7), and that is
the only reason the diagnostic pointed at the reference. The reference was never at fault, which
Probe 2 does measure.

## Reproduction and bisection

All runs are on the actual WSL2 kernel, in the isolated ext4 run tree
`/home/sayo/.local/share/rasen-build/ts-oracles-tree`, against the package root
`/home/sayo/.local/share/rasen-build/s12-refreeze-a` (bound to `89f6c1d5`). Nothing was run inside
the repository and no crate source was modified.

The tree was re-synced from the repository first, so the predecessor's `bindsDaemonLifetime = false`
control patch is **not** present: `bindsDaemonLifetime = mode === 'user-pidns'` and the run tree
carries one `--daemon-lifetime-fd` occurrence.

### Probe 1 - reproduce

```text
P1 prepare=prepared-inert
P1 publish=published-inert
P1 activate={"state":"authority-unavailable", ...
             "diagnostic":"Linux process authority is retained (reference-invalid)."}
```

Reproduced exactly, through the coordinator, with the wiring enabled.

### Probe 2 - the reference is not at fault

The **same** decoded private reference, the same scope, the same control socket, driven through
`transport.inspect` immediately after the failed activate:

```text
P2 transport.inspect(same reference)={"state":"inert"}
P1 abort={"state":"exact-scope-empty"}
```

`inspect` crosses every stage `activate` crosses except the activate-specific branch: it decodes the
attestation in the helper, validates the control socket, completes the server-first challenge, and
passes the guardian's capability and identity check. It returned a valid observation. That single
measurement eliminates every verb-independent producer of `reference-invalid` at once.

The `inert` result is also load-bearing for pinning the producer: after the failed activate the state
machine is still inert, so `spawn_root` never ran and the guardian never emitted `ActivationReady`.
The client therefore returned on the **first** response frame, which is `primary.rs:298`, not
`primary.rs:132` (`invalid_response("activated")`, reachable only after the gate exchange).

### Probe 3 - the ordering is the cause

Same code, one line added, mirroring `process-scope-adapter.ts`:

```text
P3 prepare=prepared-inert
P3 publish=published-inert
P3 runtime bridge opened
P3 activate={"state":"live", ...}
```

**This is the first time `activate` has reached `live` through the TypeScript coordinator path.**

### Probe 4 - the guardian's typed code does not survive activate

A second `activate` on the now-live scope. The guardian answers that with `InvalidInput`
("guardian activation is exactly once", `primary.rs:1290-1295`), whose own typed code is
`StateRetained` (9):

```text
P4 second transport.activate={"state":"authority-unavailable","diagnosticCode":"reference-invalid"}
P4 terminate={"state":"exact-scope-empty"}
P4 inspect={"state":"exact-scope-empty"}
```

A different guardian error, the same output. `reference-invalid` is what `activate` says when the
guardian says anything at all.

### Probe 5 - same-cause A/B, the discriminating measurement

The strongest form of the same claim, on one scope, with one guardian error class. On a
published-inert scope the guardian answers `terminate` with `InvalidInput` ("scope is not
activated", `primary.rs:1385-1387`) - the same `ErrorKind` it answers a repeat activate with:

```text
AB prepare=prepared-inert
AB publish=published-inert
A terminate(not-activated)={"state":"authority-uncertain","diagnosticCode":"native-state-retained"}
B activate(no-runtime-bridge)={"state":"authority-unavailable","diagnosticCode":"reference-invalid"}
AB inspect after both={"state":"inert"}
AB abort={"state":"exact-scope-empty"}
```

Same scope, same socket, same reference, same guardian, same error kind. `terminate` preserves the
guardian's typed code because it reaches `primary.rs:315`; `activate` replaces it because it returns
at `primary.rs:298` first. This is the discrimination: the branch under suspicion is the only thing
that differs between A and B.

## Enumeration of every producer, and how each was eliminated

Enumerated by reading both codecs and both control paths, not by sampling the diagnostic string.

| # | Site | Emits 7 when | Disposition |
| --- | --- | --- | --- |
| 1 | `provider.ts:826` / `:848` / `:865` | `decodeForProvider` returns undefined | **Unreachable from activate.** `preparedAuthority.activate` (`provider.ts:545-555`) uses the reference decoded at prepare and has no such guard. By code path, not by measurement. |
| 2 | `main.rs:19-27` `one_input` | frame header invalid or kind mismatch -> `InvalidData` | Eliminated by P2/P5-A: `inspect` and `terminate` send the same frame shape and succeeded. |
| 3 | `main.rs:131` `PreparedAttestation::decode` | version, bounded string, or trailing bytes -> `InvalidData` (`authority.rs:173-200`) | Eliminated by P2/P5-A: the identical attestation bytes decoded for `inspect` and `terminate`. |
| 4 | `AuthorityClient::new` -> `reopen_scope_directory` | ownership or mode wrong -> `PermissionDenied` (`runtime.rs:105-118`) | Eliminated by P2/P5-A: verb-independent, and both succeeded. |
| 5 | `validate_control_socket` (`primary.rs:2209-2222`) | socket not 0600, not owned, or not a socket -> `PermissionDenied` | Eliminated by P2/P5-A: verb-independent. |
| 6 | `verify_server_challenge` (`primary.rs:2101-2120`) | challenge malformed -> `InvalidData`; MAC mismatch -> `PermissionDenied` | Eliminated by P2/P5-A: the challenge is sent on every accepted connection (`primary.rs:1224`) and both verbs completed it. |
| 7 | guardian `handle_control` auth (`primary.rs:1258-1267`) | capability, identity, or frame-kind mismatch -> `PermissionDenied` -> `Failure(7)` -> relayed at `:317` | Eliminated by P2/P5-A: the same capabilities and identity authenticated for `inspect` and `terminate`. |
| 8 | guardian `ControlRequest::decode` (`authority.rs:252-308`) | any malformed field -> `InvalidData` -> `Failure(7)` -> relayed | Eliminated by P2/P5-A: same encoder, same fields. |
| 9 | `NativeFailure::decode` (`protocol.rs:201-207`) | failure payload malformed -> `InvalidData` | Eliminated by P5-A: a `Failure` frame was decoded successfully on the terminate path in the same run. |
| 10 | `activate_until` (`primary.rs:131-133`) `invalid_response("activated")` | response after the gate release is not `Activated` | Eliminated by P2: the machine was still `inert` and no root was spawned, so the gate exchange never happened. |
| 11 | **`control_on_until` (`primary.rs:294-299`) `invalid_response("activation-ready")`** | the first activate response is anything but `ActivationReady`, including a `Failure` frame | **STANDS. Positively confirmed by P5's A/B.** |

## What fixing defect 1 uncovered

Fixing the ordering moved the oracle from "activate is RED" to one case passing and one failing on a
new symptom: `Timed out waiting for the workload to finish`, with the daemon's captured stderr empty.

### Probe 6 - the scope is not the problem

The oracle's second case, run in-process so every terminal signal is visible instead of inferred
from a missing marker file:

```text
t+    86ms runtime bridge opened
t+   103ms activate=live
t+  1106ms markers=[live-root live-setsid live-doublefork]
t+  2109ms rootExited REJECTED: {"state":"timeout","diagnosticCode":"native-operation-timeout"}
t+  2109ms exactScopeEmpty REJECTED: {"state":"timeout","diagnosticCode":"native-operation-timeout"}
t+  7123ms markers=[... escaped-root escaped-setsid escaped-doublefork root-completed]
```

The workload ran to completion. So the scope was never killed early - but **the runtime bridge died
2.0 s after activation**, and with it the only channel through which `rootExited` and
`exactScopeEmpty` can ever be observed.

### Defect 4, read off the source and matching the measurement

`main.rs:134-152` validates and parses `--deadline-ms` for `open-runtime` and then throws the value
away (`bounded_u32(&arguments[4])?;` with no binding). The stream it goes on to copy from came from
`AuthorityClient::open_runtime`, which routes through `self.control(...)` (`primary.rs:114-115`) and
therefore through `AbsoluteMonotonicDeadline::after_ms(CONTROL_TIMEOUT)` - and `control_on_until`
sets that budget as the socket's **read timeout** (`primary.rs:278`). `CONTROL_TIMEOUT` is 2 s
(`primary.rs:30`).

So the long-lived streaming socket inherits a 2 s inactivity timeout meant for a single control
round trip. `io::copy` returns `WouldBlock`, `from_control_error` types it `Timeout`, and the helper
emits `Failure(5)` - which is precisely the frame the bridge decoded at t+2109ms. The 300000 ms the
TypeScript side passes (`native-assembly.ts:815`) is discarded on the way.

Every native test that opens a bridge runs a workload that finishes well inside 2 s
(`/usr/bin/true`, `sleep 0.2`), which is why no existing receipt sees this.

**Consequence, not fixed here:** for any workload quiet for 2 s, `ProviderBackedProcessRuntime`'s
`rootExited` and `exactScopeEmpty` reject with a native timeout, so `process-scope-adapter.ts:228-245`
cannot deliver a root exit or a scope-empty receipt. That is the cancel path, on the primary
provider, on real workloads.

### Defect 3 - why the oracle's second case actually failed

The bridge's failure handler kills the `open-runtime` helper (`native-assembly.ts:773`). In the
fixture that helper's `ChildProcess` was the daemon's last event-loop handle, and
`await new Promise(() => {})` does not hold Node's loop open - a pending promise is not a handle.
Measured directly, running the fixture standalone:

```text
t+2s daemon=alive markers=[live-doublefork live-root live-setsid] ready=yes
t+4s daemon=DEAD  markers=[live-doublefork live-root live-setsid] ready=yes
daemon exit code: 13
```

Exit 13 is Node's silent unsettled-top-level-await exit, which is why the test saw an empty stderr.
The daemon really did die, its endpoint really did close, and the guardian really did tear the scope
down. The oracle was watching its own daemon fall over and reading it as a workload failure.

This is a genuine trap for this specific oracle: **a daemon-lifetime test whose daemon can die by
accident cannot distinguish the property from the accident.** It reports the same absent markers
either way.

### Defect 5 - a marker race, found by repeating rather than by one green run

The first run after fixing defects 1 and 3 was `2 passed`. It was repeated rather than believed, and
the second repeat was RED on a **different** symptom:

```text
repeat 1   2 passed
repeat 2   1 failed | 1 passed
           expected [ 'escaped-root', 'escaped-setsid' ]
           to deeply equal [ 'escaped-doublefork', 'escaped-root', 'escaped-setsid' ]
```

Not a teardown failure. The root and its two resistant descendants each time their own escape
independently - the root on a JavaScript timer, the two descendants on their own `sleep` - and the
double-forked one is started last and through an extra fork, so it reaches its deadline last. The
assertion read all three markers at the instant the root wrote `root-completed`, which is the moment
the earliest of the three clocks expires. This is the same shape as the flake Section 12 already
found and fixed inside the native oracle: an assertion taken on one clock about state produced on
several.

## The fixes that were made

Three, all in test assets.

| Fix | File | What |
| --- | --- | --- |
| 1 | `test/fixtures/...-daemon-lifetime-daemon.mjs` | The daemon opens the runtime bridge between publish and activate, in the order `process-scope-adapter.ts` uses, and holds it for the scope's life. Its streams are drained and both terminal promises are settled locally, because an unhandled rejection here would kill the daemon and forge the teardown under test. |
| 3 | same file | The daemon holds an explicit `setInterval` handle for its liveness, so it depends on nothing that defect 4 can tear down. Only the test's `SIGKILL` ends it. |
| 5 | `test/core/session-host/linux-process-authority-daemon-lifetime.test.ts` | Each escape marker is waited for on its own bounded deadline before the assertion, instead of all three being sampled the instant the first lands. |

Fix 5 does not weaken the case. A torn-down scope writes none of the escape markers, so the wait
expires and the case still fails; only the clock the claim is read on changed.

No production TypeScript was changed. No crate file was changed. No task was ticked.

### Oracle result after the fixes

```text
command  node_modules/vitest/vitest.mjs run
         test/core/session-host/linux-process-authority-daemon-lifetime.test.ts
         --pool=forks --maxWorkers=1 --reporter=verbose
gate     RASEN_ACTUAL_WSL_ORACLE=1, platform=Linux, package root bound to 89f6c1d5

before defects 1+3   1 failed | 1 passed   activate never reached live in either case
after  defects 1+3   2 passed, then 2 passed, then 1 failed (defect 5)
after  defect  5     4 consecutive runs, 2 passed each, exit 0 each
                     kills a live scope when the owning daemon dies       ~11.3 s
                     leaves a live scope alone while the daemon is alive  ~ 7.3 s
```

**These are passing runs, not a receipt, and consecutive passes are evidence of stability rather
than proof of it.** Neither case has been shown to discriminate: the two mutations Section 12 owes -
early release must be RED, never passing the flag must be RED - were explicitly out of scope for
this unit and are not taken. On this codebase an unmutated guard is assumed to have no
discriminating power until shown otherwise. See "Not claimed".

## Defects 2 and 4 are not fixed, and the freeze is why

Both live in `native/linux-process-authority/`, frozen at
`89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643`. Breaking that freeze costs a
re-freeze plus the full receipt re-bind Section 12 has just paid once, so **neither is taken here and
both need a decision from the LEAD** - ideally batched into the post-freeze fix wave `lead-5.md`
already proposes, rather than paid per defect. **Defect 4 is the more serious of the two**: defect 2
misreports a failure, defect 4 makes a terminal observation unreachable.

The repair for defect 2 is to move the generic `Failure` check above the activate-specific shape
check in `control_on_until`, so a guardian refusal keeps its own typed code:

```text
primary.rs:315-318   if response.kind == FrameKind::Failure { ... }      <- must run first
primary.rs:294-299   if operation == ControlOperation::Activate { ... }
```

The repair for defect 4 is to stop discarding `open-runtime`'s `--deadline-ms` (`main.rs:141`) and
give `open_runtime` a budget that is not `CONTROL_TIMEOUT`, so the streaming socket's read timeout is
the caller's bound rather than a control round trip's. Note that this also reaches the crate's own
`RuntimeChannel` callers, whose workloads have so far all finished inside 2 s.

Until defect 2 is taken, this holds and should be assumed by anyone reading a Linux activate
diagnostic:

> **On the Linux primary provider, `activate` reporting `reference-invalid` says nothing about the
> reference.** It means the guardian refused the activation for some reason the client discarded.
> Read `authority-unavailable (reference-invalid)` from `activate` as "guardian refused, cause
> unknown".

Its blast radius beyond diagnostics is real but bounded: `native-assembly.ts:495` maps 7 to
`authority-unavailable`, and `process-scope-adapter.ts:217-227` treats any non-live activation the
same way - terminate, then throw. So no caller currently branches on the distinction. It is a
diagnostic-fidelity defect today and a triage trap for whoever debugs the next activate failure.

## What the LEAD has to route

1. **Decide defects 2 and 4** against the freeze. Defect 4 should be graded before the next wave: it
   makes `rootExited` and `exactScopeEmpty` unreachable for any workload quiet for 2 s, which is the
   cancel path this subsystem exists for.
2. **The two owed Section 12 mutations are now unblocked** and are the next unit. Activate reaches
   `live`, so an early-release mutant can differ from baseline, which it could not before.
3. **`open-runtime` is still crossed by no end-to-end test that outlives 2 s.** Defect 4 was found by
   a probe, not by a test, and nothing in the suite would catch its return.

## Not claimed

1. **Section 12's not-claimed item 1 still stands as written.** No production Linux scope has been
   shown to carry the daemon-lifetime property. Crossing activate was the blocker to testing it, not
   the test. Nothing here was ticked.
2. **The two owed mutations were not taken** - early-release RED and never-pass-the-flag RED. They
   were meaningless while activate was RED for an unrelated reason and are the successor's unit now
   that it is not. **The four green runs above therefore establish nothing about discrimination.**
3. **No claim that the daemon-lifetime wiring works.** P3 shows a scope reaching `live` with the
   wiring enabled; it does not show that the endpoint governs that scope's death.
4. **Defect 2's and defect 4's repairs are untested**, because they were not written. Both are read
   off the source, not measured.
5. **No claim about the broker path.** Every probe here is `user-pidns`. `control_on_until` is shared
   with the broker client, so defect 2 plausibly reaches it, but that was not measured.
6. **Defect 4's blast radius on production is reasoned, not measured.** The 2 s bridge death is
   measured (P6); that `process-scope-adapter.ts` therefore cannot deliver its receipts is read off
   the code, and no adapter-level test was run.
7. **Four consecutive passes are evidence of stability, not proof of it.** Defect 5 needed three runs
   to appear once, so this file records the failing repeat rather than only the passing ones.
8. **Author == verifier.** Nothing here has been reproduced by anyone else.
