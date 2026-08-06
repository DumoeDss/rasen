## Why

Reusable Claude sessions lose their cache benefit when they sit idle past the experimentally observed host cache window. The resident daemon needs a bounded policy-driven scheduler that refreshes eligible sessions without weakening the durable coordinator's concurrency, retry, or shutdown guarantees.

## What Changes

- Add a daemon-owned scheduler that periodically evaluates durable `touchPolicy` state and wakes only eligible reusable sessions near the approximately 50-minute refresh cadence.
- Derive every decision from named timing constants plus persisted deadline, maximum-touch, touches-used, and deadline-action fields.
- Send each refresh through the resident durable coordinator with a stable touch message ID, sharing per-session single-flight with interactive wakes.
- Define bounded behavior for deadlines, exhaustion, uncertain delivery, ordinary failures, backoff, clean shutdown, daemon restart, and clock movement.
- Add deterministic fake-clock and daemon-lifecycle tests without adding CLI commands or locale content.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-host-lifecycle`: Add policy-bounded daemon refreshes for reusable sessions while preserving the existing durable coordinator, single-flight, recovery, and uncertainty contracts.

## Impact

This change affects a focused management-API scheduler module, daemon startup/shutdown integration, and scheduler tests. It consumes the authenticated reusable-session protocol owned by the sibling CLI-surface change but does not own that protocol's implementation files. It does not change CLI registration, completion metadata, locale catalogs, pipeline/change-run code, or package dependencies.
