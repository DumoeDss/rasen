## MODIFIED Requirements

### Requirement: Slash Command Generation

The init command SHALL generate commands based on profile AND delivery settings, and SHALL generate command files only for selected tools that have a registered command adapter; adapterless tools remain valid for skill generation. Skill generation is unconditional: every delivery setting installs skills.

#### Scenario: Skills-only delivery
- **WHEN** delivery is set to `skills`
- **THEN** the system SHALL NOT generate any command files

#### Scenario: Both delivery
- **WHEN** delivery is set to `both`
- **THEN** the system SHALL generate both skill and command files for profile workflows

#### Scenario: Skills generated under every delivery setting
- **WHEN** init runs with any delivery setting (`both` or `skills`, including a legacy value mapped to one of them)
- **THEN** the system SHALL generate skill files for the profile workflows

#### Scenario: Propose workflow included in command templates
- **WHEN** generating commands
- **THEN** the system SHALL include the `propose` workflow as an available command template

#### Scenario: Selected tool has no command adapter
- **GIVEN** a selected tool has `skillsDir` configured but no registered command adapter
- **WHEN** initialization includes command generation
- **THEN** skill generation for that tool SHALL still remain valid
- **AND** command-file generation SHALL be skipped for that tool
- **AND** the command output SHALL include `Commands skipped for: <tool-id> (no adapter)`

#### Scenario: Kimi CLI skips command-file generation
- **WHEN** the user selects Kimi CLI during initialization
- **THEN** Rasen SHALL treat it as a supported tool with `skillsDir: '.kimi'`
- **AND** command-file generation SHALL be skipped because no Kimi adapter is registered

### Requirement: Init preserves existing workflows
The init command SHALL NOT remove workflows that are already installed, but SHALL respect delivery setting. Delivery-driven cleanup applies to command files only; skill directories are never removed because of a delivery setting.

#### Scenario: Existing custom installation
- **WHEN** user has custom profile with extra workflows and runs `rasen init` with core profile
- **THEN** the system SHALL NOT remove extra workflows
- **THEN** the system SHALL regenerate core workflow files, overwriting existing content with latest templates

#### Scenario: Init with different delivery setting
- **WHEN** user runs `rasen init` on existing project
- **AND** delivery setting differs from what's installed (e.g., was `both`, now `skills`)
- **THEN** the system SHALL generate files matching current delivery setting
- **THEN** the system SHALL delete files that don't match delivery (e.g., commands removed if `skills`)
- **THEN** this applies to all workflows, including extras not in profile

#### Scenario: Re-init applies delivery cleanup even when templates are current
- **WHEN** user runs `rasen init` on an existing project
- **AND** existing files are already on current template versions
- **AND** delivery changed since the previous init
- **THEN** the system SHALL still remove files that no longer match delivery
- **THEN** for example, switching from `both` to `skills` SHALL remove generated command files

#### Scenario: Delivery never removes skill directories
- **WHEN** user runs `rasen init` on an existing project with skill directories installed
- **THEN** no delivery setting SHALL cause those skill directories to be removed
- **AND** skill directories are removed only through workflow deselection, never through delivery
