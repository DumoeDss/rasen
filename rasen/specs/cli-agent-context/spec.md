# cli-agent-context Specification

## Purpose
Defines the `rasen agent context` command that reports an agent transcript's context-window occupancy from its recorded API usage, with no estimation, across both Claude Code transcripts and Codex rollout files. This gives any agent — the LEAD or a role-isolated worker, on either runtime — a deterministic number for deciding when a long run is approaching compaction, together with the context-limit resolution that turns that number into an occupancy fraction.

## Requirements
### Requirement: Context probe command
The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation. The probe SHALL support both Claude Code transcripts and Codex rollout files through the same command and output shape (`available`, `model`, `contextTokens`, `limit`, `pct`, `transcript`), detecting the transcript kind from the file (Codex's own `rollout-*.jsonl` naming convention first, a first-line content check for renamed copies) with an explicit `--runtime <claude|codex>` override that wins over detection.

The probe SHALL support latest-session discovery on both runtimes. By default, `--latest` resolves the newest main-session Claude transcript for the current working directory's project. With `--runtime codex`, `--latest` instead discovers the newest Codex rollout belonging to the current working directory's own session: it searches the Codex sessions store (respecting the `CODEX_HOME` environment override, defaulting to the user's `.codex` home), considers only sessions whose recorded working directory matches the probe's working directory, and excludes forked-child (subagent) sessions — so the number answers "how full is MY context", never a sibling's. Discovery SHALL never fall back across runtimes implicitly: on a machine holding both runtimes' sessions, reporting unavailable is preferred over silently probing the wrong host's session. The `--dir` override SHALL retarget whichever base directory the active runtime's discovery searches: the Claude projects directory by default, the Codex sessions root under `--runtime codex`.

The probe SHALL distinguish two failure classes. **Environmental absence** — reachable only via `--latest`: the derived (or `--dir`-overridden) transcript directory does not exist, or exists but holds no main-session transcript, or (under `--runtime codex`) the sessions store holds no non-forked rollout matching the probe's working directory — SHALL degrade gracefully: exit 0 with a machine-readable unavailable result, because a host without the probed runtime's sessions is a legitimate runtime for the non-blocking probe, not an error. The unavailable detail for a Claude-side miss SHALL point out the Codex discovery path (`--runtime codex` with `--latest`), so a Codex host that probes with defaults learns the working incantation. **Input errors** — an invalid `--runtime` or `--limit` value, neither `--transcript` nor `--latest` provided, or an explicitly named `--transcript` file that is missing, unreadable, or usage-free — SHALL remain hard errors with a non-zero exit and an actionable message.

#### Scenario: Probe an explicit transcript
- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Claude Code transcript jsonl
- **THEN** the CLI SHALL locate the last assistant entry carrying `message.usage`
- **AND** SHALL report `contextTokens` as the sum of `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- **AND** SHALL report `available` as `true`, the model id, the resolved context-window `limit`, and `pct` (contextTokens / limit)

#### Scenario: Probe the current main session
- **WHEN** a user runs `rasen agent context --latest`
- **THEN** the CLI SHALL resolve the newest main-session transcript (excluding `agent-*.jsonl` subagent files) in the Claude projects directory derived from the current working directory
- **AND** SHALL report the same fields as an explicit probe

#### Scenario: Probe the current main session on a Codex host
- **WHEN** a user runs `rasen agent context --latest --runtime codex`
- **THEN** the CLI SHALL resolve the most recently modified Codex rollout in the sessions store whose recorded session working directory matches the current working directory, excluding forked-child (subagent) rollouts
- **AND** SHALL report the same fields as an explicit rollout probe, with `transcript` naming the discovered rollout path

#### Scenario: Codex discovery is scoped to the probing session's project
- **WHEN** the Codex sessions store holds a more recently modified rollout recorded under a different working directory, or a forked-child rollout of the current session
- **AND** the user runs `rasen agent context --latest --runtime codex`
- **THEN** the CLI SHALL skip those rollouts and select the newest rollout whose recorded working directory matches the probe's, comparing resolved absolute paths so the match is cross-platform

#### Scenario: Directory override on a Codex host
- **WHEN** a user runs `rasen agent context --latest --runtime codex --dir <path>`
- **THEN** the CLI SHALL search `<path>` as the Codex sessions root instead of the default store, applying the same working-directory scoping

#### Scenario: Graceful degradation when no transcript environment exists
- **WHEN** a user runs `rasen agent context --latest --json` and the derived (or `--dir`-overridden) transcript directory does not exist, or exists but contains no main-session transcript
- **THEN** the CLI SHALL exit 0
- **AND** SHALL print a single JSON object `{"available": false, "reason": "no-transcript", "detail": <human-readable explanation naming the probed location>}`
- **AND** the `detail` SHALL mention that a Codex host can pass `--runtime codex` with `--latest`
- **AND** SHALL NOT fabricate occupancy fields (`model`, `contextTokens`, `limit`, `pct` are absent from the unavailable shape)

#### Scenario: Graceful degradation when no matching Codex session exists
- **WHEN** a user runs `rasen agent context --latest --runtime codex --json` and the sessions store does not exist, is empty, or holds no non-forked rollout whose recorded working directory matches the probe's
- **THEN** the CLI SHALL exit 0
- **AND** SHALL print the same unavailable shape (`{"available": false, "reason": "no-transcript", "detail": ...}`) with the detail naming the sessions root searched and the working directory used for matching

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

### Requirement: Context-limit resolution
The probe SHALL resolve the context-window limit per transcript kind: for Claude transcripts, from the transcript's model id via a built-in model map with a conservative default; for Codex rollouts, from the exact `model_context_window` the rollout's token-count event carries inline (no model map). An explicit `--limit <n>` override SHALL win on both kinds, with `pct` recomputed against it.

#### Scenario: Known model
- **WHEN** the transcript's latest usage entry names a model with a known context window
- **THEN** the CLI SHALL use that window as `limit`

#### Scenario: Unknown model with override
- **WHEN** the model is not in the built-in map and `--limit <n>` is provided
- **THEN** the CLI SHALL use `<n>` as the limit
- **AND** without an override it SHALL fall back to the conservative default of 200000

#### Scenario: Codex inline window
- **WHEN** a Codex rollout's last token-count event carries a model context window
- **THEN** the CLI SHALL use that exact value as `limit` without consulting the built-in model map
- **AND** an explicit `--limit <n>` SHALL still override it, with `pct` recomputed as contextTokens / n

