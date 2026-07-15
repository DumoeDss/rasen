# cli-agent-context Delta

## MODIFIED Requirements

### Requirement: Context probe command
The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation. The probe SHALL support both Claude Code transcripts and Codex rollout files through the same command and output shape (`available`, `model`, `contextTokens`, `limit`, `pct`, `transcript`), detecting the transcript kind from the file (Codex's own `rollout-*.jsonl` naming convention first, a first-line content check for renamed copies) with an explicit `--runtime <claude|codex>` override that wins over detection.

The probe SHALL distinguish two failure classes. **Environmental absence** — reachable only via `--latest`: the derived (or `--dir`-overridden) transcript directory does not exist, or exists but holds no main-session transcript — SHALL degrade gracefully: exit 0 with a machine-readable unavailable result, because a host without Claude transcripts (e.g. a Codex CLI session as the LEAD) is a legitimate runtime for the non-blocking probe, not an error. **Input errors** — an invalid `--runtime` or `--limit` value, neither `--transcript` nor `--latest` provided, or an explicitly named `--transcript` file that is missing, unreadable, or usage-free — SHALL remain hard errors with a non-zero exit and an actionable message.

#### Scenario: Probe an explicit transcript
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Claude Code transcript jsonl
- **THEN** the CLI SHALL locate the last assistant entry carrying `message.usage`
- **AND** SHALL report `contextTokens` as the sum of `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- **AND** SHALL report `available` as `true`, the model id, the resolved context-window `limit`, and `pct` (contextTokens / limit)

#### Scenario: Probe the current main session
- **WHEN** a user runs `rasen agent context --latest`
- **THEN** the CLI SHALL resolve the newest main-session transcript (excluding `agent-*.jsonl` subagent files) in the Claude projects directory derived from the current working directory
- **AND** SHALL report the same fields as an explicit probe

#### Scenario: Graceful degradation when no transcript environment exists
- **WHEN** a user runs `rasen agent context --latest --json` and the derived (or `--dir`-overridden) transcript directory does not exist, or exists but contains no main-session transcript
- **THEN** the CLI SHALL exit 0
- **AND** SHALL print a single JSON object `{"available": false, "reason": "no-transcript", "detail": <human-readable explanation naming the probed location>}`
- **AND** SHALL NOT fabricate occupancy fields (`model`, `contextTokens`, `limit`, `pct` are absent from the unavailable shape)

#### Scenario: Graceful degradation in text mode
- **WHEN** the same environmental absence occurs without `--json`
- **THEN** the CLI SHALL exit 0 and print a single line stating the context is unavailable and why

#### Scenario: Unreadable or usage-free explicit transcript
- **WHEN** a transcript named via `--transcript` is missing, unreadable, or contains no assistant entry with usage
- **THEN** the CLI SHALL exit non-zero with an actionable error
- **AND** SHALL NOT fabricate an estimate

#### Scenario: Probe a Codex rollout
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Codex rollout jsonl (a file following the `rollout-*.jsonl` naming convention, or forced via `--runtime codex`)
- **THEN** the CLI SHALL report `contextTokens` from the rollout's LAST token-count event's total token usage
- **AND** SHALL report `limit`, `pct`, the model id (best-effort from the rollout's `turn_context` records — the last one wins; `session_meta` never carries a model field — `unknown` when absent), and `transcript` in the same output shape as a Claude probe, so threshold consumers work unchanged

#### Scenario: Codex rollout with zero completed turns
- **WHEN** a probed Codex rollout contains no token-count event yet (a worker that has not completed a turn)
- **THEN** the CLI SHALL succeed, reporting `contextTokens` 0 and `pct` 0 — zero occupancy is a normal young-worker state, not an error (deliberately asymmetric with the usage-free Claude transcript case, which stays an error because such a transcript is malformed rather than young)

#### Scenario: Explicit runtime override
- **WHEN** a user passes `--runtime claude` or `--runtime codex`
- **THEN** the CLI SHALL read the transcript with the named runtime's reader regardless of filename or content detection
- **AND** SHALL reject any other `--runtime` value with an actionable error
