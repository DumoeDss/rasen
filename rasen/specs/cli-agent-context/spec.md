# cli-agent-context Specification

## Purpose
Defines the `rasen agent context` command that reports an agent transcript's context-window occupancy from its recorded API usage, with no estimation. This gives any agent — the LEAD or a role-isolated worker — a deterministic number for deciding when a long run is approaching compaction, together with the context-limit resolution that turns that number into an occupancy fraction.

## Requirements
### Requirement: Context probe command
The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation.

#### Scenario: Probe an explicit transcript
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Claude Code transcript jsonl
- **THEN** the CLI SHALL locate the last assistant entry carrying `message.usage`
- **AND** SHALL report `contextTokens` as the sum of `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- **AND** SHALL report the model id, the resolved context-window `limit`, and `pct` (contextTokens / limit)

#### Scenario: Probe the current main session
- **WHEN** a user runs `rasen agent context --latest`
- **THEN** the CLI SHALL resolve the newest main-session transcript (excluding `agent-*.jsonl` subagent files) in the Claude projects directory derived from the current working directory
- **AND** SHALL report the same fields as an explicit probe

#### Scenario: Unreadable or usage-free transcript
- **WHEN** the transcript is missing, unreadable, or contains no assistant entry with usage
- **THEN** the CLI SHALL exit non-zero with an actionable error
- **AND** SHALL NOT fabricate an estimate

### Requirement: Context-limit resolution
The probe SHALL resolve the context-window limit from the transcript's model id via a built-in model map, with a conservative default and an explicit override.

#### Scenario: Known model
- **WHEN** the transcript's latest usage entry names a model with a known context window
- **THEN** the CLI SHALL use that window as `limit`

#### Scenario: Unknown model with override
- **WHEN** the model is not in the built-in map and `--limit <n>` is provided
- **THEN** the CLI SHALL use `<n>` as the limit
- **AND** without an override it SHALL fall back to the conservative default of 200000

