# Real Windows receipts [THIS-HOST] - ecp-hosted-best-effort-cutover

Tasks 7.1, 7.2, 7.3, 7.4.

## Provenance (task 7.4)

| Field | Value |
| --- | --- |
| Host | this Windows development machine (the LEAD's dispatch host) |
| OS | Windows 11 Pro, build 10.0.26200.8875 |
| Node | v24.14.0 |
| vitest | 3.2.6 |
| Worktree | `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle` (shared) |
| Branch | `wip/ecp-shared-bounded-loop-lifecycle-resume` |
| Capsule helper | `dist/native/process-capsule/win32-x64/rasen-process-capsule.exe` (the packaged artifact, resolved by the production resolver) |
| Run date | 2026-08-08 |

Everything below spawns real OS processes and checks liveness with `tasklist` -
the operating system's own answer. `process.kill(pid, 0)` is deliberately not
used: on Windows it can report a lingering handle as alive.

What is real: the platform selection (`createHostedProcessScope()` with no
platform override), the packaged capsule helper, the Job object, the workload
and descendant processes, `createSessionHost` and its release rule.

What is substituted, and labelled because it bounds the claim: the workload is a
sleeping `node -e` rather than the Claude CLI, and the sessions are seeded into
the registry rather than dispatched through an HTTP request. The ProcessScope
under test, the capsule beneath it, and the host above it are production code on
the production path.

## Task 7.2 - KILL_ON_JOB_CLOSE daemon-death teardown (real behaviour)

The design (D6) claims a chain: daemon death closes the controller's stdin, the
controller exits on EOF, the last Job handle closes, and
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` makes the kernel terminate the remaining Job
members. D6 states plainly that the chain is plausible from source but is not
assumed. This receipt runs it.

Method (`evidence/win32-daemon-death-probe.mjs` + `win32-daemon-death-driver.mjs`):
a stand-in daemon spawns the real capsule controller, drives the real protocol to
start a real workload that itself spawns a real descendant, and then holds the
controller's stdin open. The driver kills the daemon with `taskkill /F` -
**no cancel, no TERMINATE frame is ever sent** - and re-checks every pid.

```
$ node rasen/changes/ecp-hosted-best-effort-cutover/evidence/win32-daemon-death-driver.mjs \
    dist/native/process-capsule/win32-x64/rasen-process-capsule.exe

daemon pid          : 37708
capsule controller  : 46840
workload leader pid : 50008
descendant pid      : 39484
--- before daemon death ---
workload alive      : true
descendant alive    : true
controller alive    : true
--- killing the daemon with /F (no cancel, no TERMINATE frame) ---
--- after daemon death ---
daemon alive        : false
controller alive    : false
workload alive      : false
descendant alive    : false
VERDICT             : JOB TORN DOWN
```

Every link of the chain is observed rather than argued: the controller (46840)
died although nothing killed it directly - its stdin reached EOF when the daemon
was killed - and both the workload leader (50008) and its descendant (39484)
were gone afterwards. The descendant matters: it is the process a PID-based
teardown would have missed.

The property Windows retains is therefore real. Note what it is not: it is
teardown on daemon death, not proof of exact cancel, and the tier still declares
`exactCancel: false` / `scopeEmptyProof: false`.

## Tasks 7.1, 7.3, 7.2b - production-path receipts

Suite: `test/core/session-host/win32-real-capsule-receipts.test.ts`. Gated on
`process.platform === 'win32'` AND `RASEN_WIN32_REAL_CAPSULE=1`; without the gate
it SKIPS silently, so the asserted count is quoted here rather than an exit code.

```
$ RASEN_WIN32_REAL_CAPSULE=1 npx vitest run test/core/session-host/win32-real-capsule-receipts.test.ts

 ✓ win32 real-capsule receipts on this host (3 tests) 5491ms
   ✓ 7.1 cancels a real Job-backed workload and records cancelled / emptiness-unproven  2432ms
   ✓ 7.3 reports controller loss as retained uncertainty, not a clean detach  2349ms
   ✓ 7.2b reports a ref from a dead daemon honestly and never reattaches  708ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### 7.1 - production-path cancel

Asserted, in order: the declaration (`tier: best-effort`, `exactCancel: false`,
`scopeEmptyProof: false`) is present on the prepared scope BEFORE activation; the
capsule controller was really spawned and is really alive; the workload process
is really alive after activation; `host.reconcileOnStart()` releases the session
(`recovered === 1`); the Record carries
`cancelled / emptiness-unproven`; the workload pid is really gone afterwards -
the Job kill mechanics ran; and the serialised terminal matches neither
`scope-empty` nor `"proven"`.

### 7.3 - transport loss on a real host (the SEC-001 shape)

The capsule **controller** is killed with `taskkill /F` while the workload keeps
running. The session is then reconciled: `recovered === 0`, `record.process` is
still defined, and no terminal was written - authority retained, despite a valid
pre-start declaration being present.

**This receipt failed on its first run, and that failure is the most valuable
result in this section.** See the finding below.

### 7.2b - stale record after daemon death

A fresh `createHostedProcessScope()` instance stands in for the next daemon
lifetime: it holds no in-memory state for the ref and must reconcile it through
the capsule's one-shot probe. The observation is one of
`foreign` / `uncertain` / `declared-unproven`, is never `controllable`, and any
resulting Record text contains no proven-emptiness claim. No reattach occurs -
the module carries a source-scan guard proving it contains no reattach or
identity-revalidation code at all.

## FINDING - the real host caught a D3 violation every deterministic guard missed

On its first run, 7.3 FAILED:

```
 FAIL  7.3 reports controller loss as retained uncertainty, not a clean detach
 AssertionError: expected 1 to be +0
 - Expected: 0
 + Received: 1
```

`recovered === 1` means the session was **released** after nothing but the loss of
its control channel. That is precisely the shape SEC-001 names: "transport loss
can become a clean host detach".

Root cause, and it is an interaction no fixture could easily have produced:

1. Killing the controller triggers KILL_ON_JOB_CLOSE - the very property 7.2 just
   proved - so the Job really is torn down.
2. The capsule's local client is now unavailable, so `inspect` falls through to
   the one-shot probe (`native-process-scope.ts:481`).
3. The probe reports the Job gone (`closed`).
4. The wrapper applied design D4's probe translation - which is written for refs
   from a PREVIOUS daemon lifetime - to a ref THIS daemon had prepared, minting a
   `declared-unproven / completed` terminal.
5. The declaration is present, so `closeDurableProcess` released the session.

The implementation was wrong, not the design. D3 says a declared-unproven terminal
is mintable only from an actual capsule protocol outcome and that transport loss
must yield retained uncertainty; D4's probe translation is explicitly scoped to
"refs the wrapper did not prepare". The wrapper failed to keep those two cases
apart.

Fix (in `win32-best-effort-scope.ts`, no design change):

- `ScopeState` gains a `transportLost` latch, set when the live `closed` promise
  rejects - i.e. when this daemon's own channel dies without an outcome.
- `inspect` and `terminate` return a typed `uncertain`
  (`process-control-lost` / `scope-empty`) for any scope carrying that latch.
- A probe answer of "Job gone" for a ref **this daemon prepared** can no longer
  mint a terminal at all: reaching the probe for such a ref means control was
  lost, because a healthy channel would have settled the terminal itself.
- Refs from a previous daemon lifetime keep the D4 translation unchanged, so
  stale-record reconciliation still does not wedge.

Why the deterministic guards missed it: they injected controller loss and checked
the receipt `terminate()` returned, which was already `uncertain` and still is.
They never asked what `inspect()` says AFTERWARDS - and `closeDurableProcess`
calls `inspect` first. Only a real host, where killing the controller also tears
the Job down and makes the probe answer "gone", closes that loop.

A regression guard was added
(`win32-best-effort-scope.test.ts` - "never lets a post-loss probe turn a scope we
owned into a terminal"), asserting the uncertain observation, the uncertain
re-terminate, refusal by `receiptAuthorizesRelease`, and that the hosted terminal
stays unsettled.

## Consequence for the closure re-grade (task 8.3 input)

SEC-001's shape is now structurally addressed on win32 by an invariant that was
tested against a real host rather than only against fixtures. The verdict still
belongs to the closure re-grade; this change does not mark the finding closed.
Reviewers should note that the guard which would have caught this earlier did not
exist until the real run forced it, which is an argument about how much weight
deterministic transport-loss guards can carry on their own.
