## MODIFIED Requirements

### Requirement: Update respects global profile config
The update command SHALL read global config and apply profile settings to the project.

#### Scenario: Update adds missing workflows from config
- **WHEN** user runs `rasen update`
- **AND** global config specifies workflows not currently installed in the project
- **THEN** the system SHALL generate skill files for missing workflows
- **THEN** the system SHALL display: "Added: <workflow-names>"

#### Scenario: Update refreshes existing workflows
- **WHEN** user runs `rasen update`
- **AND** workflows are already installed in the project
- **THEN** the system SHALL refresh those workflow files with latest templates
- **THEN** the system SHALL display: "Updated: <workflow-names>"

#### Scenario: Update with no changes needed
- **WHEN** user runs `rasen update`
- **AND** installed workflows match global config
- **AND** all templates are current
- **AND** no leftover rasen command files remain
- **THEN** the system SHALL display: "Already up to date."

#### Scenario: Profile drift with current templates
- **WHEN** user runs `rasen update`
- **AND** workflow templates are current for the installed skills
- **AND** project files do not match the current profile selection
- **THEN** the system SHALL treat this as an update-required state (not "Already up to date.")
- **THEN** the system SHALL add/remove files to match the current profile selection

#### Scenario: Update summary output
- **WHEN** update completes with changes
- **THEN** the system SHALL display a summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (leftover rasen command files cleaned up)
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"

### Requirement: Update detects configured tools from skills or commands
The update command SHALL treat a tool as configured if it has either generated skill files or leftover generated command files, so a legacy command-only install is healed into skills.

#### Scenario: Commands-only installation
- **WHEN** user runs `rasen update`
- **AND** a tool has leftover Rasen command files
- **AND** that tool has no Rasen skill files (e.g., installed under a retired commands-only mode)
- **THEN** the tool SHALL still be treated as configured
- **THEN** the system SHALL install the skill files for the resolved profile for that tool and remove the leftover command files

### Requirement: One-time migration for existing users
The update command SHALL detect existing users (no `profile` in global config + existing workflows) and migrate them to `custom` profile before applying updates.

#### Scenario: First update after upgrade (existing user)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has existing workflow files installed
- **THEN** the system SHALL scan installed workflows across all tool directories in the project
- **THEN** the system SHALL only match workflow names present in `ALL_WORKFLOWS` constant (ignoring user-created custom skills)
- **THEN** the system SHALL take the union of detected workflow names across all tools
- **THEN** the system SHALL write to global config: `profile: "custom"`, `workflows: [<detected>]` (no `delivery` key — the setting is retired)
- **THEN** the system SHALL display: "Migrated: custom profile with <count> workflows (<workflow-names>)"
- **THEN** the system SHALL display: "New in this version: the rasen-propose skill (combines new + ff). Try 'rasen config profile core' for the streamlined 4-workflow experience."
- **THEN** the system SHALL proceed with normal update logic (using the migrated config)
- **THEN** the result SHALL be template refresh only (no workflows added or removed)

### Requirement: Extra workflows synchronized to active profile
The update command SHALL remove workflow files that are no longer selected in the current profile.

#### Scenario: Deselected workflows from previous profile
- **WHEN** user runs `rasen update`
- **AND** project has workflows not in current profile (e.g., user switched from custom to core or deselected workflows via `rasen config profile`)
- **THEN** the system SHALL delete the skill workflow files for deselected workflows
- **THEN** the system SHALL keep only workflows currently selected in profile
