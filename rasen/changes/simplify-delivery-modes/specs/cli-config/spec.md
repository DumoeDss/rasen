## MODIFIED Requirements

### Requirement: Schema Validation

The config command SHALL validate configuration writes against the config schema using zod, while rejecting unknown keys for `config set` unless explicitly overridden. Retired delivery values remain valid input and are consolidated rather than rejected.

#### Scenario: Unknown key rejected by default

- **WHEN** user executes `rasen config set someFutureKey 123`
- **THEN** display a descriptive error message indicating the key is invalid
- **AND** do not modify the config file
- **AND** exit with code 1

#### Scenario: Unknown key accepted with override

- **WHEN** user executes `rasen config set someFutureKey 123 --allow-unknown`
- **THEN** the value is saved successfully
- **AND** exit with code 0

#### Scenario: Invalid feature flag value rejected

- **WHEN** user executes `rasen config set featureFlags.someFlag notABoolean`
- **THEN** display a descriptive error message
- **AND** do not modify the config file
- **AND** exit with code 1

#### Scenario: Legacy delivery value accepted and consolidated

- **WHEN** user executes `rasen config set delivery commands-first` (or `commands`, or `skills-first`)
- **THEN** validation SHALL NOT reject the value
- **AND** the effective delivery on the next read SHALL be the consolidated value (`both` for `commands`/`commands-first`, `skills` for `skills-first`), accompanied by the one-time consolidation notice

#### Scenario: Config edits with a legacy delivery value present still validate

- **WHEN** the config file contains a retired delivery value
- **AND** user executes a `rasen config set` or `rasen config edit` operation on an unrelated key
- **THEN** whole-file validation SHALL succeed (the legacy delivery value does not block the write)
