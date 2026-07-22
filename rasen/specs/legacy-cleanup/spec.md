# legacy-cleanup Specification

## Purpose
Define detection and cleanup behavior for legacy OpenSpec artifacts during initialization and update workflows.
## Requirements
### Requirement: Legacy artifact detection

The system SHALL detect legacy OpenSpec artifacts from previous init versions.

#### Scenario: Detecting legacy config files

- **WHEN** running `rasen init` on an existing project
- **THEN** the system SHALL check for config files with OpenSpec markers:
  - `CLAUDE.md`
  - `.cursorrules`
  - `.windsurfrules`
  - `.clinerules`
  - `.kilocode_rules`
  - `.github/copilot-instructions.md`
  - `.amazonq/instructions.md`
  - `CODEBUDDY.md`
  - `IFLOW.md`
  - And all other tool config files from the legacy ToolRegistry

#### Scenario: Detecting legacy slash command directories

- **WHEN** running `rasen init` on an existing project
- **THEN** the system SHALL check for old slash command directories:
  - `.claude/commands/openspec/`
  - `.cursor/commands/openspec/` (note: old format used `openspec-*.md` in commands root)
  - `.windsurf/workflows/openspec-*.md`
  - And equivalent directories for all tools in the legacy SlashCommandRegistry

#### Scenario: Detecting legacy OpenSpec structure files

- **WHEN** running `rasen init` on an existing project
- **THEN** the system SHALL check for:
  - `openspec/AGENTS.md`
  - `openspec/project.md` (for migration messaging only, not deleted)
  - Root `AGENTS.md` with OpenSpec markers

### Requirement: Legacy cleanup confirmation

The system SHALL prompt for confirmation before removing legacy artifacts.

#### Scenario: Prompting for cleanup when legacy detected

- **WHEN** legacy artifacts are detected
- **THEN** the system SHALL display what was found
- **AND** prompt: "Legacy files detected. Upgrade and clean up? [Y/n]"
- **AND** default to Yes if user presses Enter

#### Scenario: User confirms cleanup

- **WHEN** user responds Y or presses Enter
- **THEN** the system SHALL remove legacy artifacts
- **AND** proceed with skill-based setup

#### Scenario: User declines cleanup

- **WHEN** user responds N
- **THEN** the system SHALL abort initialization
- **AND** display message suggesting manual cleanup or using `--force` flag

#### Scenario: Non-interactive mode

- **WHEN** running with `--no-interactive` or in CI environment
- **AND** legacy artifacts are detected
- **THEN** the system SHALL abort with exit code 1
- **AND** display detected legacy artifacts
- **AND** suggest running interactively or using `--force` flag

### Requirement: Surgical removal of config file content

The system SHALL preserve user content when removing OpenSpec markers from config files.

#### Scenario: Config file with only OpenSpec content

- **WHEN** a config file contains only OpenSpec marker block (whitespace outside is acceptable)
- **THEN** the system SHALL remove the OpenSpec marker block
- **AND** preserve the file (even if empty or whitespace-only)
- **AND** NOT delete the file (config files belong to the user's project root)

#### Scenario: Config file with mixed content

- **WHEN** a config file contains content outside OpenSpec markers
- **THEN** the system SHALL remove only the `<!-- OPENSPEC:START -->` to `<!-- OPENSPEC:END -->` block
- **AND** preserve all content before and after the markers
- **AND** clean up any resulting double blank lines

#### Scenario: Root AGENTS.md with mixed content

- **WHEN** root `AGENTS.md` contains OpenSpec markers AND other content
- **THEN** the system SHALL remove only the OpenSpec marker block
- **AND** preserve the rest of the file

### Requirement: Legacy directory removal

The system SHALL remove legacy slash command directories entirely.

#### Scenario: Removing old slash command directory

- **WHEN** a legacy slash command directory exists (e.g., `.claude/commands/openspec/`)
- **THEN** the system SHALL delete the entire directory and its contents
- **AND** NOT delete the parent directory (e.g., `.claude/commands/` remains)

#### Scenario: Removing legacy AGENTS.md

- **WHEN** `openspec/AGENTS.md` exists
- **THEN** the system SHALL delete the file
- **AND** NOT delete the `openspec/` directory itself

### Requirement: project.md migration hint

The system SHALL preserve project.md and display a migration hint instead of deleting it.

#### Scenario: project.md exists during upgrade

- **WHEN** `openspec/project.md` exists during legacy cleanup
- **THEN** the system SHALL NOT delete the file
- **AND** the system SHALL display a migration hint in the output:
  ```
  Manual migration needed:
    → openspec/project.md still exists
      Move useful content to config.yaml's "context:" field, then delete
  ```

#### Scenario: project.md migration rationale

- **GIVEN** project.md may contain user-written project documentation
- **AND** config.yaml's context field serves the same purpose (auto-injected into artifacts)
- **WHEN** displaying the migration hint
- **THEN** users can migrate manually or use `/rasen:explore` to get AI assistance

### Requirement: Cleanup reporting

The system SHALL report what was cleaned up.

#### Scenario: Displaying cleanup summary

- **WHEN** legacy cleanup completes
- **THEN** the system SHALL display a summary section:
  ```
  Cleaned up legacy files:
    ✓ Removed OpenSpec markers from CLAUDE.md
    ✓ Removed .claude/commands/openspec/ (replaced by /rasen:*)
    ✓ Removed openspec/AGENTS.md (no longer needed)
  ```
- **AND IF** `openspec/project.md` exists
- **THEN** the system SHALL display a separate migration section:
  ```
  Manual migration needed:
    → openspec/project.md still exists
      Move useful content to config.yaml's "context:" field, then delete
  ```

#### Scenario: No legacy detected

- **WHEN** no legacy artifacts are found
- **THEN** the system SHALL NOT display the cleanup section
- **AND** proceed directly with skill setup

### Requirement: Retired expert skill directories are pruned on init and update

`rasen init` and `rasen update` SHALL remove installed skill directories left orphaned by the expert-skill rebrand — those whose directory name begins with the retired `openspec-gstack-` prefix — from each configured AI tool's skills directory (e.g. `.claude/skills/`). The prune SHALL be scoped to exactly the `openspec-gstack-` prefix so it cannot remove current `openspec-*` skills or any unrelated directory, and SHALL be idempotent (a no-op when no such directory exists).

#### Scenario: Renamed-skill orphan removed on update

- **WHEN** `rasen update` runs in a project whose skills directory still contains an `openspec-gstack-review/` directory from a prior install
- **THEN** the `openspec-gstack-review/` directory SHALL be removed
- **AND** the current `openspec-review/` skill directory SHALL be written and left intact

#### Scenario: Prune is scoped to the retired prefix

- **WHEN** the prune runs
- **THEN** it SHALL NOT remove any directory whose name begins with `openspec-` but not `openspec-gstack-`
- **AND** it SHALL NOT remove directories unrelated to OpenSpec skills

#### Scenario: No orphans is a no-op

- **WHEN** `rasen init` or `rasen update` runs and no `openspec-gstack-*` directory exists
- **THEN** the prune SHALL complete without error and remove nothing

### Requirement: Retired built-in workflow artifacts are pruned on init and update

`rasen init` and `rasen update` SHALL remove installed artifacts left orphaned by a retired built-in workflow — specifically the retired `rasen-ff-change` skill directory and the retired `ff` command file — from each configured AI tool. Because a retired workflow is no longer present in the built-in registry, the registry-derived deselection cleanup cannot reach it; this prune therefore keys on the retired identifiers directly. The prune SHALL be scoped to exactly those retired identifiers so it cannot remove any current skill directory or command file, SHALL be idempotent (a no-op when no such artifact exists), and SHALL run before the "already up to date" short-circuit so an install is healed even when nothing else needs updating.

#### Scenario: Retired ff skill directory removed on update

- **WHEN** `rasen update` runs in a project whose skills directory still contains a `rasen-ff-change/` directory from a prior install
- **THEN** the `rasen-ff-change/` directory SHALL be removed
- **AND** current skill directories SHALL be left intact

#### Scenario: Retired ff command file removed on update

- **WHEN** `rasen update` runs in a project that still has an installed `ff` command file for a configured tool
- **THEN** the `ff` command file SHALL be removed
- **AND** current command files SHALL be left intact

#### Scenario: Prune is scoped to the retired identifiers

- **WHEN** the retired-artifact prune runs
- **THEN** it SHALL remove only the `rasen-ff-change` skill directory and the `ff` command file
- **AND** it SHALL NOT remove any current workflow's skill directory or command file

#### Scenario: No retired artifacts is a no-op

- **WHEN** `rasen init` or `rasen update` runs and no retired `ff` artifact exists
- **THEN** the prune SHALL complete without error and remove nothing

### Requirement: Retired command files are pruned on init and update

The command delivery surface is retired: Rasen no longer generates any command files. `rasen init` and `rasen update` SHALL remove every previously installed built-in rasen command file from each configured AI tool, unconditionally (no delivery setting gates the removal). Because the live command adapter registry and the workflow definitions' `command` field no longer exist, this prune SHALL key on a static, frozen list of the built-in command file identifiers and each tool's command file-path rules — modeled on the existing retired-identifier prunes — rather than any live registry or workflow definition. The prune SHALL cover the current file path, the legacy `-command`-suffixed variant, and the legacy `opsx`-prefixed variants (both the `commands/opsx/<id>.md` subdirectory form and the `opsx-<id>.md` hyphen form). The prune SHALL be scoped to exactly these known rasen command identifiers so it cannot remove a user-authored file, SHALL be idempotent (a no-op when no such file exists), and SHALL run so an install is healed even when nothing else needs updating.

#### Scenario: Existing command files removed on update

- **WHEN** `rasen update` runs in a project that still has installed rasen command files for a configured tool (for example `.claude/commands/rasen/apply.md`, `.cursor/commands/rasen-apply.md`)
- **THEN** every such built-in rasen command file SHALL be removed
- **AND** the count of removed command files SHALL be reported with a message stating commands have been consolidated into skills
- **AND** the tool's skill files SHALL remain installed

#### Scenario: Fresh init leaves no command files

- **WHEN** `rasen init` completes for a configured tool
- **THEN** only skill files SHALL be generated
- **AND** no rasen command file SHALL exist in the tool's command directory
- **AND** any pre-existing rasen command file in the target directory SHALL have been removed

#### Scenario: Legacy path variants are removed

- **WHEN** the prune runs against a tool that has a legacy `-command`-suffixed file or an `opsx`-prefixed command file (`commands/opsx/<id>.md` or `opsx-<id>.md`)
- **THEN** each legacy variant SHALL be removed
- **AND** the prune SHALL resolve these paths from the frozen static command-path knowledge, not from a live adapter registry

#### Scenario: User-authored files are never touched

- **WHEN** the prune runs in a project whose command directory also contains a non-rasen, user-authored command file
- **THEN** only files matching the known built-in rasen command identifiers SHALL be removed
- **AND** the user-authored file SHALL remain untouched

#### Scenario: No command files is a no-op

- **WHEN** `rasen init` or `rasen update` runs and no rasen command files exist for any configured tool
- **THEN** the prune SHALL complete without error and remove nothing

