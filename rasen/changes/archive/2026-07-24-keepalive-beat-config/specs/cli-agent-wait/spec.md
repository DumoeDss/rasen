## MODIFIED Requirements

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
