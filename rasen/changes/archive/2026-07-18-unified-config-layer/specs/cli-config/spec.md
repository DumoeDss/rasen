# cli-config Delta Specification

## MODIFIED Requirements

### Requirement: Command Structure

The config command SHALL provide subcommands for all configuration operations, a `--scope` option selecting between `global` (default) and `project` configuration, and an interactive full-view editor when invoked with no subcommand.

#### Scenario: Available subcommands

- **WHEN** user executes `rasen config --help`
- **THEN** display available subcommands:
  - `path` - Show config file location
  - `list` - Show all current settings
  - `get <key>` - Get a specific value
  - `set <key> <value>` - Set a value
  - `unset <key>` - Remove a key (revert to default)
  - `reset` - Reset configuration to defaults
  - `edit` - Open config in editor
- **AND** document the `--scope <global|project>` option

#### Scenario: Scope option validation

- **WHEN** user executes a config subcommand with `--scope <value>` where value is neither `global` nor `project`
- **THEN** fail with an error naming the accepted scopes
- **AND** exit with a non-zero code

#### Scenario: No-arg invocation opens the interactive editor

- **WHEN** user executes `rasen config` with no subcommand in an interactive terminal
- **THEN** open the interactive full-view configuration editor

#### Scenario: No-arg invocation without a TTY

- **WHEN** user executes `rasen config` with no subcommand and stdout is not a TTY
- **THEN** print the effective configuration view (each registered key with its effective value and source) non-interactively
- **AND** exit with code 0

### Requirement: Config Set

The config command SHALL set configuration values with automatic type coercion, validated against the config-key registry for the selected scope.

#### Scenario: Set string value

- **WHEN** user executes `rasen config set <key> <value>`
- **AND** value does not match boolean or number patterns
- **THEN** store value as a string
- **AND** display confirmation message

#### Scenario: Set boolean value

- **WHEN** user executes `rasen config set <key> true` or `rasen config set <key> false`
- **THEN** store value as boolean (not string)
- **AND** display confirmation message

#### Scenario: Set numeric value

- **WHEN** user executes `rasen config set <key> <value>`
- **AND** value is a valid number (integer or float)
- **THEN** store value as number (not string)

#### Scenario: Force string with --string flag

- **WHEN** user executes `rasen config set <key> <value> --string`
- **THEN** store value as string regardless of content
- **AND** this allows storing literal "true" or "123" as strings

#### Scenario: Set nested key

- **WHEN** user executes `rasen config set featureFlags.newFlag true`
- **THEN** create intermediate objects if they don't exist
- **AND** set the value at the nested path

#### Scenario: Promoted global keys are settable without --allow-unknown

- **WHEN** user executes `rasen config set proactive false`, `rasen config set repoMode solo`, `rasen config set telemetry.enabled false`, or `rasen config set handoff.threshold 0.6`
- **THEN** the value is validated against the key's declared type and stored
- **AND** no `--allow-unknown` flag is required

#### Scenario: Registry validation rejects invalid values

- **WHEN** user executes `rasen config set repoMode banana`
- **THEN** fail with a message listing the allowed values
- **AND** the config file is not modified

## ADDED Requirements

### Requirement: Project scope configuration operations

With `--scope project`, the config command SHALL read and write the project's `rasen/config.yaml` with the same subcommand UX as global scope: `path` prints the project config file location, `list` shows the parsed project configuration, `get` prints a single value, `set` writes a registry-validated value, and `unset` removes a key. Writes SHALL preserve existing comments, key ordering, and fields not being edited. Project-scope `set` SHALL reject keys the registry does not list for project scope (no `--allow-unknown` bypass).

#### Scenario: Project scope set writes config.yaml

- **WHEN** user executes `rasen config set --scope project autopilot.gates off` inside a Rasen project
- **THEN** `rasen/config.yaml` gains (or updates) `autopilot.gates: off`
- **AND** existing comments and unrelated fields in the file are preserved byte-for-byte where untouched
- **AND** a confirmation message is displayed

#### Scenario: Project scope get and list

- **WHEN** user executes `rasen config get --scope project autopilot.gates` (or `rasen config list --scope project`)
- **THEN** the value (or full parsed project configuration) is printed from `rasen/config.yaml`

#### Scenario: Project scope unset

- **WHEN** user executes `rasen config unset --scope project handoff.threshold` and the key was set
- **THEN** the key is removed from `rasen/config.yaml`
- **AND** subsequent resolution falls back to the global value or default

#### Scenario: Project scope outside a Rasen project

- **WHEN** user executes a `--scope project` operation outside any Rasen project
- **THEN** fail with guidance that no `rasen/` project was found
- **AND** exit with a non-zero code

#### Scenario: Unknown project keys are rejected

- **WHEN** user executes `rasen config set --scope project someUnknownKey 1`
- **THEN** fail with an error identifying the key as unknown for project scope
- **AND** `rasen/config.yaml` is not modified

### Requirement: Interactive full-view configuration editor

The no-arg interactive editor SHALL present every registered configuration key grouped by area, each row showing the key, its current effective value, and a source annotation (`default`, `global`, `project`, or `env-override`). Selecting a key SHALL prompt for a new value appropriate to its type (choice list for enums and booleans, validated input for numbers and strings), write it to the appropriate scope, refresh the view, and continue until the user exits. Keys settable in both scopes SHALL prompt for the target scope when inside a project. Cancellation (Ctrl+C) SHALL exit cleanly with code 130, consistent with the `config profile` picker.

#### Scenario: Editor shows values with source annotations

- **WHEN** the editor opens in a project where `handoff.threshold` is set in project config and `proactive` is unset anywhere
- **THEN** the `handoff.threshold` row shows the project value annotated `project`
- **AND** the `proactive` row shows the default value annotated `default`

#### Scenario: Editing an enum key

- **WHEN** the user selects `autopilot.gates` and chooses `off`
- **THEN** the value is written to the project's `rasen/config.yaml`
- **AND** the refreshed view shows `off` annotated `project`

#### Scenario: Env-overridden key is visible as such

- **WHEN** `RASEN_TELEMETRY=0` is set and the user opens the editor
- **THEN** the `telemetry.enabled` row shows disabled with the `env-override` annotation
- **AND** the editor communicates that the environment variable takes precedence over any stored value

#### Scenario: Project-scoped keys outside a project

- **WHEN** the editor opens outside a Rasen project
- **THEN** project-only keys are shown as unavailable (requiring a Rasen project) or omitted
- **AND** global keys remain fully editable

#### Scenario: Cancel exits cleanly

- **WHEN** the user cancels the editor with Ctrl+C
- **THEN** the process exits with code 130 and no partial write occurs
