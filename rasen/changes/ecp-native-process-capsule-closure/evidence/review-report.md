# Independent code/spec review

## Verdict

**FAIL — 3 Blocker, 1 Major, 1 Minor, 0 Trivial.**

The Windows implementation and deterministic gates are green, and the evidence
correctly labels Linux/macOS runtime as unexecuted. The Change is nevertheless
not locally review-clean: the POSIX implementation cannot yet satisfy the
authored whole-scope and replacement-closure requirements, and the recorded
ECP-8 commands do not exercise one of the missing containment scenarios.

Mode: dispatched, report-only\
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`\
Change: `ecp-native-process-capsule-closure`\
Greptile: skipped (no PR exists for this local child)

## Scope check

**REQUIREMENTS MISSING.** The reviewed implementation stays within the declared
ProcessCapsule/ProcessScope, minimal host, package, documentation, test, and
Change-evidence boundary. The missing work is inside that boundary: exact POSIX
scope containment/empty observation and exact replacement closure.

## Findings

### RC-001 — [Blocker] [Standards + Spec] POSIX descendants can leave the only containment boundary

`native/process-capsule/src/main.rs:1097-1106` creates only a POSIX process
group, while `native/process-capsule/src/main.rs:877-994` defines emptiness and
termination solely as operations on that numeric group. The backend root is not
the group leader and can call `setsid()`/`setpgid()` (for example, Node
`spawn(..., { detached: true })`), after which the controller can observe the
reserved group as empty and emit `SCOPE_EMPTY` while a worker descendant still
runs outside it. That process is also unreachable by later exact termination.

This violates the platform-neutral detached-descendant scenario in
`specs/durable-process-scope-authority/spec.md:40-51`. The existing Windows
oracle makes its child detached only on Windows
(`test/core/session-host/process-scope-host-closure.test.ts:91-98`), and the
POSIX replacement oracle deliberately leaves its descendant in the inherited
group (`test/core/session-host/process-capsule-posix-replacement.test.ts:90-98`).
The ECP-8 commands in `evidence/platform-obligations.md:15-42` therefore cannot
detect this escape.

**Required fix:** use an OS authority that descendants cannot voluntarily leave,
or fail the affected platform closed as unsupported. Add unchanged real-Linux
and real-macOS oracles in which the backend root or descendant actually creates
a new session/group; neither scope-empty nor `closed` may be reported while it
survives, and exact termination must reap it without touching an unrelated
process.

### RC-002 — [Blocker] [Standards + Spec] Natural POSIX scope-empty waits forever on an unreaped supervisor zombie

The supervisor exits from its wait thread immediately after `ROOT_EXIT`
(`native/process-capsule/src/main.rs:288-301`). Its controller remains the parent
and retains the `Child` in `PosixContainment`, but `is_empty(&self)` only calls
`kill(-pgid, 0)` and never calls `try_wait`/`wait`
(`native/process-capsule/src/main.rs:861-885,958-961`). On POSIX, the exited group
leader remains a zombie and keeps the process group observable until its parent
reaps it. The controller's `ROOT_EXIT` loop consequently cannot reach
`SCOPE_EMPTY` for a naturally empty group.

A Linux WSL kernel probe confirmed the exact premise:
`zombie_process_group_visible_before_wait=True`; the group became eligible to
disappear only after `waitpid`. This predicts failure of the required actual-OS
test at `test/core/session-host/process-capsule-posix-replacement.test.ts:170-200`,
which awaits `live.closed`; it was skipped by the Windows gate.

**Required fix:** make POSIX emptiness observation reap the exact supervisor
(for example, a mutable containment probe using `Child::try_wait`, or a dedicated
exact reaper) before deciding whether the reserved group is absent. Run the
natural-empty oracle on real Linux and macOS and prove exactly one terminal
receipt.

### RC-003 — [Blocker] [Standards + Spec] Replacement inspection reports closed while the exact controller is still alive

Both POSIX branches return observation `2` (`closed`) when the reserved group is
absent even if the controller birth still exactly matches:

- Linux: `native/process-capsule/src/main.rs:1151-1165`, especially the
  `Some(_) if group_state == 2 => return 2` branch.
- macOS: `native/process-capsule/src/main.rs:1251-1265`, with the same branch.

That directly contradicts `specs/durable-process-scope-authority/spec.md:62`,
which permits `closed` only after both the exact controller and process group
are absent. An inspect/reconcile race can therefore clear the durable ref and
writer claim while the source-owned controller still lives; a terminate probe
can also return closed without terminating that controller.

**Required fix:** treat an exact live controller as live/retained even when its
group is empty. For termination, close the exact controller first, then observe
both controller and group absence before returning `closed`. Add controller-live
+ group-empty race cases for Linux and macOS inspection, termination, and
repeated termination.

### RC-004 — [Major] [Standards] One-shot protocol parsing can crash the daemon instead of returning typed uncertainty

The resident `CapsuleClient` catches `CapsuleFrames.push` failures
(`src/core/session-host/process-capsule/native-process-scope.ts:175-181`), but the
replacement `oneShotProbe` data callback does not
(`src/core/session-host/process-capsule/native-process-scope.ts:344-350`). An
oversized frame throws from an EventEmitter callback and can escape as an
uncaught exception during startup reconciliation. Unknown or out-of-order frames
are silently ignored until close/timeout rather than being rejected as a typed
protocol failure.

**Required fix:** wrap the one-shot parser callback, reject the deferred with a
phase-specific `ProcessScopeError`, require exactly one bounded `OBSERVATION`,
and reject every other frame/order. Add oversized, truncated, duplicate,
unknown-kind, and observation-after-error one-shot tests proving the daemon
survives and authority remains retained.

### RC-005 — [Minor] [Standards] Exact-closed local clients remain retained forever

`createNativeProcessScope` inserts every local client into `clients` at
`src/core/session-host/process-capsule/native-process-scope.ts:424`, but no path
deletes an entry after exact `SCOPE_EMPTY`. Later inspect/terminate correctly
falls back to the one-shot helper because the state is closed, yet the map still
retains the `ChildProcess`, streams, deferreds, and buffers for every historical
scope. A long-lived daemon that creates/retires many Sessions accumulates these
objects without a bound.

**Required fix:** delete only the matching client after exact scope-empty (not
on foreign/timeout/control uncertainty), and add a lifecycle test proving closed
entries are released while uncertain entries remain reconcilable.

## Standards axis

- Blocker: RC-001, RC-002, RC-003 (containment correctness, lifecycle races,
  false terminal state).
- Major: RC-004 (uncaught protocol-boundary failure during reconciliation).
- Minor: RC-005 (unbounded exact-closed client retention).
- Worst issue: RC-001 can leave a worker running after Rasen has reported the
  scope empty and discarded its only durable authority.

## Spec axis

- Blocker: RC-001 misses the detached-descendant whole-scope scenario.
- Blocker: RC-002 prevents natural exact scope-empty on POSIX.
- Blocker: RC-003 violates the explicit controller-and-group-absent close rule.
- The S1 macOS 56-byte ABI, S4 bounded native control, S5 narrow provenance,
  registry-v1 byte preservation, resolver adjacency/integrity, Windows
  last-handle topology, and closure-vs-ECP-8 evidence wording were otherwise
  consistent with the reviewed artifacts.
- Worst issue: the current POSIX model can produce either a false close
  (escaped descendant / live controller) or no close (unreaped supervisor).

## Coverage map

```text
ProcessScope / native lifecycle
  PREPARED -> ACTIVATE timeout -> retained authority
    [TESTED] native timeout oracle
    [CHECKED] in-memory host oracle retained registry ref and writer claim
  LIVE -> ROOT_EXIT -> Windows Job empty
    [TESTED] current-host real-process oracle
  LIVE -> ROOT_EXIT -> POSIX natural group empty
    [BLOCKER GAP] supervisor zombie is not reaped (RC-002)
  POSIX replacement -> controller exact + group exact
    [PLATFORM-SKIPPED] resistant-group oracle
    [BLOCKER GAP] controller-live/group-empty branch (RC-003)
  POSIX descendant -> setsid/new group
    [BLOCKER GAP] no containment and no oracle (RC-001)
  one-shot protocol -> malformed/oversized/out-of-order frame
    [MAJOR GAP] callback exception is not converted to typed uncertainty (RC-004)
  exact SCOPE_EMPTY -> local client lifecycle
    [MINOR GAP] closed client is never removed (RC-005)
```

## Commands and receipts

- `node bin/rasen.js status --change ecp-native-process-capsule-closure --json`
  resolved the canonical evidence directory used by this report.
- `pnpm exec vitest run` over the control-deadline, ProcessScope contract,
  host-closure, macOS-identity, and POSIX-replacement files: **5 files passed;
  12 tests passed; 4 actual Linux/macOS tests skipped on Windows**.
- `node bin/rasen.js validate ecp-native-process-capsule-closure --strict`:
  **passed**.
- A no-file, in-memory host oracle injected ACTIVATE timeout plus uncertain
  abort: outcome was `session-busy`, the registry retained the exact
  `runtimeRef`, and writer releases remained `0` (S4 host retention confirmed).
- Ubuntu WSL kernel probe: an exited unreaped process-group leader remained
  visible to `kill(-pgid, 0)` before `waitpid`, confirming RC-002's OS premise.
- The 20-minute full repository suite was not rerun; the signed implementation
  evidence already records it, and the findings above arise on platform-skipped
  or missing branches.

## Required next gate

Route RC-001 through RC-005 to a non-author fixer, then run a fresh non-author
re-review. Tasks 9.4 and 9.5 cannot be marked complete, and this Change must not
local-ship/archive, while any Blocker or Major remains open.
