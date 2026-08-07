## Why

ECP-7 cannot safely execute or recover a durable agent Session while its native process authority can be released before the full worker scope is empty, can lose exact POSIX cleanup authority after controller replacement, or can wait forever during activation and abort. The initial opaque `ProcessScope` and native `ProcessCapsule` implementation came from the escalated `ecp-durable-agent-session-host` strategy attempt; this Change owns only the residual S1-S5 repairs and the new evidence required to close that independent fault domain.

## What Changes

- Correct the macOS exact-birth contract to the complete 56-byte `proc_uniqidentifierinfo` ABI, protect its size at compile time, and fail closed whenever a supported kernel identity cannot be proven.
- Distinguish backend-root exit from whole-scope closure so a detached or resistant descendant keeps the opaque process authority live until exact scope-empty observation or successful termination.
- Make replacement cleanup on Linux and macOS validate both controller and supervisor birth identities and terminate the exact reserved process group, never a PID-only or controller-only approximation.
- Bound every post-PREPARED control phase, including ACTIVATE and prepared abort, with typed timeout/uncertainty outcomes that retain authority when closure was not observed.
- Make helper provenance truthful: either prove two source-identical clean builds are byte-identical or explicitly narrow the reproducibility claim while preserving per-artifact manifest-to-adjacent-binary integrity.
- Preserve the already proven opaque ProcessScope seam, Windows suspended Job-at-create/last-handle containment, early-activation discriminator, registry v2 fail-closed migration, adjacent-helper verification, and absence of runtime compile/download/PATH/PowerShell/`ps lstart` fallbacks.
- Add RED-to-GREEN deterministic protocol/ProcessScope discriminators, current-host Windows real-process oracles, macOS ABI/layout assertions, Linux/macOS cross-target builds, and fresh independent security and code/spec review so ECP-7 can close every implementation Major without fabricating unavailable runtime evidence.
- Keep delivery local to the ECP-7 portfolio: local ship and archive, no child push or PR. ECP-8 retains the first clean-branch run of the mandatory real Windows/Linux/macOS acceptance matrix plus version/changelog/tag truth and the unique PR; cross-target compilation is never actual-OS evidence, and Rasen must not claim Linux/macOS runtime support until their real gates pass.

## Capabilities

### New Capabilities

- `durable-process-scope-authority`: Exact, bounded, recoverable native process-scope authority for durable hosted Sessions, including cross-platform identity, containment, scope-empty observation, replacement cleanup, migration, and helper provenance truth.

### Modified Capabilities

None. The smallest host integration needed to retain and release the opaque authority is specified as part of the new capability; this Change does not widen the public Session, daemon, Run, or UI contracts.

## Impact

- Primary code surfaces are `native/process-capsule/`, `src/core/session-host/process-scope.ts`, `src/core/session-host/process-capsule/`, and only the narrow `claude-backend.ts`, `host.ts`, registry/migration, daemon/shutdown, build/package/release wiring needed to preserve exact authority.
- Verification expands ProcessScope, native/package/migration, focused host/Management/daemon/CLI, Rust, TypeScript, package, current-host Windows and deterministic fault-oracle coverage while recording the exact Linux/macOS runtime commands as mandatory ECP-8 release obligations.
- No frozen Action executor, signer custody, canonical Run/Record mutation, reuse/handoff policy, public control or Canvas/UI parity, self-hosting proof, ECP-8 release work, legacy retirement, or 0.3.0 Issue/Dispatch/portfolio/`auto-decompose` product migration is included.

## Architecture replan (2026-08-04)

Review round 1 disproved the proposal's POSIX process-group assumption: `setsid()`/`setpgid()` can move descendants outside the reserved PGID, so the current Linux/macOS implementation cannot provide containment, exact empty, or exact recursive kill. The S1-S5 implementation is preserved as history, but its POSIX authority claim is superseded by [`evidence/architecture-replan.md`](./evidence/architecture-replan.md).

The architecture research recommends kernel-backed per-platform authority: preserve Windows Job Objects; use an unprivileged user+PID namespace on Linux with an installed broker/cgroup-v2 fallback when policy disables it; and compare a signed/entitled macOS 27 Endpoint Security design with a macOS VM boundary. The product owner has **not** selected either macOS candidate. Endpoint Security, VM, silent unsupported, a minimum macOS version, signing/entitlement work and a macOS support claim all remain unauthorized.

The owner instead explicitly deferred the macOS solution and authorized useful independent work to continue. The safe prerequisite graph is now a common-only `ecp-platform-process-authority-foundation`, followed by separate Linux and Windows provider Changes that may run in parallel, plus a non-runnable decision-gated `ecp-macos-process-authority-provider`. The common foundation owns only `ProcessAuthorityProvider`, the opaque-reference envelope and provider dispatch; each platform Change owns its adapter and real platform oracles. This Change depends on all three platform providers and resumes only after they are terminal, as the ProcessScope/host integration and residual-finding closure. The macOS defer therefore blocks this Change's final closure and ECP-8's three-OS release, but it does not block common, Linux or Windows implementation.
