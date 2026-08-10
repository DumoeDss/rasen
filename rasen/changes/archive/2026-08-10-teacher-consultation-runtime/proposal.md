## Why

Implementers can currently receive lifecycle strategy help only after a bounded loop stalls or blocks, and the advice is not delivered back into the exact in-progress worker session. A first-class consultation runtime is needed now so an implementer can ask a stronger Teacher directly, without paying for a LEAD relay or losing the context that made the question useful.

## What Changes

- Add an opt-in ECP consultation lifecycle in which an active agent Action can emit a typed question without completing, ECP directly admits a frozen Teacher Action, and the resulting structured advice is delivered to the originating implementer session.
- Make consultation questions, attempts, advice, delivery, attribution, and terminal failures durable and replay-safe in the canonical Run while keeping full question/advice bodies out of the Session host registry.
- Freeze per-binding consultation limits and enforce them independently from bounded-loop lifecycle strategy limits and global Run budgets.
- Require Teacher Actions to be mechanically advisory: read-only sandbox and workspace authority, no declared effects, strict advice outcomes (`plan`, `correction`, or `stop`), and no ability to certify implementation progress.
- Extend frozen Action execution with a typed non-terminal step result, stable hosted Session continuation, deterministic request identities, and fail-closed handling when exact continuation is unavailable or a turn outcome is ambiguous.
- Resolve the delayed-writer blocker by running Teacher attempts through a production-supported exact recursive process-authority lane, quarantining result bytes until an authenticated exact-scope-empty receipt and a stable final workspace observation permit canonical settlement; hosts without that provider fail before Teacher activation while ordinary hosted Sessions remain best-effort.
- Preserve existing behavior for pipelines without a consultation binding and preserve BoundedLoop strategy/recovery behavior for pipelines that use it.

## Capabilities

### New Capabilities

- `ecp-consultation-runtime`: Defines implementer-initiated consultation, direct Teacher admission, canonical lifecycle state, exact-retirement-gated workspace safety, bounded/replay-safe advice delivery, read-only enforcement, restart behavior, and compatibility with existing ECP loops.

### Modified Capabilities

- `frozen-action-session-executor`: Extends the executor contract from terminal-only Action turns to typed non-terminal consultation steps that retain and later wake the exact hosted Session under the original invocation authority, with continuation support declared before source execution and a server-derived exact process-provider/retirement gate for Teacher attempts.

## Impact

- Core ECP contracts, canonical Record/reducer/projector, reconciler/facade settlement, workspace reservation coordination, and runtime execution-profile validation.
- Frozen Action executor outcomes, hosted Session binding/reuse, capability-matrix facts, deterministic request identities, and daemon execution wiring.
- Provider-backed exact process-authority registry/coordinator assembly for Windows and Linux, durable Teacher-attempt authority journaling and SessionHost receipt plumbing, explicit macOS unavailability, and final manifest stability fencing.
- Runtime-neutral worker result schemas and focused unit, replay, restart, mutation-guard, and cross-plane parity tests.
- Downstream Teacher workflow/registry and Canvas changes consume the frozen consultation binding and view contracts but are not implemented by this change.
