# cli-update Delta

## MODIFIED Requirements

### Requirement: Update respects global profile config

The update command SHALL resolve the project's effective profile — the project's locked profile when `rasen/config.yaml` carries one, otherwise the global profile settings — and apply it to the project.

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

#### Scenario: Update in a locked project uses the locked profile

- **WHEN** user runs `rasen update` in a project whose config carries `profile: <name>`
- **AND** the user-wide profile differs from the locked profile
- **THEN** the system SHALL resolve workflows and experts from the locked profile
- **AND** the output SHALL note that the project is locked to `<name>`

#### Scenario: Update summary output

- **WHEN** update completes with changes
- **THEN** the system SHALL display a summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (leftover rasen command files cleaned up)
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"
