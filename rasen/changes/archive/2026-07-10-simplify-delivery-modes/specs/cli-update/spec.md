## MODIFIED Requirements

### Requirement: Update respects delivery setting
The update command SHALL add or remove files based on the delivery setting. Skills are always generated for selected workflows; only command files are added or removed by a delivery change.

#### Scenario: Delivery changed to skills-only
- **WHEN** user runs `rasen update`
- **AND** global config specifies `delivery: skills`
- **AND** project has command files installed
- **THEN** the system SHALL delete command files for workflows in the profile
- **THEN** the system SHALL generate/update skill files only
- **THEN** the system SHALL display: "Removed: <count> command files (delivery: skills)"

#### Scenario: Delivery is both
- **WHEN** user runs `rasen update`
- **AND** global config specifies `delivery: both`
- **THEN** the system SHALL generate/update both skill and command files

#### Scenario: Update with a legacy delivery value heals the install
- **WHEN** user runs `rasen update`
- **AND** global config still contains a retired delivery value (`commands`, `commands-first`, or `skills-first`)
- **THEN** the system SHALL apply the consolidated delivery (`both` for `commands`/`commands-first`, `skills` for `skills-first`) with the one-time consolidation notice
- **AND** skill files for the selected workflows SHALL be present after the run, including any skill directories a previous skills-deleting mode had removed

### Requirement: Update detects configured tools from skills or commands
The update command SHALL treat a tool as configured if it has either generated skill files or generated command files.

#### Scenario: Commands-only installation
- **WHEN** user runs `rasen update`
- **AND** a tool has generated Rasen command files
- **AND** that tool has no Rasen skill files (e.g., installed under a retired commands-only mode)
- **THEN** the tool SHALL still be treated as configured
- **THEN** the system SHALL apply profile and delivery sync for that tool, restoring the missing skill files
