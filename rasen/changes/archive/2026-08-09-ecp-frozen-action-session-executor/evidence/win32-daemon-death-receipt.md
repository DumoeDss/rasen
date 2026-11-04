# Windows zero-orphan daemon-death teardown receipt [THIS-HOST]

Task 10.3. Re-proves the cutover's receipted `KILL_ON_JOB_CLOSE` chain on this
tree (the cutover receipted it first; this change consumes it, does not
re-derive). Locked decision 13 / decision 11 receipt shape: Windows proves
zero-orphan daemon-death teardown; scope lifetime equals daemon lifetime, so the
in-flight Action is typed `execution-lost` (proven deterministically in
`action-outcome.test.ts`) and the Run resumes from the committed frontier.

## Provenance (task 10.5)

| Field | Value |
| --- | --- |
| Host | this Windows development machine |
| OS | Windows 11 Pro, build 10.0.26200 |
| Node | v24.14.0 |
| Branch | `wip/ecp-shared-bounded-loop-lifecycle-resume` |
| Worktree | `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle` (shared) |
| Capsule helper | `dist/native/process-capsule/win32-x64/rasen-process-capsule.exe` (packaged artifact, resolved by the production resolver) |
| Driver | `rasen/changes/archive/2026-08-07-ecp-hosted-best-effort-cutover/evidence/win32-daemon-death-driver.mjs` (the cutover's receipted driver, re-run unchanged) |
| Run date | 2026-08-08 |

## Method

The driver (the cutover's, re-run unchanged) spawns a stand-in daemon that
drives the REAL production capsule controller to start a REAL workload that
itself spawns a REAL descendant, then holds the controller's stdin open. The
driver kills the daemon with `taskkill /F` — **no cancel, no TERMINATE frame is
ever sent** — and re-checks every pid with `tasklist` (the OS's own answer;
`process.kill(pid, 0)` is deliberately not used because on Windows it can report
a lingering handle as alive).

What is real: the platform selection (`createHostedProcessScope()` with no
platform override), the packaged capsule helper, the Job object, the workload +
descendant processes, and the host's release rule. What is substituted (and
labelled because it bounds the claim): the workload is a sleeping `node -e`
rather than the Claude CLI, and the daemon is a stand-in. The ProcessScope
beneath, the capsule, and the host above are production code on the production
path.

## Result (this run)

```
$ node rasen/changes/archive/2026-08-07-ecp-hosted-best-effort-cutover/evidence/win32-daemon-death-driver.mjs \
    dist/native/process-capsule/win32-x64/rasen-process-capsule.exe

daemon pid          : 20472
capsule controller  : 36712
workload leader pid : 24656
descendant pid      : 51796
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

Every link observed, not argued: the controller (36712) died although nothing
killed it directly — its stdin reached EOF when the daemon was killed — and both
the workload leader (24656) and its descendant (51796) were gone afterward. The
descendant matters: it is the process a PID-based teardown would have missed.

## What this is and is not

This is zero-orphan daemon-death teardown on Windows via the Job
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` handle-close chain. It is NOT proof of
exact cancel: the hosted tier still declares `exactCancel: false` /
`scopeEmptyProof: false` before start (proven in `capability-matrix.test.ts`),
and a cancel terminal is `cancelled / emptiness-unproven` (locked decision 13).

The `execution-lost` Action-outcome typing that this daemon-death triggers is
proven deterministically at the executor's reconciliation point
(`action-outcome.test.ts > daemon death types the in-flight Action
execution-lost`), and the committed-frontier resume partition is proven in the
same file. The Windows receipt here proves the substrate fact those
deterministic guards compose with: on Windows, daemon death really does tear
down the whole scope with zero orphans.
