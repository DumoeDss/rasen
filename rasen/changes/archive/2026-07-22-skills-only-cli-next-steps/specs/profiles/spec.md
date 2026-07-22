## MODIFIED Requirements

### Requirement: Named profile management

The system SHALL expose reusable profile snapshots through the top-level `rasen profile` command group. A profile snapshot captures the workflow (and expert) selection only; the retired `delivery` setting is not part of a profile.

#### Scenario: Create a named profile
- **WHEN** user runs `rasen profile new [name]` in an interactive terminal
- **THEN** the system SHALL validate or prompt for a portable profile name
- **AND** SHALL prompt for workflows using current settings as defaults
- **AND** SHALL save the definition under the machine-global `profiles` directory
- **AND** SHALL apply the new definition to current global config after confirmation

#### Scenario: Retry an unavailable prompted profile name
- **WHEN** user runs `rasen profile new` without a name
- **AND** enters an invalid, reserved, or existing profile name
- **THEN** the name prompt SHALL display the reason and remain open for another value
- **AND** cancelling the open prompt SHALL report that the profile command was cancelled

#### Scenario: Reject an unavailable explicit profile name
- **WHEN** user runs `rasen profile new <name>` with an invalid, reserved, or existing name
- **THEN** the command SHALL fail before prompting for workflows
- **AND** SHALL display the reason

#### Scenario: Use a named profile
- **WHEN** user runs `rasen profile use <name>`
- **THEN** the system SHALL copy that definition's workflows into current global config
- **AND** SHALL classify the current selection as `full`, `core`, or `custom`
- **AND** SHALL instruct the user to run `rasen update` in projects

#### Scenario: Select a profile interactively
- **WHEN** user runs `rasen profile use` without a name in a TTY
- **THEN** the system SHALL offer built-in and valid saved profiles
- **WHEN** the same command runs outside a TTY
- **THEN** the command SHALL fail and require an explicit name

#### Scenario: List profiles for humans or automation
- **WHEN** user runs `rasen profile list`
- **THEN** the system SHALL list built-in and saved profiles with workflow count
- **WHEN** user adds `--json`
- **THEN** the system SHALL emit structured JSON including whether each profile matches current settings

#### Scenario: Delete a saved profile
- **WHEN** user runs `rasen profile delete [name]`
- **THEN** the system SHALL require confirmation unless `--yes` is provided
- **AND** SHALL never delete built-in profiles
- **AND** SHALL leave current global settings unchanged

### Requirement: Named profile storage and validation

User-named profiles SHALL be stored as versioned YAML definitions under `<global-config-dir>/profiles/<name>.yaml` and SHALL contain only `version` and `workflows`. The `workflows` list MAY name workflow ids and expert ids. A retired `delivery` field present in a legacy definition file SHALL be tolerated and ignored on read rather than rejected, so existing saved profiles keep loading.

#### Scenario: Validate names and content before saving
- **WHEN** a profile is created or imported
- **THEN** its name SHALL be a lowercase portable slug of at most 64 characters
- **AND** `full`, `core`, and `custom` SHALL be reserved
- **AND** every entry SHALL be a unique current catalog id — a workflow id or an expert id
- **AND** unsupported versions, unknown ids, duplicate ids, and unknown fields SHALL fail without modifying an existing definition

#### Scenario: Legacy delivery field is tolerated on read
- **WHEN** a saved profile definition from before the delivery retirement still contains a `delivery` field
- **THEN** the definition SHALL load successfully
- **AND** the `delivery` field SHALL be ignored

#### Scenario: Saved profile is a snapshot
- **WHEN** user applies a named profile and later edits current settings with `rasen profile`
- **THEN** the saved definition SHALL remain unchanged

#### Scenario: A saved snapshot lists exactly the chosen ids
- **WHEN** a profile snapshot is normalized and saved
- **THEN** it SHALL list exactly the workflow and expert ids the user selected
- **AND** it SHALL NOT be auto-expanded with closure-pulled experts

### Requirement: Profile import and export

The system SHALL exchange profile definitions as versioned YAML or JSON without embedding the local profile name.

#### Scenario: Import a profile
- **WHEN** user runs `rasen profile import <path>` for a `.yaml`, `.yml`, or `.json` file
- **THEN** the name SHALL be derived from the file basename
- **AND** the complete definition SHALL be validated before writing normalized YAML
- **AND** an existing name SHALL only be replaced with `--force`
- **AND** current global settings SHALL remain unchanged

#### Scenario: Export current settings
- **WHEN** user runs `rasen profile export <path>`
- **THEN** the current workflows SHALL be exported

#### Scenario: Export a selected profile
- **WHEN** user runs `rasen profile export <path> --profile <name>`
- **THEN** that built-in or saved profile SHALL be exported
- **AND** `.json` destinations SHALL use JSON while other destinations use YAML
