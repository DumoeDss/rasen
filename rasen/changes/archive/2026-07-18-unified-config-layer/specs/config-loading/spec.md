# config-loading Delta Specification

## ADDED Requirements

### Requirement: Parse handoff threshold from project config

Project config parsing SHALL accept an optional `handoff` block in `rasen/config.yaml` carrying `threshold`, in dual form: a bare number in (0, 1] representing the context-window occupancy fraction at which agents should hand off, or the object `{ remainingTokens: <positive integer> }` representing an absolute required-headroom threshold in tokens. The field SHALL follow the same resilient field-by-field parsing as other blocks: an invalid `handoff` value (either form) is dropped with a warning without failing the rest of the config.

#### Scenario: Valid handoff threshold parses

- **WHEN** `rasen/config.yaml` contains `handoff:\n  threshold: 0.6`
- **THEN** the parsed project config exposes `handoff.threshold` as 0.6

#### Scenario: Valid absolute-form handoff threshold parses

- **WHEN** `rasen/config.yaml` contains `handoff:\n  threshold:\n    remainingTokens: 60000`
- **THEN** the parsed project config exposes `handoff.threshold` as `{ remainingTokens: 60000 }`

#### Scenario: Out-of-range threshold is dropped resiliently

- **WHEN** `rasen/config.yaml` contains `handoff:\n  threshold: 1.5`
- **THEN** the `handoff` field is dropped with a warning naming the valid range
- **AND** all other valid fields in the config are still parsed

#### Scenario: An invalid absolute-form threshold is dropped resiliently

- **WHEN** `rasen/config.yaml` contains `handoff:\n  threshold:\n    remainingTokens: -5`
- **THEN** the `handoff` field is dropped with a warning naming the valid form
- **AND** all other valid fields in the config are still parsed

#### Scenario: Absent handoff block

- **WHEN** `rasen/config.yaml` has no `handoff` block
- **THEN** parsing succeeds and the resolved threshold falls back to the global config value or the built-in default
