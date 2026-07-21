# Update Command Specification

## Purpose

As a developer using Rasen, I want to update the Rasen instructions in my project when new versions are released, so that I can benefit from improvements to AI agent instructions.
## Requirements
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

### Requirement: Archive Command Argument Support
The archive slash command template SHALL support optional change ID arguments for tools that support `$ARGUMENTS` placeholder.

#### Scenario: Archive command with change ID argument
- **WHEN** a user invokes `/rasen:archive <change-id>` with a change ID
- **THEN** the template SHALL instruct the AI to validate the provided change ID against `rasen list`
- **AND** use the provided change ID for archiving if valid
- **AND** fail fast if the provided change ID doesn't match an archivable change

#### Scenario: Archive command without argument (backward compatibility)
- **WHEN** a user invokes `/rasen:archive` without providing a change ID
- **THEN** the template SHALL instruct the AI to identify the change ID from context or by running `rasen list`
- **AND** proceed with the existing behavior (maintaining backward compatibility)

#### Scenario: OpenCode archive template generation
- **WHEN** generating the OpenCode archive slash command file
- **THEN** include the `$ARGUMENTS` placeholder in the frontmatter
- **AND** wrap it in a clear structure like `<ChangeId>\n  $ARGUMENTS\n</ChangeId>` to indicate the expected argument
- **AND** include validation steps in the template body to check if the change ID is valid

### Requirement: Update respects global profile config
The update command SHALL read global config and apply profile settings to the project.

#### Scenario: Update adds missing workflows from config
- **WHEN** user runs `rasen update`
- **AND** global config specifies workflows not currently installed in the project
- **THEN** the system SHALL generate skill/command files for missing workflows
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
- **AND** delivery setting matches installed files
- **THEN** the system SHALL display: "Already up to date."

#### Scenario: Profile or delivery drift with current templates
- **WHEN** user runs `rasen update`
- **AND** workflow templates are current for the installed skills
- **AND** project files do not match current profile and/or delivery config
- **THEN** the system SHALL treat this as an update-required state (not "Already up to date.")
- **THEN** the system SHALL add/remove files to match current profile and delivery settings

#### Scenario: Update summary output
- **WHEN** update completes with changes
- **THEN** the system SHALL display a summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (if delivery changed)
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"

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

### Requirement: One-time migration for existing users
The update command SHALL detect existing users (no `profile` in global config + existing workflows) and migrate them to `custom` profile before applying updates.

#### Scenario: First update after upgrade (existing user)
- **WHEN** user runs `rasen update`
- **AND** global config does not contain a `profile` field
- **AND** project has existing workflow files installed
- **THEN** the system SHALL scan installed workflows across all tool directories in the project
- **THEN** the system SHALL only match workflow names present in `ALL_WORKFLOWS` constant (ignoring user-created custom skills)
- **THEN** the system SHALL take the union of detected workflow names across all tools
- **THEN** the system SHALL write to global config: `profile: "custom"`, `delivery: "both"`, `workflows: [<detected>]`
- **THEN** the system SHALL display: "Migrated: custom profile with <count> workflows (<workflow-names>)"
- **THEN** the system SHALL display: "New in this version: /rasen:propose (combines new + ff). Try 'rasen config profile core' for the streamlined 4-workflow experience."
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

### Requirement: Update detects new tool directories
The update command SHALL notify the user if new **adapted** AI tool directories are detected that aren't currently configured. It SHALL NOT nudge the user to add an unadapted tool, since the installer will refuse it.

#### Scenario: New adapted tool directory detected
- **WHEN** user runs `rasen update`
- **AND** a new adapted tool directory is detected (e.g., `.codex/` exists but Codex is not configured)
- **THEN** the system SHALL display: "Detected new tool: Codex. Run 'rasen init' to add it."
- **THEN** the system SHALL NOT automatically add the new tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: New unadapted tool directory is not nudged
- **WHEN** user runs `rasen update`
- **AND** a new tool directory for an unadapted tool is detected (e.g., `.windsurf/` exists but Windsurf is not configured)
- **THEN** the system SHALL NOT display a "Detected new tool" message for that tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: Multiple new adapted tool directories detected
- **WHEN** user runs `rasen update`
- **AND** multiple new adapted tool directories are detected
- **THEN** the system SHALL display one consolidated message listing the detected adapted tools, for example: "Detected new tools: Claude Code, Codex. Run 'rasen init' to add them."
- **THEN** the system SHALL NOT automatically add any new tools
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: No new adapted tool directories
- **WHEN** user runs `rasen update`
- **AND** no new adapted tool directories are detected
- **THEN** the system SHALL NOT display any tool detection message

### Requirement: Update requires an OpenSpec project
The update command SHALL only run inside an initialized rasen project.

#### Scenario: Update outside a project
- **WHEN** user runs `rasen update`
- **AND** no `rasen/` directory exists in the current working directory
- **AND** no legacy `openspec/` directory exists either
- **THEN** the system SHALL display: "No rasen project found. Run 'rasen init' to set up."
- **THEN** the system SHALL exit with code 1

#### Scenario: Update in a legacy-only project
- **WHEN** user runs `rasen update`
- **AND** no `rasen/` directory exists but a legacy `openspec/` directory does
- **THEN** the system SHALL point the user to `rasen migrate` (copy-only) or `rasen init`
- **THEN** the system SHALL exit with code 1 without modifying anything

### Requirement: Update refreshes only rasen-namespace artifacts

The update command SHALL refresh command files under rasen-namespace paths (e.g., `.claude/commands/rasen/`, `rasen-<id>.md` variants) and skill directories under `rasen-*` names. Legacy-namespace files (`opsx` command paths, `openspec-*` skill directories) SHALL NOT be refreshed, rewritten, or deleted by update; when detected, update SHALL print a one-time notice that they may belong to upstream OpenSpec or an older rasen install.

#### Scenario: Rasen artifacts refreshed

- **WHEN** `rasen update` runs in a project with `.claude/commands/rasen/` command files and `rasen-*` skill directories
- **THEN** those files are refreshed from the current templates

#### Scenario: Legacy artifacts left untouched

- **WHEN** `rasen update` runs in a project that also contains `.claude/commands/opsx/` files or `openspec-*` skill directories
- **THEN** those files and directories are not modified or deleted
- **AND** the output includes a notice explaining they may belong to upstream OpenSpec and how to remove them manually if they came from an older rasen install

### Requirement: Extra workflows synchronized to active profile
The update command SHALL remove workflow files that are no longer selected in the current profile.

#### Scenario: Deselected workflows from previous profile
- **WHEN** user runs `rasen update`
- **AND** project has workflows not in current profile (e.g., user switched from custom to core or deselected workflows via `rasen config profile`)
- **THEN** the system SHALL delete skill and command workflow files for deselected workflows (respecting active delivery mode)
- **THEN** the system SHALL keep only workflows currently selected in profile

#### Scenario: Delivery change with extra workflows
- **WHEN** user runs `rasen update`
- **AND** delivery changed (e.g., `both` → `skills`)
- **AND** project has extra workflows not in current profile
- **THEN** the system SHALL delete files for extra workflows that match the removed delivery type
- **THEN** for example: if switching to `skills`, all command files are deleted (including for extra workflows)

### Requirement: Update installs and prunes experts by profile
The update command SHALL bring a project's installed experts into line with the resolved profile plus dependency closure: it SHALL install experts named by the profile or required by a selected workflow, and it SHALL remove an installed built-in expert only when that expert is neither in the resolved profile's expert set nor required by any selected workflow.

#### Scenario: Missing profile expert is installed
- **WHEN** user runs `rasen update`
- **AND** the resolved profile names an expert that is not installed in the project
- **THEN** the system SHALL install that expert's skill files

#### Scenario: Unreferenced deselected expert is removed
- **WHEN** user runs `rasen update`
- **AND** an installed built-in expert is neither in the resolved profile's expert set nor required by any selected workflow
- **AND** the install has explicit expert selection
- **THEN** the system SHALL remove that expert's skill directory

#### Scenario: Referenced expert is never removed
- **WHEN** user runs `rasen update`
- **AND** an installed expert is required by a selected workflow's `requires.skills`
- **THEN** the system SHALL retain that expert even when the active profile does not name it

### Requirement: One-time non-regressive expert migration
When an install predates expert selection, the update command SHALL preserve every installed built-in expert and SHALL explain, once, that experts are now selectable. It SHALL NOT remove any expert until the user has explicitly re-selected experts.

#### Scenario: Legacy install keeps all experts with a one-time notice
- **WHEN** user runs `rasen update` on a project whose config has no explicit expert selection
- **THEN** every built-in expert SHALL remain installed regardless of the active profile
- **AND** the system SHALL display a one-time notice that experts are now selectable via `rasen profile`
- **AND** no expert skill directory SHALL be removed by that run

#### Scenario: Notice does not repeat after explicit selection
- **WHEN** the user has re-selected experts through the profile picker
- **AND** user runs `rasen update`
- **THEN** the profile-default plus closure expert set SHALL govern
- **AND** the one-time experts-now-selectable notice SHALL NOT be shown again

