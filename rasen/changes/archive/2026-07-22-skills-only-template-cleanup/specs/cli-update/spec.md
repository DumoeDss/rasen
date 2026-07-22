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

#### Scenario: Profile or delivery drift with current templates
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

#### Scenario: Migration with partial workflows (user manually removed some)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has fewer than the original 10 workflows installed
- **THEN** the system SHALL migrate with only the workflows that are actually present
- **THEN** the migrated `workflows` array SHALL reflect the user's current state, not the original set

#### Scenario: Migration with multiple tools having different workflow sets
- **WHEN** user runs `rasen update`
- **AND** project has multiple tools configured (e.g., Claude Code, Cursor)
- **AND** different tools have different workflows installed
- **THEN** the system SHALL take the union of all detected workflows across all tools
- **THEN** the migrated `workflows` array SHALL include any workflow that exists in at least one tool

#### Scenario: No migration needed (profile already set)
- **WHEN** user runs `rasen update`
- **AND** global config already contains a `profile` field
- **THEN** the system SHALL NOT perform migration
- **THEN** the system SHALL proceed with normal update logic using existing config

#### Scenario: No migration needed (no existing workflows)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has no existing workflow files
- **THEN** the system SHALL NOT perform migration
- **THEN** the system SHALL use `core` profile defaults

#### Scenario: Migration is idempotent
- **WHEN** user runs `rasen update` multiple times
- **THEN** migration SHALL only occur on the first run (when `profile` field is absent)
- **THEN** subsequent runs SHALL use the existing global config without re-scanning

#### Scenario: Non-interactive migration
- **WHEN** user runs `rasen update` non-interactively (e.g., in CI)
- **AND** migration is triggered
- **THEN** the system SHALL perform migration without prompting
- **THEN** the system SHALL display the migration summary to stdout

### Requirement: Extra workflows synchronized to active profile
The update command SHALL remove workflow files that are no longer selected in the current profile.

#### Scenario: Deselected workflows from previous profile
- **WHEN** user runs `rasen update`
- **AND** project has workflows not in current profile (e.g., user switched from custom to core or deselected workflows via `rasen config profile`)
- **THEN** the system SHALL delete the skill workflow files for deselected workflows
- **THEN** the system SHALL keep only workflows currently selected in profile

#### Scenario: Delivery change with extra workflows
- **WHEN** user runs `rasen update`
- **AND** project has extra workflows not in current profile
- **THEN** the system SHALL delete files for those extra workflows as part of the same deselection cleanup (the retired `delivery` axis no longer distinguishes which files this affects — skills are the only delivery surface)
