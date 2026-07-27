## Why

The Codex context probe currently treats the rollout's lifetime-cumulative token spend as live context occupancy. After compaction this can produce impossible values above 100% and trigger handoff decisions even though the current prompt occupies only a small part of the model window.

## What Changes

- Read Codex occupancy from the last valid `last_token_usage.total_tokens` snapshot, which is the runtime's current-context value, while continuing to use the inline `model_context_window`.
- Treat rollouts that contain token-count events but no usable current-context snapshot as unsupported for occupancy, rather than substituting cumulative lifetime usage.
- Preserve the distinct zero-turn result for rollouts with no token-count events, explicit limit overrides, malformed-JSON-line tolerance, model detection, and all Claude transcript behavior.
- Add regression coverage with multiple token-count events spanning compaction, plus focused command and CLI coverage for the corrected value and compatibility behavior.
- Correct the Codex parity documentation and the main context-probe specification so they describe current-context usage rather than cumulative spend.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent-context`: Define Codex occupancy as the latest valid current-context usage snapshot and make legacy/drifted token-count streams without that snapshot fail honestly instead of reporting cumulative spend.

## Impact

- Affected implementation: `src/core/codex/rollout.ts` and the Codex branch of `src/core/agent-context.ts`.
- Affected verification: Codex rollout parsing, agent-context core, agent command, and CLI end-to-end tests and fixtures.
- Affected documentation: the English and Chinese Codex parity occupancy guidance and supporting rollout-anatomy evidence.
- No command-line flags, successful output fields, dependencies, or Claude transcript semantics change.
