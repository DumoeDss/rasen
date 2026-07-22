# cli-config Specification

## Purpose
Provide a user-friendly CLI interface for viewing and modifying global Rasen configuration settings without manually editing JSON files.
## Requirements
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

### Requirement: Config Path

The config command SHALL display the config file location.

#### Scenario: Show config path

- **WHEN** user executes `rasen config path`
- **THEN** print the absolute path to the config file
- **AND** exit with code 0

### Requirement: Config List

The config command SHALL display all current configuration values.

#### Scenario: List config in human-readable format

- **WHEN** user executes `rasen config list`
- **THEN** display all config values in YAML-like format
- **AND** show nested objects with indentation

#### Scenario: List config as JSON

- **WHEN** user executes `rasen config list --json`
- **THEN** output the complete config as valid JSON
- **AND** output only JSON (no additional text)

### Requirement: Config Get

The config command SHALL retrieve specific configuration values.

#### Scenario: Get top-level key

- **WHEN** user executes `rasen config get <key>` with a valid top-level key
- **THEN** print the raw value only (no labels or formatting)
- **AND** exit with code 0

#### Scenario: Get nested key with dot notation

- **WHEN** user executes `rasen config get featureFlags.someFlag`
- **THEN** traverse the nested structure using dot notation
- **AND** print the value at that path

#### Scenario: Get non-existent key

- **WHEN** user executes `rasen config get <key>` with a key that does not exist
- **THEN** print nothing (empty output)
- **AND** exit with code 1

#### Scenario: Get object value

- **WHEN** user executes `rasen config get <key>` where the value is an object
- **THEN** print the object as JSON

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

### Requirement: Config Unset

The config command SHALL remove configuration overrides.

#### Scenario: Unset existing key

- **WHEN** user executes `rasen config unset <key>`
- **AND** the key exists in the config
- **THEN** remove the key from the config file
- **AND** the value reverts to its default
- **AND** display confirmation message

#### Scenario: Unset non-existent key

- **WHEN** user executes `rasen config unset <key>`
- **AND** the key does not exist in the config
- **THEN** display message indicating key was not set
- **AND** exit with code 0

### Requirement: Config Reset

The config command SHALL reset configuration to defaults.

#### Scenario: Reset all with confirmation

- **WHEN** user executes `rasen config reset --all`
- **THEN** prompt for confirmation before proceeding
- **AND** if confirmed, delete the config file or reset to defaults
- **AND** display confirmation message

#### Scenario: Reset all with -y flag

- **WHEN** user executes `rasen config reset --all -y`
- **THEN** reset without prompting for confirmation

#### Scenario: Reset without --all flag

- **WHEN** user executes `rasen config reset` without `--all`
- **THEN** display error indicating `--all` is required
- **AND** exit with code 1

### Requirement: Config Edit

The config command SHALL open the config file in the user's editor.

#### Scenario: Open editor successfully

- **WHEN** user executes `rasen config edit`
- **AND** `$EDITOR` or `$VISUAL` environment variable is set
- **THEN** open the config file in that editor
- **AND** create the config file with defaults if it doesn't exist
- **AND** wait for the editor to close before returning

#### Scenario: No editor configured

- **WHEN** user executes `rasen config edit`
- **AND** neither `$EDITOR` nor `$VISUAL` is set
- **THEN** display error message suggesting to set `$EDITOR`
- **AND** exit with code 1

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

### Requirement: Key Naming Convention

The config command SHALL use camelCase keys matching the JSON structure.

#### Scenario: Keys match JSON structure

- **WHEN** accessing configuration keys via CLI
- **THEN** use camelCase matching the actual JSON property names
- **AND** support dot notation for nested access (e.g., `featureFlags.someFlag`)

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

### Requirement: Reserved Scope Flag

The config command SHALL reserve the `--scope` flag for future extensibility.

#### Scenario: Scope flag defaults to global

- **WHEN** user executes any config command without `--scope`
- **THEN** operate on global configuration (default behavior)

#### Scenario: Project scope not yet implemented

- **WHEN** user executes `rasen config --scope project <subcommand>`
- **THEN** display error message: "Project-local config is not yet implemented"
- **AND** exit with code 1

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
