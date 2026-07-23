# Update Command Specification

## Purpose

As a developer using Rasen, I want to update the Rasen instructions in my project when new versions are released, so that I can benefit from improvements to AI agent instructions.
## Requirements
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

### Requirement: Archive Command Argument Support
The archive slash command template SHALL support optional change ID arguments for tools that support `$ARGUMENTS` placeholder.

#### Scenario: Archive command with change ID argument
- **WHEN** a user invokes `/rasen-archive-change <change-id>` with a change ID
- **THEN** the template SHALL instruct the AI to validate the provided change ID against `rasen list`
- **AND** use the provided change ID for archiving if valid
- **AND** fail fast if the provided change ID doesn't match an archivable change

#### Scenario: Archive command without argument (backward compatibility)
- **WHEN** a user invokes `/rasen-archive-change` without providing a change ID
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
- **THEN** the system SHALL delete the skill workflow files for deselected workflows
- **THEN** the system SHALL keep only workflows currently selected in profile

#### Scenario: Delivery change with extra workflows
- **WHEN** user runs `rasen update`
- **AND** project has extra workflows not in current profile
- **THEN** the system SHALL delete files for those extra workflows as part of the same deselection cleanup (the retired `delivery` axis no longer distinguishes which files this affects — skills are the only delivery surface)

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

### Requirement: Update tolerates retired workflow ids in stored profile config

When `rasen update` reads a stored `custom` profile selection from global config that lists a workflow id no longer present in the catalog (such as a retired `ff`), the command SHALL drop the unknown id with a warning and continue, rather than aborting. The remaining known workflows SHALL be updated normally.

#### Scenario: Update with a stale retired id in custom profile

- **WHEN** user runs `rasen update`
- **AND** the global config `custom` profile selection still lists a retired id such as `ff`
- **THEN** the system SHALL drop the unknown id and emit a warning naming it
- **AND** the system SHALL update the remaining selected workflows without error

#### Scenario: Retired ff install healed on update

- **WHEN** user runs `rasen update`
- **AND** a configured tool still has an installed `rasen-ff-change` skill directory or `ff` command file from a prior install
- **THEN** the retired skill directory and command file SHALL be removed
- **AND** this SHALL occur even when no other update is required

### Requirement: Refreshed skill files are re-stamped with the generating CLI version

Every skill file regenerated by `rasen update` SHALL record the CLI version that generated it, matching the same stamp `rasen init` writes, so version-mismatch detection reflects the state of skills as of the most recent `init` or `update`, whichever ran last.

#### Scenario: Update re-stamps refreshed skills

- **WHEN** `rasen update` regenerates a skill file
- **THEN** the regenerated file SHALL record the CLI's current version (read from the package's own version, never a hand-set or user-editable value)

#### Scenario: Skipped tools keep their prior stamp

- **WHEN** `rasen update` determines a tool is already up to date and skips regenerating its files
- **THEN** that tool's skill files SHALL retain whatever stamp they already carried, unchanged

