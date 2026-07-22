## MODIFIED Requirements

### Requirement: Update Behavior
The update command SHALL update Rasen instruction files to the latest templates in a team-friendly manner.

#### Scenario: Running update command
- **WHEN** a user runs `rasen update`
- **THEN** regenerate skill files for each tool being updated, using the latest templates
- **AND** remove any previously installed rasen command files for each tool (commands have been consolidated into skills)

### Requirement: File Handling
The update command SHALL handle file updates in a predictable and safe manner.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** completely replace each skill file's content with the latest template
- **AND** remove any pre-existing rasen command file rather than regenerating it

### Requirement: Tool-Agnostic Updates
The update command SHALL refresh Rasen-managed files in a predictable manner while respecting each team's chosen tooling.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** only operate on tools that already have at least one Rasen-generated file; update never onboards a new tool
- **AND** regenerate each existing AI tool's skill files in full from the current template on every update, rather than preserving any prior file content
- **AND** generate skill files only; command files are never generated and any existing rasen command file is removed

### Requirement: Core Files Always Updated
The update command SHALL always update the core Rasen files and display an ASCII-safe success message.

#### Scenario: Successful update
- **WHEN** the update completes successfully
- **THEN** regenerate skill files for each tool that was updated

## REMOVED Requirements

### Requirement: Slash Command Updates
**Reason**: The command delivery surface is retired. Rasen no longer refreshes or creates per-tool slash command files (Antigravity, Claude Code, CodeBuddy, Cline, Continue, Crush, Cursor, Factory Droid, OpenCode, Windsurf, Kilo Code, Codex, GitHub Copilot, and the rest); skills are the single delivery format and already produce the equivalent slash commands.
**Migration**: On the next `rasen update`, any previously generated rasen command files are removed rather than refreshed (see the `legacy-cleanup` capability, "Retired command files are pruned on init and update"). Existing skills continue to work; users lose no invocation path on natively skill-supporting tools.
