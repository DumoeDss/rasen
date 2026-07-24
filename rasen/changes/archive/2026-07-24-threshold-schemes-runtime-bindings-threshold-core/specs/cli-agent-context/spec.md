## MODIFIED Requirements

### Requirement: Context probe command

The CLI SHALL provide `rasen agent context` that reports the context-window occupancy of an agent transcript from its recorded API usage, without estimation. The probe SHALL support both Claude Code transcripts and Codex rollout files through the same command and successful output shape (`available`, `runtime`, `model`, `contextTokens`, `limit`, `remainingTokens`, `pct`, `transcript`), detecting the transcript kind from the file (Codex's own `rollout-*.jsonl` naming convention first, a first-line content check for renamed copies) with an explicit `--runtime <claude|codex>` override that wins over detection. `runtime` SHALL identify the reader selected by override or detection. `remainingTokens` SHALL be `max(0, limit - contextTokens)`—0 when no limit is known—so absolute (`{ remainingTokens }`) thresholds can be compared directly against a probe.

The probe SHALL support latest-session discovery on both runtimes. By default, `--latest` resolves the newest main-session Claude transcript for the current working directory's project. With `--runtime codex`, `--latest` instead discovers the newest Codex rollout belonging to the current working directory's own session: it searches the Codex sessions store (respecting the `CODEX_HOME` environment override, defaulting to the user's `.codex` home), considers only sessions whose recorded working directory matches the probe's working directory, and excludes forked-child (subagent) sessions—so the number answers "how full is MY context", never a sibling's. Discovery SHALL never fall back across runtimes implicitly: on a machine holding both runtimes' sessions, reporting unavailable is preferred over silently probing the wrong host's session. The `--dir` override SHALL retarget whichever base directory the active runtime's discovery searches: the Claude projects directory by default, the Codex sessions root under `--runtime codex`.

The probe SHALL distinguish two failure classes. **Environmental absence**—reachable only via `--latest`: the derived (or `--dir`-overridden) transcript directory does not exist, or exists but holds no main-session transcript, or (under `--runtime codex`) the sessions store holds no non-forked rollout matching the probe's working directory—SHALL degrade gracefully: exit 0 with a machine-readable unavailable result, because a host without the probed runtime's sessions is a legitimate runtime for the non-blocking probe, not an error. The unavailable detail for a Claude-side miss SHALL point out the Codex discovery path (`--runtime codex` with `--latest`), so a Codex host that probes with defaults learns the working incantation. **Input errors**—an invalid `--runtime` or `--limit` value, neither `--transcript` nor `--latest` provided, or an explicitly named `--transcript` file that is missing, unreadable, or usage-free—SHALL remain hard errors with a non-zero exit and an actionable message.

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
- **THEN** the CLI SHALL report `contextTokens` from the rollout's LAST token-count event's total token usage
- **AND** SHALL report `runtime` as `codex`, `limit`, `pct`, the model id (best-effort from the rollout's `turn_context` records—the last one wins; `session_meta` never carries a model field—`unknown` when absent), and `transcript` in the same output shape as a Claude probe, so threshold consumers work unchanged

#### Scenario: Codex rollout with zero completed turns

- **WHEN** a probed Codex rollout contains no token-count event yet (a worker that has not completed a turn)
- **THEN** the CLI SHALL succeed, reporting `contextTokens` 0 and `pct` 0—zero occupancy is a normal young-worker state, not an error (deliberately asymmetric with the usage-free Claude transcript case, which stays an error because such a transcript is malformed rather than young)
- **AND** `remainingTokens` SHALL be 0 when no window is known (honest zero, not a fabricated headroom)

#### Scenario: Explicit runtime override

- **WHEN** a user passes `--runtime claude` or `--runtime codex`
- **THEN** the CLI SHALL read the transcript with the named runtime's reader regardless of filename or content detection and report that runtime
- **AND** SHALL reject any other `--runtime` value with an actionable error

### Requirement: Handoff threshold reporting across config layers

`rasen agent context` SHALL resolve the configured context-handoff threshold using the probe's detected or explicitly selected runtime. It SHALL first select a valid machine-level threshold scheme through that runtime's binding row across project, inherited-store, and global scope, then through the `default` binding row across those scopes. A selected scheme SHALL contribute its handoff scalar because the probe has no role identity. A missing or invalid referenced scheme SHALL be reported as a warning and skipped. If no usable scheme binding remains, resolution SHALL continue through project config `handoff.threshold` (when the working directory is inside a Rasen project), inherited store config `handoff.threshold` (when that project's configuration inherits from a store—see `store-config-inheritance`), global config `handoff.threshold`, and the built-in default 0.5.

The command SHALL report the resolved `threshold`, its source (a scope-qualified scheme source or the existing `project`, `store`, `global`, or `default` source), and a `shouldHandoff` flag alongside occupancy. The threshold SHALL accept the dual form (a bare fraction in (0, 1], or the absolute `{ remainingTokens: N }` headroom form); `shouldHandoff` compares measured occupancy against a fraction threshold (`pct >= threshold`) or `remainingTokens` against an absolute threshold (`remainingTokens <= threshold.remainingTokens`). The probe is role-agnostic, so pipeline, stage, role, and model-preset overrides SHALL NOT apply, and its exit code SHALL stay 0 even when `shouldHandoff` is true.

#### Scenario: Runtime-bound scheme supplies the threshold

- **WHEN** a Codex transcript is probed, project config binds `codex` to a valid scheme with `handoff: 0.55`, and legacy layers also contain thresholds
- **THEN** the JSON output includes runtime `codex`, threshold 0.55, a project-scheme source, and the correct `shouldHandoff` verdict

#### Scenario: Scheme role override is ignored by the probe

- **WHEN** the selected scheme declares `handoff: 0.5` and `handoffRoles.reviewer: 0.7`
- **THEN** agent context reports threshold 0.5 because the probe has no stage or role identity

#### Scenario: Dangling binding falls through to a lower binding

- **WHEN** the project runtime binding names a missing scheme and the inherited store runtime binding names a valid scheme
- **THEN** the project reference is warned and skipped, and the store scheme supplies the threshold

#### Scenario: JSON output includes legacy threshold fields

- **WHEN** no usable binding exists, `rasen agent context --json` measures 62% occupancy, and project config sets `handoff.threshold: 0.6`
- **THEN** the JSON output includes threshold 0.6, a source identifying the project config layer, and `shouldHandoff: true`
- **AND** the exit code is 0

#### Scenario: Store threshold applies when the project sets none

- **WHEN** no usable binding exists and the probe runs inside a project whose configuration inherits from a store setting `handoff.threshold: 0.7`, while project config sets no threshold
- **THEN** the JSON output includes threshold 0.7 with a source identifying the store config layer

#### Scenario: JSON output reports the absolute threshold form

- **WHEN** no usable binding exists, `rasen agent context --json` measures a probe with 50000 `remainingTokens`, and global config sets `handoff.threshold: { remainingTokens: 60000 }` with no project or store value
- **THEN** the JSON output includes threshold `{ remainingTokens: 60000 }`, a source identifying the global config layer, and `shouldHandoff: true` (measured `remainingTokens` is at or below the configured floor)
- **AND** the exit code is 0

#### Scenario: Human output shows the threshold verdict

- **WHEN** `rasen agent context` runs without `--json` and occupancy is below the resolved threshold
- **THEN** the one-line output includes the runtime, resolved threshold, and indicates a handoff is not yet needed

#### Scenario: Default threshold outside a project

- **WHEN** the probe runs outside any Rasen project and no usable default binding or global `handoff.threshold` is set
- **THEN** the reported threshold is 0.5 with the default source
