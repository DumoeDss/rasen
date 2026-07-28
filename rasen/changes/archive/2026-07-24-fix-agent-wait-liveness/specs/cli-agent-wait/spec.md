# cli-agent-wait Delta

## MODIFIED Requirements

### Requirement: Beat semantics of rasen agent wait
`rasen agent wait --change <name> --role <key>` SHALL execute exactly one keepalive beat per invocation: block for at most the beat duration (default 100 seconds — chosen to fit inside the host harness's default shell-tool timeout of 120 seconds — with `--beat-seconds` settable up to a hard cap of 300), polling the role's signal file at `<changeRoot>/signals/<key>.json` at an interval of no more than 5 seconds. Every outcome SHALL exit with code 0 and emit a single JSON object on stdout; the command SHALL NOT rely on shell `sleep` for blocking (the wait loop runs inside the Node process).

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

#### Scenario: Default beat fits the default shell-tool timeout
- **WHEN** `rasen agent wait` is invoked without `--beat-seconds`
- **THEN** the beat blocks for at most 100 seconds, so an invocation through a shell tool with a 120-second default timeout returns synchronously instead of being killed or backgrounded mid-beat

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

## ADDED Requirements

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
