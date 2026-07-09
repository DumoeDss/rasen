## MODIFIED Requirements

### Requirement: Tool-Agnostic Updates
The update command SHALL refresh Rasen-managed files in a predictable manner while respecting each team's chosen tooling.

#### Scenario: Updating files
- **WHEN** updating files
- **THEN** completely replace `rasen/AGENTS.md` with the latest template
- **AND** create or refresh the root-level `AGENTS.md` stub using the managed marker block, even if the file was previously absent
- **AND** regenerate each existing AI tool's command and skill files in full from the current template on every update, rather than preserving any prior file content
- **AND** avoid creating new native-tool configuration files (slash commands, CLAUDE.md, etc.) unless they already exist

### Requirement: Slash Command Updates

The update command SHALL refresh existing slash command files for configured tools without creating new ones, and ensure the OpenCode archive command accepts change ID arguments.

#### Scenario: Updating slash commands for Antigravity
- **WHEN** `.agent/workflows/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** regenerate each file in full from the current template so the workflow copy matches other tools while preserving the existing single-field `description` frontmatter
- **AND** skip creating any missing workflow files during update, mirroring the behavior for Windsurf and other IDEs

#### Scenario: Updating slash commands for Claude Code
- **WHEN** `.claude/commands/rasen/` contains `proposal.md`, `apply.md`, and `archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for CodeBuddy Code
- **WHEN** `.codebuddy/commands/rasen/` contains `proposal.md`, `apply.md`, and `archive.md`
- **THEN** refresh each file using the shared CodeBuddy templates that include YAML frontmatter for the `description` and `argument-hint` fields
- **AND** use square bracket format for `argument-hint` parameters (e.g., `[change-id]`)
- **AND** regenerate the entire file from the current template on every update; there is no user-editable region preserved across updates

#### Scenario: Updating slash commands for Cline
- **WHEN** `.clinerules/workflows/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** refresh each file using shared templates
- **AND** include Cline-specific Markdown heading frontmatter
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Continue
- **WHEN** `.continue/prompts/` contains `rasen-proposal.prompt`, `rasen-apply.prompt`, and `rasen-archive.prompt`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Crush
- **WHEN** `.crush/commands/` contains `rasen/proposal.md`, `rasen/apply.md`, and `rasen/archive.md`
- **THEN** refresh each file using shared templates
- **AND** include Crush-specific frontmatter with Rasen category and tags
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Cursor
- **WHEN** `.cursor/commands/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Factory Droid
- **WHEN** `.factory/commands/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** refresh each file using the shared Factory templates that include YAML frontmatter for the `description` and `argument-hint` fields
- **AND** ensure the template body retains the `$ARGUMENTS` placeholder so user input keeps flowing into droid
- **AND** regenerate the entire file from the current template on every update; there is no unmanaged region preserved across updates
- **AND** skip creating missing files during update

#### Scenario: Updating slash commands for OpenCode
- **WHEN** `.opencode/command/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** refresh each file using shared templates
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** ensure the archive command includes `$ARGUMENTS` placeholder in frontmatter for accepting change ID arguments

#### Scenario: Updating slash commands for Windsurf
- **WHEN** `.windsurf/workflows/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** regenerate each file in full from the current template
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** skip creating missing files (the update command only refreshes what already exists)

#### Scenario: Updating slash commands for Kilo Code
- **WHEN** `.kilocode/workflows/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** regenerate each file in full from the current template
- **AND** ensure templates include instructions for the relevant workflow stage
- **AND** skip creating missing files (the update command only refreshes what already exists)

#### Scenario: Updating slash commands for Codex
- **GIVEN** the global Codex prompt directory contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **WHEN** a user runs `rasen update`
- **THEN** refresh each file using the shared slash-command templates (including placeholder guidance)
- **AND** regenerate the entire file from the current template on every update; there is no unmanaged region preserved across updates
- **AND** skip creation when a Codex prompt file is missing

#### Scenario: Updating slash commands for GitHub Copilot
- **WHEN** `.github/prompts/` contains `rasen-proposal.prompt.md`, `rasen-apply.prompt.md`, and `rasen-archive.prompt.md`
- **THEN** refresh each file using shared templates while preserving the YAML frontmatter
- **AND** regenerate the entire file from the current template on every update
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Updating slash commands for Gemini CLI
- **WHEN** `.gemini/commands/rasen/` contains `proposal.toml`, `apply.toml`, and `archive.toml`
- **THEN** refresh the body of each file using the shared proposal/apply/archive templates
- **AND** regenerate the `prompt = """` body content from the current template on every update, while keeping the surrounding TOML framing (`description`, `prompt`) structurally intact
- **AND** skip creating any missing `.toml` files during update; only pre-existing Gemini commands are refreshed

#### Scenario: Updating slash commands for iFlow CLI
- **WHEN** `.iflow/commands/` contains `rasen-proposal.md`, `rasen-apply.md`, and `rasen-archive.md`
- **THEN** refresh each file using shared templates
- **AND** preserve the YAML frontmatter with `name`, `id`, `category`, and `description` fields
- **AND** regenerate the entire file from the current template on every update; there is no unmanaged region preserved across updates
- **AND** ensure templates include instructions for the relevant workflow stage

#### Scenario: Missing slash command file
- **WHEN** a tool lacks a slash command file
- **THEN** do not create a new file during update
