## MODIFIED Requirements

### Requirement: Profile Configuration Flow

The `rasen config profile` command SHALL provide an action-first interactive flow that allows users to modify workflow settings. Delivery is retired and SHALL NOT appear as a configurable option.

#### Scenario: Current profile summary appears first

- **WHEN** user runs `rasen config profile` in an interactive terminal
- **THEN** display a current-state header with:
  - workflow count with profile label (core or custom)

#### Scenario: Action-first menu offers skippable paths

- **WHEN** user runs `rasen config profile` interactively
- **THEN** the first prompt SHALL offer:
  - `Change workflows`
  - `Keep current settings (exit)`

#### Scenario: No-op exits without saving or apply prompt

- **WHEN** user chooses `Keep current settings (exit)` OR makes selections that do not change effective config values
- **THEN** the command SHALL print `No config changes.`
- **AND** SHALL NOT write config changes
- **AND** SHALL NOT ask to apply updates to the current project

#### Scenario: No-op warns when current project is out of sync

- **WHEN** `rasen config profile` exits with `No config changes.` inside a Rasen project
- **AND** project files are out of sync with the current global profile
- **THEN** display a non-blocking warning that global config is not yet applied to this project
- **AND** include guidance to run `rasen update` to sync project files

#### Scenario: Apply prompt is gated on actual changes

- **WHEN** config values were changed and saved
- **AND** current directory is a Rasen project
- **THEN** prompt `Apply changes to this project now?`
- **AND** if confirmed, run `rasen update` for the current project

### Requirement: Schema Validation

The config command SHALL validate configuration writes against the config schema using zod, while rejecting unknown keys for `config set` unless explicitly overridden. The retired `delivery` key SHALL be handled gracefully — writing it does not crash and does not persist a delivery value — and a stored delivery value SHALL never block a whole-file validation.

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

#### Scenario: Setting the retired delivery key is a graceful no-op

- **WHEN** user executes `rasen config set delivery <any-value>` (a current or legacy value such as `both`, `skills`, `commands`, `commands-first`, or `skills-first`)
- **THEN** the command SHALL NOT crash with a raw unknown-key error
- **AND** it SHALL emit the retirement notice explaining that commands have been consolidated into skills and the delivery setting has been retired
- **AND** it SHALL NOT persist a `delivery` value to the config

#### Scenario: Config edits with a retired delivery value present still validate

- **WHEN** the config file contains a leftover `delivery` value
- **AND** user executes a `rasen config set` or `rasen config edit` operation on an unrelated key
- **THEN** whole-file validation SHALL succeed (the leftover delivery value does not block the write)
- **AND** the retired `delivery` key SHALL be removed from the file as part of the write
