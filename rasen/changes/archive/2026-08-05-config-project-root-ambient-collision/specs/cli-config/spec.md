## MODIFIED Requirements

### Requirement: Project scope configuration operations

With `--scope project`, the config command SHALL read and write the project's resolved `rasen/config.yaml` with the same subcommand UX as global scope: `path` prints the project config file location, `list` shows the parsed project configuration, `get` prints a single value, `set` writes a registry-validated value, and `unset` removes a key. A directory SHALL count as a config project only when the existing project config-path resolver identifies an existing project configuration file there; an unrelated ancestor that merely contains a directory named `rasen` SHALL remain outside-project. Writes SHALL preserve existing comments, key ordering, and fields not being edited. Project-scope `set` SHALL reject keys the registry does not list for project scope (no `--allow-unknown` bypass).

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

- **WHEN** user executes a `--scope project` operation outside any initialized Rasen project
- **THEN** fail with guidance that no `rasen/` project was found
- **AND** exit with a non-zero code

#### Scenario: Ambient data directory is not a config project

- **WHEN** the nearest ancestor contains an unrelated `rasen/` directory but no project configuration file
- **THEN** project-scope config operations report that no initialized project was found
- **AND** no file beneath the ambient directory is read or written as project config

#### Scenario: Unknown project keys are rejected

- **WHEN** user executes `rasen config set --scope project someUnknownKey 1`
- **THEN** fail with an error identifying the key as unknown for project scope
- **AND** `rasen/config.yaml` is not modified

### Requirement: Interactive full-view configuration editor

The no-arg interactive editor SHALL present every registered configuration key grouped by area, each row showing the key, its current effective value, and a source annotation (`default`, `global`, `project`, or `env-override`). Selecting a key SHALL prompt for a new value appropriate to its type (choice list for enums and booleans, validated input for numbers and strings), write it to the appropriate scope, refresh the view, and continue until the user exits. Keys settable in both scopes SHALL prompt for the target scope only when an initialized project configuration is present. Cancellation (Ctrl+C) SHALL exit cleanly with code 130, consistent with the `config profile` picker.

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

- **WHEN** the editor opens outside an initialized Rasen project, including beneath an ancestor with only an unrelated `rasen/` data directory
- **THEN** project-only keys are shown as unavailable (requiring a Rasen project) or omitted
- **AND** global keys remain fully editable
- **AND** no project-scope prompt is shown

#### Scenario: Cancel exits cleanly

- **WHEN** the user cancels the editor with Ctrl+C
- **THEN** the process exits with code 130 and no partial write occurs
