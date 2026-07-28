## MODIFIED Requirements

### Requirement: Keepalive keys are registered

The configuration key registry SHALL include the keepalive keys: `keepalive.runtimes.claude` (boolean, default `true`), `keepalive.runtimes.codex` (boolean, default `false`), `keepalive.contextFloor` (number, non-negative integer, default `0` — 0 disables the floor), and `keepalive.beatSeconds` (number, integer between 90 and 280 inclusive, default `270`), each settable in the `global` scope (with `store`/`project` scopes permitted if the resolution design allows narrower overrides), validated through the standard registry paths (`config set`/`unset`, the interactive editor, the config HTTP API, effective-config resolution).

#### Scenario: Keepalive runtime gate keys validate
- **WHEN** `rasen config set keepalive.runtimes.codex true --scope global` is run
- **THEN** the registry accepts the key as a boolean and the effective configuration reflects the override

#### Scenario: Context floor validates as a non-negative number
- **WHEN** `rasen config set keepalive.contextFloor abc --scope global` is run
- **THEN** registry validation rejects the value naming the number type, and no file is modified

#### Scenario: Beat seconds accepts the configurable range
- **WHEN** `rasen config set keepalive.beatSeconds 270 --scope global` is run
- **THEN** the registry accepts the value and the effective configuration reflects it

#### Scenario: Beat seconds rejects out-of-range values
- **WHEN** `rasen config set keepalive.beatSeconds 85 --scope global` (or `300`, or a non-integer) is run
- **THEN** registry validation rejects the value naming the 90–280 integer constraint, and no file is modified

#### Scenario: Unset beat seconds resolves to the registry default
- **WHEN** no layer sets `keepalive.beatSeconds` and the effective configuration is resolved
- **THEN** the effective value is `270` with a default source annotation
