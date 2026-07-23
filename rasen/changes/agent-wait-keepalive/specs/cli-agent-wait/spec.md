# cli-agent-wait Specification (Delta)

## ADDED Requirements

### Requirement: Beat semantics of rasen agent wait
`rasen agent wait --change <name> --role <key>` SHALL execute exactly one keepalive beat per invocation: block for at most the beat duration (default 270 seconds, `--beat-seconds` settable up to a hard cap of 300), polling the role's signal file at `<changeRoot>/signals/<key>.json` at an interval of no more than 5 seconds. Every outcome SHALL exit with code 0 and emit a single JSON object on stdout; the command SHALL NOT rely on shell `sleep` for blocking (the wait loop runs inside the Node process).

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
When `--context-tokens <n>` is provided and `<n>` is below the resolved context floor (default 100000, configurable via `keepalive.contextFloor`), the command SHALL return `{ "standDown": true, "reason": "context-below-floor" }` immediately. When the flag is omitted the exemption check SHALL be skipped.

#### Scenario: Small context stands down
- **WHEN** `rasen agent wait --context-tokens 60000` is invoked with the default floor
- **THEN** the command returns `{ "standDown": true, "reason": "context-below-floor" }` immediately

#### Scenario: Omitted flag skips the check
- **WHEN** `rasen agent wait` is invoked without `--context-tokens`
- **THEN** the beat proceeds under the remaining gates
