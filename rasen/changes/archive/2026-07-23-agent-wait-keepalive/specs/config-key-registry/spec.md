# config-key-registry Specification (Delta)

## ADDED Requirements

### Requirement: Keepalive keys are registered
The configuration key registry SHALL include the keepalive keys: `keepalive.runtimes.claude` (boolean, default `true`), `keepalive.runtimes.codex` (boolean, default `false`), and `keepalive.contextFloor` (number, positive integer, default `100000`), each settable in the `global` scope (with `store`/`project` scopes permitted if the resolution design allows narrower overrides), validated through the standard registry paths (`config set`/`unset`, the interactive editor, the config HTTP API, effective-config resolution).

#### Scenario: Keepalive runtime gate keys validate
- **WHEN** `rasen config set keepalive.runtimes.codex true --scope global` is run
- **THEN** the registry accepts the key as a boolean and the effective configuration reflects the override

#### Scenario: Context floor validates as a positive number
- **WHEN** `rasen config set keepalive.contextFloor abc --scope global` is run
- **THEN** registry validation rejects the value naming the number type, and no file is modified
