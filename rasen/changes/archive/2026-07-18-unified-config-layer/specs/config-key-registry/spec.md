# config-key-registry Specification

## ADDED Requirements

### Requirement: Declarative registry of settable configuration keys
The system SHALL maintain a single declarative registry of every CLI-settable configuration key, where each entry declares the key path, the scopes it may be set in (`global`, `project`, or both), its value type (boolean, number, string, enum with allowed values, array, or the dual-form `threshold` type), any extra validation constraint, its built-in default, a one-line description, and a display group. Key validation for `config set`/`unset`, the interactive editor, and effective-config resolution SHALL all derive their key knowledge from this registry.

#### Scenario: Registry drives set validation in both scopes
- **WHEN** a user runs `rasen config set <key> <value>` in either scope
- **THEN** the key is accepted only if the registry lists it for that scope (global scope additionally honors `--allow-unknown` as an escape hatch)
- **AND** the value is validated against the registry's declared type and constraints before any file is written

#### Scenario: Rejection names the constraint
- **WHEN** a user sets `handoff.threshold` to `1.5`
- **THEN** the command fails with a message stating the allowed range or the alternate absolute `{ remainingTokens: N }` form
- **AND** no config file is modified

#### Scenario: The threshold type accepts its dual form
- **WHEN** a user sets `handoff.threshold` to `0.6`, or to `{"remainingTokens": 60000}`
- **THEN** both are accepted — a bare number as the fraction form, the object as the absolute form

#### Scenario: Registered keys cover the promoted options
- **WHEN** the registry is consulted
- **THEN** it includes at least: `profile`, `delivery`, `workflows`, `featureFlags.<name>`, `proactive`, `repoMode`, and `telemetry.enabled` for global scope; `schema`, `autopilot.gates`, `autopilot.selection`, `archive.timing`, and `archive.destination` for project scope; and `handoff.threshold` for both scopes

#### Scenario: Registry keys stay consistent with the parse schemas
- **WHEN** the test suite runs
- **THEN** a test asserts every registry key is accepted by the corresponding scope's config schema, so the registry and the zod schemas cannot drift silently
