## Why

Rasen documents how a LEAD can assemble a raw `codex exec` worker, but its machine-readable `rasen agent dispatch` bridge only launches Claude today. That gap makes any explicitly configured Codex leaf depend on host-specific shell handling, leaves the observed open-stdin hang exposed, and does not give orchestration one validated result and resume contract across Windows, macOS, and Linux.

## What Changes

- Extend `rasen agent dispatch` with a Codex `exec-bridge` route that starts a fresh isolated Codex thread or resumes one exact recorded thread id and returns one structured receipt.
- Deliver the bounded prompt without shell interpolation, close child stdin deterministically, cap execution and captured diagnostics, terminate the process tree on timeout or overflow, and preserve actionable failure categories.
- Resolve model and reasoning effort independently with explicit per-stage, per-role, project, store, and global precedence plus source metadata; validate both before launch. Users can select `gpt-5.6-luna`, `gpt-5.6-terra`, or any other non-empty Codex model id without a built-in allow-list or discovery step; Luna Max remains the concrete runtime probe.
- Validate the selected leaf/evaluate result from Codex's last-message file and capture the thread id from its JSON event stream; success requires both a conforming result and the correct durable thread identity.
- Make Codex-native and Codex process dispatch operationally explicit in the orchestration playbook, including forwarding resolved model/effort, avoiding a full-history native fork when selecting a different model, and batching meaningful work on a warm thread rather than creating one process per microtask.
- Preserve the existing canonical dispatch mode `exec-bridge`; no new run-state route or pipeline schema field is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-exec-runtime`: Add the first-class CLI process bridge, safe cross-platform prompt transport, bounded execution, strict receipts, and explicit model/effort validation.
- `codex-lifecycle`: Make fresh thread ownership and exact-thread resume enforceable through the bridge, including one writer per thread and bounded teardown.
- `config-resolution`: Add a reasoning-effort resolution axis symmetric with model resolution and expose provenance for both values.
- `opsx-orchestration`: Route Codex process workers through the shipped bridge and apply resolved model/effort correctly to native and process dispatches.

## Impact

- **CLI/API surface:** `rasen agent dispatch --runtime codex` becomes supported with the existing prompt, contract, sandbox, model, effort, cwd, timeout, resume, and JSON options.
- **Core runtime:** `src/core/codex/` gains a process runner and receipt handling that reuse the existing invocation, event, contract, rollout, and lifecycle primitives; shared agent-process spawning remains the cross-platform boundary.
- **Configuration:** project/store/global configuration and pipeline resolution gain validated effort defaults and role overrides plus effort provenance, parallel to existing opaque non-empty model resolution; no model catalog or discovery dependency is added.
- **Orchestration:** generated workflow text and its golden-master tests change so model-specific Codex native workers are created without a full-history fork, while process-backed threads use `exec-bridge` and exact-thread resume.
- **Compatibility:** existing Claude dispatch, Codex invocation-builder consumers, archived run-state, and pipelines without effort configuration retain their behavior. PR #133 and Claude resident/session-cache optimization remain out of scope, as does modifying a user's global Codex agent configuration.
