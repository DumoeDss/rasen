## Why

Reusable session hosts currently exist only in one supervisor process's memory, so an owner restart loses the logical session mapping and allows competing callers to race the same recovery. Rasen needs durable, fail-closed session identity and wake admission before CLI commands or an automatic touch scheduler can safely depend on host reuse.

## What Changes

- Persist each run's reusable-session registry, including stable logical identity, immutable canonical working directory, Claude session identity, lifecycle status, owner/process binding, touch policy, and bounded wake history.
- Reconcile durable records against the current supervisor owner, process, canonical path, and exact transcript facts after process loss or restart; recover eligible lost sessions by resume and refuse stale, unrecoverable, or corrupt state.
- Serialize registry mutations across processes and provide a same-session, cross-process single-flight wake seam with atomic admission and completion records.
- Preserve ambiguous accepted-stdin loss as `delivery_uncertain` and never replay that message automatically.
- Expose one internal registry/recovery coordinator for later CLI and scheduler callers while keeping command routes, scheduling cadence, and touch policy decisions outside this change.
- Keep reusable hosts in the existing management API supervisor and leave change-run and pipeline-registry internals unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `session-host-lifecycle`: Extend reusable-host lifecycle behavior with durable per-run identity, restart reconciliation, fail-closed recovery, and cross-process same-session wake admission.

## Impact

- Primary implementation: `src/core/management-api/session-registry.ts`, with narrow supervisor/router types or lifecycle hooks needed to bind durable records to the existing resident host owner.
- Verification: focused registry/recovery and supervisor integration tests under `test/core/management-api/`, including Windows and POSIX locking/path behavior.
- Persistent state: a versioned `sessions.json` beside the canonical run state, plus short mutation locks and per-session wake leases.
- No public CLI/HTTP command, scheduler loop, new `src/core/session-host/` subsystem, runtime dependency, or edits to `src/core/change-run/**` and `src/core/pipeline-registry/**`.
