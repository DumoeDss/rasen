# cli-agent-wait Specification

## Purpose
Defines `rasen agent wait`, the subagent cache-keepalive primitive: a per-beat CLI command that parks a dispatched worker (blocking-poll a per-role signal file, with a persistent beat cap, runtime gating, and a context-floor exemption) so the orchestration playbook can keep a worker's cache warm between reuses without SendMessage, and hands control back via a single JSON outcome on stdout.
## Requirements
### Requirement: Beat semantics of rasen agent wait
`rasen agent wait --change <name> --role <key>` SHALL execute exactly one keepalive beat per invocation: block for at most the beat duration, polling the role's signal file at `<changeRoot>/signals/<key>.json` at an interval of no more than 5 seconds. The beat duration SHALL resolve in this order: an explicit `--beat-seconds` flag; otherwise the resolved `keepalive.beatSeconds` configuration value (registry default 270 — near-optimal for the 5-minute cache TTL); otherwise the built-in fuse of 100 seconds when configuration is unavailable or the configured value is outside the 90–280 range. The resolved duration SHALL remain clamped to a hard cap of 300 seconds. Every outcome SHALL exit with code 0 and emit a single JSON object on stdout; the command SHALL NOT rely on shell `sleep` for blocking (the wait loop runs inside the Node process). The `--beat-seconds` help text SHALL state that beats longer than the host shell tool's default timeout require the caller to raise the tool timeout.

#### Scenario: Timeout beat returns progress
- **WHEN** a beat elapses with no signal file appearing
- **THEN** the command exits 0 with JSON `{ "beat": <n>, "remaining": <cap - n> }` where `<n>` is the persisted beat count including this beat

#### Scenario: Resume signal is returned and consumed
- **WHEN** a signal file with `kind: "resume"` and an `instruction` payload appears during a beat
- **THEN** the command exits 0 with JSON `{ "resumed": true, "instruction": <payload> }` before the beat duration elapses
- **AND** the signal file is deleted (consume semantics), with deletion retried up to 3 times on Windows file-lock errors

#### Scenario: Stand-down signal from the LEAD
- **WHEN** a signal file with `kind: "standDown"` appears during a beat
- **THEN** the command exits 0 with JSON `{ "standDown": true, "reason": "lead-stand-down" }` and consumes the signal file and clears the beat state

#### Scenario: Explicit flag wins over configuration
- **WHEN** `keepalive.beatSeconds` is configured to `270` and `rasen agent wait --beat-seconds 100` is invoked
- **THEN** the beat blocks for at most 100 seconds

#### Scenario: Configured beat applies without a flag
- **WHEN** `keepalive.beatSeconds` is set to `120` and `rasen agent wait` is invoked without `--beat-seconds`
- **THEN** the beat blocks for at most 120 seconds

#### Scenario: Unset configuration uses the registry default
- **WHEN** no layer sets `keepalive.beatSeconds` and `rasen agent wait` is invoked without `--beat-seconds`
- **THEN** the beat blocks for at most 270 seconds (the registry default), consistent with the effective value config surfaces report

#### Scenario: Out-of-range configuration falls back to the fuse
- **WHEN** the on-disk `keepalive.beatSeconds` value is outside the 90–280 range and `rasen agent wait` is invoked without `--beat-seconds`
- **THEN** the beat blocks for at most 100 seconds (the built-in fuse)

### Requirement: Persistent beat cap
Beat counts SHALL persist across invocations in `<changeRoot>/signals/.state/<key>.json` (`{ beats, startedAt, maxBeats }`). When the persisted count reaches the applicable cap, the command SHALL immediately return `{ "standDown": true, "reason": "beat-cap" }` without waiting and clear the state file. The counter SHALL reset when a resume signal is consumed, when the applicable `maxBeats` differs from the persisted `maxBeats`, or when `startedAt` is older than 2 hours (stale-state reset).

#### Scenario: Cap reached returns standDown without waiting
- **WHEN** the persisted beat count has reached the applicable cap and `rasen agent wait` is invoked again
- **THEN** the command returns `{ "standDown": true, "reason": "beat-cap" }` immediately (no blocking) and removes the state file

#### Scenario: Consumption resets the counter
- **WHEN** a resume signal is consumed and the same role later parks again with a fresh `rasen agent wait`
- **THEN** the beat count starts from 1 for the new park episode

#### Scenario: Stale state resets
- **WHEN** the persisted `startedAt` is more than 2 hours in the past
- **THEN** the invocation treats the state as absent and counts the current beat as 1

### Requirement: Default beat cap
When `--max-beats` is not given, the cap SHALL be 12 beats for every role key. An explicit `--max-beats` SHALL override the default.

#### Scenario: Uniform default applies
- **WHEN** `rasen agent wait` runs with `--role impl-spaces`, `--role reviewer`, and `--role planner-1` without `--max-beats`
- **THEN** the applicable cap is 12 for each role

#### Scenario: Explicit override wins
- **WHEN** `rasen agent wait --role impl-spaces --max-beats 6` is invoked
- **THEN** the applicable cap is 6

### Requirement: Runtime gating
The command SHALL detect the invoking agent runtime from the host environment (Claude Code and Codex fingerprints, reusing the existing runtime-detection utilities) and consult the resolved keepalive gate: with defaults, the `claude` runtime is enabled, the `codex` runtime is disabled, and an unrecognized runtime is disabled. When the gate is closed the command SHALL return `{ "standDown": true, "reason": "runtime-not-gated" }` immediately, with no blocking and no beat-state mutation.

#### Scenario: Claude runtime is gated on
- **WHEN** the command runs under a Claude Code environment fingerprint with default configuration
- **THEN** the beat executes normally (blocking poll, beat counting)

#### Scenario: Codex runtime is gated off
- **WHEN** the command runs under a Codex environment fingerprint with default configuration
- **THEN** the command returns `{ "standDown": true, "reason": "runtime-not-gated" }` immediately and writes no beat state

#### Scenario: Unknown runtime fails safe
- **WHEN** neither runtime fingerprint is detected
- **THEN** the command returns `{ "standDown": true, "reason": "runtime-not-gated" }` immediately

#### Scenario: Configuration overrides the gate
- **WHEN** the resolved configuration sets `keepalive.runtimes.codex` to `true`
- **THEN** a Codex-fingerprinted invocation executes beats normally

### Requirement: Context floor exemption
The context floor SHALL default to 0, meaning the floor gate is disabled: with default configuration the beat proceeds regardless of `--context-tokens`. When `keepalive.contextFloor` is configured to a positive integer AND `--context-tokens <n>` is provided with `<n>` below the floor, the command SHALL return `{ "standDown": true, "reason": "context-below-floor" }` immediately. When the flag is omitted the check SHALL be skipped. Configuration SHALL accept 0 (explicitly disabled) as well as positive integers.

#### Scenario: Default floor is disabled
- **WHEN** `rasen agent wait --context-tokens 60000` is invoked with default configuration
- **THEN** the beat proceeds under the remaining gates (no context-below-floor stand-down)

#### Scenario: Small context stands down
- **WHEN** `keepalive.contextFloor` is configured to 100000 and `rasen agent wait --context-tokens 60000` is invoked
- **THEN** the command returns `{ "standDown": true, "reason": "context-below-floor" }` immediately

#### Scenario: Omitted flag skips the check
- **WHEN** `rasen agent wait` is invoked without `--context-tokens`
- **THEN** the beat proceeds under the remaining gates

### Requirement: Signal parsing tolerates a UTF-8 BOM
Signal files SHALL be parsed with any leading UTF-8 byte-order mark stripped, so signals written by Windows tooling (e.g. PowerShell `Set-Content -Encoding utf8`) are delivered rather than swallowed as malformed poison pills.

#### Scenario: BOM-prefixed resume is delivered
- **WHEN** a resume signal file begins with a UTF-8 BOM followed by valid JSON
- **THEN** the beat returns `{ "resumed": true, "instruction": <payload> }` normally

### Requirement: Stale pre-episode signals are discarded
On the first beat of a park episode (persisted beat count 0), the command SHALL discard — consume without delivering — any pre-existing signal file whose modification time is more than 120 seconds before the invocation, treating it as a leftover from a prior episode. A pre-existing signal within the 120-second grace window SHALL still be delivered (preserving the no-lost-wakeup property when the LEAD writes a resume moments before the worker parks). On subsequent beats of a live episode (persisted beat count > 0), every signal SHALL be delivered regardless of age.

#### Scenario: Leftover standDown cannot insta-kill a new park
- **WHEN** a `standDown` signal file written more than 120 seconds ago exists and a worker begins a fresh park episode
- **THEN** the first beat consumes the stale file without acting on it and proceeds to poll normally

#### Scenario: Fresh pre-park resume is still delivered
- **WHEN** the LEAD writes a `resume` signal less than 120 seconds before the worker's first beat
- **THEN** the first beat returns `{ "resumed": true, "instruction": <payload> }` as usual

#### Scenario: Mid-episode signals are never age-filtered
- **WHEN** a park episode already has at least one recorded beat and a signal file appears
- **THEN** the signal is delivered regardless of its modification time

