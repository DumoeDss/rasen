## MODIFIED Requirements

### Requirement: Update Behavior
The update command SHALL update Rasen instruction files to the latest templates in a team-friendly manner.

#### Scenario: Running update command
- **WHEN** a user runs `rasen update`
- **THEN** regenerate skill files for each tool being updated, using the latest templates
- **AND** regenerate command files too when the delivery setting includes commands

### Requirement: File Handling
The update command SHALL handle file updates in a predictable and safe manner.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** completely replace each skill file's content with the latest template
- **AND** completely replace each command file's content with the latest template too, when delivery includes commands

### Requirement: Tool-Agnostic Updates
The update command SHALL refresh Rasen-managed files in a predictable manner while respecting each team's chosen tooling.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** only operate on tools that already have at least one Rasen-generated file; update never onboards a new tool
- **AND** regenerate each existing AI tool's command and skill files in full from the current template on every update, rather than preserving any prior file content
- **AND** generate command files only when delivery includes commands; skill files are generated regardless of delivery

### Requirement: Core Files Always Updated
The update command SHALL always update the core Rasen files and display an ASCII-safe success message.

#### Scenario: Successful update
- **WHEN** the update completes successfully
- **THEN** regenerate skill files for each tool that was updated, regardless of delivery setting
