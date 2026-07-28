## MODIFIED Requirements

### Requirement: Context probe command

The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation. The probe SHALL support both Claude Code transcripts and Codex rollout files through the same command and successful output shape (`available`, `runtime`, `model`, `contextTokens`, `limit`, `remainingTokens`, `pct`, `transcript`), detecting the transcript kind from the file (Codex's own `rollout-*.jsonl` naming convention first, a first-line content check for renamed copies) with an explicit `--runtime <claude|codex>` override that wins over detection. `runtime` SHALL identify the reader selected by override or detection. `remainingTokens` SHALL be `max(0, limit - contextTokens)`—0 when no limit is known—so absolute (`{ remainingTokens }`) thresholds can be compared directly against a probe.

For Codex rollouts, `contextTokens` SHALL represent the current context recorded by the last valid token-count snapshot, not the rollout's lifetime-cumulative token spend. A token-count stream that contains no valid current-context snapshot SHALL fail actionably rather than substitute cumulative usage or zero. A rollout with no token-count event at all remains the distinct successful zero-turn state.

The probe SHALL support latest-session discovery on both runtimes. By default, `--latest` resolves the newest main-session Claude transcript for the current working directory's project. With `--runtime codex`, `--latest` instead discovers the newest Codex rollout belonging to the current working directory's own session: it searches the Codex sessions store (respecting the `CODEX_HOME` environment override, defaulting to the user's `.codex` home), considers only sessions whose recorded working directory matches the probe's working directory, and excludes forked-child (subagent) sessions—so the number answers "how full is MY context", never a sibling's. Discovery SHALL never fall back across runtimes implicitly: on a machine holding both runtimes' sessions, reporting unavailable is preferred over silently probing the wrong host's session. The `--dir` override SHALL retarget whichever base directory the active runtime's discovery searches: the Claude projects directory by default, the Codex sessions root under `--runtime codex`.

The probe SHALL distinguish two failure classes. **Environmental absence**—reachable only via `--latest`: the derived (or `--dir`-overridden) transcript directory does not exist, or exists but holds no main-session transcript, or (under `--runtime codex`) the sessions store holds no non-forked rollout matching the probe's working directory—SHALL degrade gracefully: exit 0 with a machine-readable unavailable result, because a host without the probed runtime's sessions is a legitimate runtime for the non-blocking probe, not an error. The unavailable detail for a Claude-side miss SHALL point out the Codex discovery path (`--runtime codex` with `--latest`), so a Codex host that probes with defaults learns the working incantation. **Input or data errors**—an invalid `--runtime` or `--limit` value, neither `--transcript` nor `--latest` provided, an explicitly named `--transcript` file that is missing, unreadable, or usage-free, or a Codex token-count stream that has no valid current-context usage snapshot—SHALL remain hard errors with a non-zero exit and an actionable message.

#### Scenario: Probe an explicit transcript

- **WHEN** a user runs `rasen agent context --transcript <path> --json` against a Claude Code transcript jsonl
- **THEN** the CLI SHALL locate the last assistant entry carrying `message.usage`
- **AND** SHALL report `contextTokens` as the sum of `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
- **AND** SHALL report `available` as `true`, `runtime` as `claude`, the model id, the resolved context-window `limit`, `remainingTokens` (limit minus contextTokens, floored at 0), and `pct` (contextTokens / limit)

#### Scenario: Probe the current main session

- **WHEN** a user runs `rasen agent context --latest`
- **THEN** the CLI SHALL resolve the newest main-session transcript (excluding `agent-*.jsonl` subagent files) in the Claude projects directory derived from the current working directory
- **AND** SHALL report the same fields as an explicit probe

#### Scenario: Probe the current main session on a Codex host

- **WHEN** a user runs `rasen agent context --latest --runtime codex`
- **THEN** the CLI SHALL resolve the most recently modified Codex rollout in the sessions store whose recorded session working directory matches the current working directory, excluding forked-child (subagent) rollouts
- **AND** SHALL report the same fields as an explicit rollout probe, with `runtime` as `codex` and `transcript` naming the discovered rollout path

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
- **AND** SHALL NOT fabricate probe fields (`runtime`, `model`, `contextTokens`, `limit`, `pct` are absent from the unavailable shape)

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
- **THEN** the CLI SHALL report `contextTokens` from the rollout's last valid token-count event's current-context usage
- **AND** SHALL report `runtime` as `codex`, `limit`, `pct`, the model id (best-effort from the rollout's `turn_context` records—the last one wins; `session_meta` never carries a model field—`unknown` when absent), and `transcript` in the same output shape as a Claude probe, so threshold consumers work unchanged

#### Scenario: Codex occupancy after compaction

- **WHEN** a Codex rollout contains multiple token-count events, a context-compaction boundary, and a later event whose lifetime-cumulative usage increased while its current-context usage decreased
- **THEN** the CLI SHALL calculate `contextTokens`, `remainingTokens`, and `pct` from the later event's current-context usage and inline context window
- **AND** SHALL NOT report the lifetime-cumulative usage as occupancy

#### Scenario: Last valid Codex snapshot wins

- **WHEN** a Codex rollout contains malformed JSONL lines or structurally unusable token-count records around otherwise valid current-context snapshots
- **THEN** the CLI SHALL report the most recent valid current-context snapshot
- **AND** SHALL preserve the inline model context window paired with that snapshot

#### Scenario: Codex token-count stream lacks current-context usage

- **WHEN** a Codex rollout contains one or more token-count events but none has a numeric current-context usage snapshot
- **THEN** the CLI SHALL exit non-zero with an actionable message explaining that current occupancy is unavailable from that rollout format
- **AND** SHALL NOT substitute lifetime-cumulative usage or report zero occupancy

#### Scenario: Codex rollout with zero completed turns

- **WHEN** a probed Codex rollout contains no token-count event yet (a worker that has not completed a turn)
- **THEN** the CLI SHALL succeed, reporting `contextTokens` 0 and `pct` 0—zero occupancy is a normal young-worker state, not an error (deliberately asymmetric with the usage-free Claude transcript case, which stays an error because such a transcript is malformed rather than young)
- **AND** `remainingTokens` SHALL be 0 when no window is known (honest zero, not a fabricated headroom)

#### Scenario: Explicit runtime override

- **WHEN** a user passes `--runtime claude` or `--runtime codex`
- **THEN** the CLI SHALL read the transcript with the named runtime's reader regardless of filename or content detection and report that runtime
- **AND** SHALL reject any other `--runtime` value with an actionable error
