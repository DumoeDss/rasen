## Why

Rasen can currently launch observable headless sessions and can dispatch one bounded Claude turn, but neither path owns a durable, reusable agent process across daemon or driver replacement. ECP-7 needs that host-lifecycle foundation before a later Change can safely bind a frozen Action or trusted completion authority to it.

## What Changes

- Introduce one backend-neutral Session host module that creates, wakes, inspects, cancels, restarts/reattaches, and retires exact Sessions behind a small lifecycle interface with strict single-flight and canonical-cwd invariants.
- Add a real Claude backend adapter that uses a long-lived bidirectional `stream-json` process for normal create/wake turns and exact-session print/resume only as the bounded recovery path.
- Replace process-local-only host lifecycle memory with an atomic, recoverable machine-local registry that records Session identity, canonical cwd, backend/process generation, lifecycle state, request/result references, and recovery diagnostics without becoming Run or completion truth.
- Extend daemon ownership so a clean daemon can retain live stream transports, reconcile durable records on restart, reattach when safe, and otherwise recover through exact resume without duplicating an in-flight request.
- Preserve the existing Management Session launch/list/detail/kill behavior and wire shapes while exposing the additional durable lifecycle facts and narrow CLI controls needed to execute, inspect, and retire hosted Sessions.
- Add deterministic protocol-replay and real-process fixtures covering create/wake, fragmented NDJSON, crash/restart, stale ownership, cancel/process-tree cleanup, cwd mismatch, retirement, and Windows/Linux/macOS-safe spawning.
- Keep this Change strictly at the host-lifecycle seam: it does not claim or mutate a canonical Run, execute a frozen Action, hold a signing private key, define reuse/touch policy, add UI, perform ECP self-hosting, or include ECP-8/0.3.0 delivery work.

## Capabilities

### New Capabilities

- `durable-agent-session-host`: Backend-neutral durable Session hosting, a real stream-json backend, exact lifecycle operations, recovery, single-flight, protocol evidence, and cross-platform safety.

### Modified Capabilities

- `session-supervision`: Preserve the existing Management Session contract while making host lifecycle records durable and extending compatible lifecycle inspection/control beyond one-shot process state.
- `daemon-residency`: Make the resident daemon the owner of live Session transports and require deterministic recovery/reconciliation from durable host records after daemon replacement or restart.

## Impact

- Primary code surfaces: `src/core/management-api/supervisor.ts`, `session-registry.ts`, `sessions.ts`, `router.ts`, `server.ts`, `wire-types.ts`, `src/commands/daemon.ts`, the agent CLI process/Claude dispatch seams, file-placement and atomic-lock helpers, plus a narrow Session CLI command surface.
- Existing `POST/GET/DELETE /api/v1/sessions` clients remain compatible; additional lifecycle fields and controls are additive.
- The Claude CLI becomes the first production backend adapter, while deterministic replay adapters/fixtures exercise the same host interface without network or account dependence.
- New durable files are machine-local host facts with owner-restricted permissions and atomic replacement; they contain no executable Action payload, private key, canonical Run mutation, or trusted completion claim.
- Verification expands focused unit/protocol/process fault tests, deterministic Windows/POSIX branch fixtures, current-host local build/lint/typecheck/root tests, strict Change validation, security review, and independent review gates. ECP-8 retains the actual Windows/Linux/macOS remote CI matrix as the final portfolio delivery gate.
