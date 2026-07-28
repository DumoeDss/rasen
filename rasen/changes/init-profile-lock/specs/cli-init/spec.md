# cli-init Delta

## ADDED Requirements

### Requirement: Init persists an explicit profile choice as the project's locked profile

When `rasen init` runs with an explicit `--profile` value other than `custom`, it SHALL record that value under the `profile` key in the project's `rasen/config.yaml`, so subsequent selection-resolving commands keep using it as the project's locked profile. Without `--profile`, init SHALL NOT write a `profile` key and SHALL behave exactly as today. `--profile custom` remains a one-run selection and SHALL never be persisted.

#### Scenario: Fresh init with a built-in profile writes the lock

- **WHEN** user runs `rasen init --profile core` in a project with no `rasen/` directory
- **THEN** the created `rasen/config.yaml` SHALL contain `profile: core`
- **AND** the success output SHALL state that the project is locked to `core`

#### Scenario: Fresh init with a named profile writes the lock

- **WHEN** user runs `rasen init --profile team-web` and a saved profile `team-web` exists
- **THEN** the created `rasen/config.yaml` SHALL contain `profile: team-web`

#### Scenario: Init without --profile writes no lock

- **WHEN** user runs `rasen init` without `--profile`
- **THEN** the created `rasen/config.yaml` SHALL NOT contain a `profile` key
- **AND** selection resolution behaves exactly as before this feature

#### Scenario: --profile custom is applied but not persisted

- **WHEN** user runs `rasen init --profile custom`
- **THEN** the run SHALL use the global `custom` selection for skill generation
- **AND** `rasen/config.yaml` SHALL NOT contain a `profile` key

#### Scenario: Extend mode updates the lock in an existing config

- **WHEN** user runs `rasen init --profile team-web` in an already-initialized project whose `rasen/config.yaml` exists
- **THEN** the existing config file SHALL be updated so `profile` is `team-web`
- **AND** every other key and the file's comments SHALL be preserved

#### Scenario: Extend mode honors an existing lock

- **WHEN** user runs `rasen init` without `--profile` in an already-initialized project whose config carries `profile: team-web`
- **THEN** the run SHALL resolve the install selection from the `team-web` profile rather than the user-wide profile

## MODIFIED Requirements

### Requirement: Init respects global config

The init command SHALL read and apply settings from global config, and SHALL accept saved named profiles in addition to the built-in values for `--profile`.

#### Scenario: User has profile preference

- **WHEN** global config contains `profile: "custom"` with custom workflows
- **THEN** init SHALL install custom profile workflows

#### Scenario: Override via flags

- **WHEN** user runs `rasen init --profile core`
- **THEN** the system SHALL use the flag value instead of the global config value
- **THEN** the system SHALL NOT update the global config
- **AND** the system SHALL record the choice as the project's locked profile

#### Scenario: Named profile override

- **WHEN** user runs `rasen init --profile team-web` and a saved profile `team-web` exists
- **THEN** the system SHALL resolve the install selection from that definition's ids plus dependency closure

#### Scenario: Invalid profile override

- **WHEN** user runs `rasen init --profile <invalid>`
- **AND** `<invalid>` is not `full`, `core`, `custom`, or the name of a saved profile
- **THEN** the system SHALL exit with code 1
- **THEN** the system SHALL display a validation error listing the built-in values and the saved profile names
