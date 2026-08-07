# POSIX pre-flight oracles (tasks 6.1-6.5)

## NON-ACCEPTANCE EVIDENCE - WRONG OS

Every receipt in this file was taken on **Linux (WSL2)**, not macOS. It does
**not** satisfy the macOS acceptance gate. Tasks 7.1-7.6 remain open and this
change is **non-terminal** until real macOS receipts exist. This label is task
6.5 and it is written here, inside the evidence file, on purpose.

What Linux does and does not tell us:

- It does exercise real `setsid()`, real process groups, real `kill(-pgid, ...)`
  delivery, real SIGTERM trapping, and real reparenting - on a real kernel, not
  a fixture.
- It does **not** exercise Darwin signal semantics, launchd reaping of
  reparented descendants, or macOS process-group id reuse behavior. Those are
  exactly why task 7.2 re-runs these same oracles on macOS.

## How the oracles run

`evidence/oracles/posix-preflight.mjs` imports the **compiled production
module** `dist/core/session-host/process-capsule/darwin-best-effort-scope.js`.
There is no reimplementation of the protocol in the harness; the harness only
starts real workloads and observes real pids. For each mutation receipt it
writes a one-line-patched copy of that same compiled module beside it (so the
relative import of `process-scope.js` still resolves), imports the mutant, and
runs the identical scenario.

Reproduce:

```sh
node <repo>/rasen/changes/ecp-macos-process-authority-provider/evidence/oracles/posix-preflight.mjs <repo>
```

Requires `dist/` to be current (`node build.js`). Exit code is non-zero if any
oracle fails.

## Result

Run three consecutive times; all six oracles passed on every run. Full receipt
of the third run:

```json
{
  "provenance": {
    "platform": "linux",
    "release": "5.15.167.4-microsoft-standard-WSL2",
    "node": "v22.21.0",
    "host": "Sayo",
    "ranAt": "2026-08-07T08:44:02.930Z",
    "acceptance": false,
    "acceptanceNote": "NON-ACCEPTANCE (wrong OS). Real macOS receipts are required for tasks 7.1-7.6."
  },
  "results": [
    {
      "id": "6.1-correct",
      "label": "leader exits instantly, surviving descendant",
      "expectation": "group SIGKILL at grace expiry removes the descendant; terminal emptiness-unproven",
      "observed": {
        "descendantGone": true,
        "forced": true,
        "emptiness": "unproven",
        "outcome": "cancelled"
      },
      "pass": true
    },
    {
      "id": "6.1-mutant",
      "label": "MUTATION: escalation keyed to leader exit instead of whole-group emptiness",
      "expectation": "the guard must go RED: the descendant is left alive and no force happens",
      "observed": {
        "descendantGone": false,
        "forced": false,
        "groupObservedEmpty": true
      },
      "pass": true
    },
    {
      "id": "6.2-correct",
      "label": "descendant traps SIGTERM and forces escalation",
      "expectation": "group SIGKILL removes both the trapping leader and the trapping descendant",
      "observed": {
        "descendantGone": true,
        "leaderGone": true,
        "forced": true
      },
      "pass": true
    },
    {
      "id": "6.2-mutant",
      "label": "MUTATION: signals delivered to the leader alone instead of the whole group",
      "expectation": "the guard must go RED: the descendant survives a completed cancel",
      "observed": {
        "descendantGone": false,
        "leaderGone": true
      },
      "pass": true
    },
    {
      "id": "6.3-escape-demo",
      "label": "descendant leaves the group via setsid() and survives a completed cancel",
      "expectation": "group observes empty, escapee lives, record still says emptiness-unproven and never proven-empty",
      "observed": {
        "escapeeAlive": true,
        "groupObservedEmpty": true,
        "emptiness": "unproven",
        "settledOutcome": "cancelled",
        "receiptText": "{\"state\":\"declared-unproven\",\"gracefulAttempted\":true,\"forced\":false,\"unproven\":{\"state\":\"declared-unproven\",\"outcome\":\"cancelled\",\"emptiness\":\"unproven\",\"groupObservedEmpty\":true,\"forced\":false,\"rootExit\":{\"code\":null,\"signal\":\"SIGTERM\"}}}",
        "claimsProof": false
      },
      "pass": true
    },
    {
      "id": "6.4-natural-empty",
      "label": "natural completion reports the exact root exit",
      "expectation": "exact exit code XOR exact terminating signal; completion terminal still emptiness-unproven",
      "observed": {
        "exitedRoot": {
          "state": "root-exited",
          "code": 23,
          "signal": null
        },
        "exitedTerminal": {
          "outcome": "completed",
          "emptiness": "unproven"
        },
        "signalledRoot": {
          "state": "root-exited",
          "code": null,
          "signal": "SIGTERM"
        },
        "signalledTerminal": {
          "outcome": "completed",
          "emptiness": "unproven"
        }
      },
      "pass": true
    }
  ]
}
```

## What each receipt actually shows

**6.1** (task 6.1). The leader exits on its own 30ms after start, before cancel
is even issued. A real descendant that traps SIGTERM survives the graceful
phase. The correct build still runs the full 300ms grace and delivers group
SIGKILL at expiry (`forced: true`), and the descendant is gone afterwards.

The **leader-exit-keyed mutant** of the same real workload shows the defect in
its most damaging form: `forced: false`, no SIGKILL delivered, `descendantGone:
false` - and `groupObservedEmpty: true`. The mutant does not merely leak a
process; **its record lies**, claiming the group was observed empty because the
leader exited. That is precisely the invariant this change protects.

**6.2** (task 6.2). Both the leader and the descendant trap SIGTERM. The correct
build escalates and removes both. The **leader-only-kill mutant** removes only
the leader (`leaderGone: true, descendantGone: false`) - a signal sent to a pid
instead of a process group reaches nothing else.

**6.3** (task 6.3, the flagship honesty receipt). A descendant is spawned with
`detached: true`, i.e. real `setsid()`, so it leaves the workload's process
group before cancel. Cancel completes, the group observes empty
(`groupObservedEmpty: true`), and **the escapee is still alive**
(`escapeeAlive: true`). The receipt is verbatim in the JSON above: the state is
`declared-unproven`, `emptiness` is `unproven`, and nothing anywhere in the
receipt states or implies proven emptiness (`claimsProof: false`, checked
against the serialised receipt for `scope-empty`, a `closed` state, and any
non-`unproven` emptiness).

**6.4** (task 6.4). Two real workloads: one exiting with code 23
(`{code: 23, signal: null}`), one signalling itself (`{code: null, signal:
"SIGTERM"}`) - exactly one of the two in each case, reported separately from any
emptiness statement. Both completion terminals still record
`emptiness: "unproven"` even though the group did in fact become empty.

## Known limitation of this harness

`oracle63` reads `alive(escapee)` immediately after cancel returns. On a slower
kernel a scheduling delay could in principle let a doomed process still look
alive - but the escapee here is not doomed: it is in a different process group
and receives no signal at all, so the observation is not timing-sensitive. The
6.1/6.2 descendant checks use a bounded `waitFor` rather than an instant read
for the opposite reason.

An earlier iteration of the harness was genuinely flaky: it cancelled before the
descendant had installed its SIGTERM handler, so group SIGTERM sometimes killed
it by default action and `forced` came back false. That was a harness defect,
not a provider defect; it is fixed by a readiness marker the descendant writes
only after installing its handler. It is recorded here because the first
observed failure looked exactly like a provider bug.
