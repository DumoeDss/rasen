## Why

Rasen's current supervisor starts one-shot Claude processes, so it cannot retain the live `stream-json` process that probe evidence identified as the reusable cache asset. A reusable worker also needs an explicit lifecycle contract because overlapping wake attempts can both be charged while silently losing a turn, and host loss must remain recoverable without making daemon uptime a correctness dependency.

## What Changes

- Add an internal reusable-host mode to the existing management API supervisor that creates a live Claude `stream-json` process in a fixed working directory and keeps its stdin/stdout pipes available across turns.
- Add repeated wake delivery with one completion result per accepted message and immediate, structured single-flight rejection for an overlapping wake to the same host.
- Add clean, idempotent retirement that closes the host, reaps its process tree when needed, and makes retirement terminal for later wake attempts.
- Add same-cwd recovery after unexpected host loss by resuming the captured Claude session into a replacement live `stream-json` process, accepting the recovery cost without losing correctness.
- Preserve the existing one-shot management-session launch, observation, timeout, kill, shutdown, Windows shim-safety, and concurrency behavior.
- Keep durable registry persistence, public `rasen session` commands, daemon touch scheduling, pipeline integration, and cache-economics/audit work outside this change.

## Capabilities

### New Capabilities

- `session-host-lifecycle`: Internal create, repeated wake, per-host single-flight, clean retire, and resume-based recovery behavior for reusable live Claude hosts.

### Modified Capabilities

- None. The existing `session-supervision` HTTP and one-shot process contract remains compatible.

## Impact

- Primary implementation: `src/core/management-api/supervisor.ts` and narrowly related management API host types.
- Verification: focused supervisor/host lifecycle tests and cross-platform fake-Claude fixtures under `test/core/management-api/` and `test/fixtures/management-api/`.
- No new runtime dependency and no public CLI or HTTP surface in this child.
- No edits to `src/core/change-run/**`, `src/core/pipeline-registry/**`, or full session-registry persistence.
