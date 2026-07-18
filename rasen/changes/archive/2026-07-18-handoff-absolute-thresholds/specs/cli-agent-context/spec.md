# cli-agent-context Delta Specification

## MODIFIED Requirements

### Requirement: Context probe command
The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation. The probe SHALL support both Claude Code transcripts and Codex rollout files through the same command and output shape (`model`, `contextTokens`, `limit`, `remainingTokens`, `pct`, `transcript`), detecting the transcript kind from the file (Codex's own `rollout-*.jsonl` naming convention first, a first-line content check for renamed copies) with an explicit `--runtime <claude|codex>` override that wins over detection. `remainingTokens` SHALL be `max(0, limit - contextTokens)` — 0 when no limit is known — so absolute (`{ remainingTokens }`) thresholds can be compared directly against a probe.

#### Scenario: Probe an explicit transcript
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Claude Code transcript jsonl
- **THEN** the CLI SHALL locate the last assistant entry carrying `message.usage`
- **AND** SHALL report `contextTokens` as the sum of `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- **AND** SHALL report the model id, the resolved context-window `limit`, `remainingTokens` (limit minus contextTokens, floored at 0), and `pct` (contextTokens / limit)

#### Scenario: Probe the current main session
- **WHEN** a user runs `rasen agent context --latest`
- **THEN** the CLI SHALL resolve the newest main-session transcript (excluding `agent-*.jsonl` subagent files) in the Claude projects directory derived from the current working directory
- **AND** SHALL report the same fields as an explicit probe

#### Scenario: Unreadable or usage-free transcript
- **WHEN** the transcript is missing, unreadable, or contains no assistant entry with usage
- **THEN** the CLI SHALL exit non-zero with an actionable error
- **AND** SHALL NOT fabricate an estimate

#### Scenario: Probe a Codex rollout
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Codex rollout jsonl (a file following the `rollout-*.jsonl` naming convention, or forced via `--runtime codex`)
- **THEN** the CLI SHALL report `contextTokens` from the rollout's LAST token-count event's total token usage
- **AND** SHALL report `limit`, `remainingTokens`, `pct`, the model id (best-effort from the rollout's `turn_context` records — the last one wins; `session_meta` never carries a model field — `unknown` when absent), and `transcript` in the same output shape as a Claude probe, so threshold consumers work unchanged

#### Scenario: Codex rollout with zero completed turns
- **WHEN** a probed Codex rollout contains no token-count event yet (a worker that has not completed a turn)
- **THEN** the CLI SHALL succeed, reporting `contextTokens` 0 and `pct` 0 — zero occupancy is a normal young-worker state, not an error (deliberately asymmetric with the usage-free Claude transcript case, which stays an error because such a transcript is malformed rather than young)
- **AND** `remainingTokens` SHALL be 0 when no window is known (honest zero, not a fabricated headroom)

#### Scenario: Explicit runtime override
- **WHEN** a user passes `--runtime claude` or `--runtime codex`
- **THEN** the CLI SHALL read the transcript with the named runtime's reader regardless of filename or content detection
- **AND** SHALL reject any other `--runtime` value with an actionable error

### Requirement: Context-limit resolution
The probe SHALL resolve the context-window limit per transcript kind: for Claude transcripts, from the transcript's model id via the built-in model-preset registry (the single source of context-window sizes) with a conservative default; for Codex rollouts, from the exact `model_context_window` the rollout's token-count event carries inline (no registry lookup). An explicit `--limit <n>` override SHALL win on both kinds, with `pct` and `remainingTokens` recomputed against it.

#### Scenario: Known model
- **WHEN** the transcript's latest usage entry names a model with a known context window in the model-preset registry
- **THEN** the CLI SHALL use that window as `limit`

#### Scenario: Unknown model with override
- **WHEN** the model is not in the registry and `--limit <n>` is provided
- **THEN** the CLI SHALL use `<n>` as the limit
- **AND** without an override it SHALL fall back to the conservative default of 200000

#### Scenario: Codex inline window
- **WHEN** a Codex rollout's last token-count event carries a model context window
- **THEN** the CLI SHALL use that exact value as `limit` without consulting the model-preset registry
- **AND** an explicit `--limit <n>` SHALL still override it, with `pct` and `remainingTokens` recomputed against `<n>`
