## Why

The durable reusable-session host is now correct and recoverable, but users and automation have no supported command surface for starting or waking it, inspecting it, or retiring it. A public CLI is needed before the cache can be used safely outside internal tests, including when no daemon is running.

## What Changes

- Add public `rasen session exec`, `rasen session list`, and `rasen session retire` commands for an exact canonical run and session key.
- Route commands through the same durable coordinator in resident-daemon or explicit foreground-owner mode, with stable caller-supplied message IDs and fail-closed retry semantics.
- Return typed human and JSON outcomes with documented exit-code classes for success, invalid selection, contention, unavailable sessions, delivery uncertainty, and infrastructure failure.
- Add complete English, Japanese, and Simplified Chinese help and presentation content, plus completion metadata using structural completion values.
- Cover help, human/JSON output, daemon and foreground ownership, uncertainty, and macOS/Linux/Windows path behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-host-lifecycle`: Expose durable session execution, listing, and retirement through a stable public CLI while preserving the coordinator's ownership, single-flight, recovery, and uncertainty guarantees.

## Impact

This change affects CLI registration and presentation, completion metadata, the management API's authenticated reusable-session route group, daemon-client selection, and focused CLI/API tests. It depends on the archived host-lifecycle and registry-recovery changes. It does not change pipeline/change-run integration, scheduler behavior, or package dependencies.
