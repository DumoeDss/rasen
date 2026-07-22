## MODIFIED Requirements

### Requirement: Success Output

The command SHALL provide clear, actionable next steps upon successful initialization.

#### Scenario: Displaying success message

- **WHEN** initialization completes successfully
- **THEN** display categorized summary:
  - "Created: <tools>" for newly configured tools
  - "Refreshed: <tools>" for already-configured tools that were updated
  - Count of skills generated
- **AND** display getting started section with:
  - `/rasen:new` - Start a new change
  - `/rasen:continue` - Create the next artifact
  - `/rasen:apply` - Implement tasks
- **AND** display links to documentation and feedback

#### Scenario: Displaying restart instruction

- **WHEN** initialization completes successfully and tools were created or refreshed
- **THEN** display instruction to restart IDE for slash commands to take effect

### Requirement: Non-Interactive Mode

The command SHALL support non-interactive operation through command-line options. Tool selection SHALL be restricted to adapted agents: `--tools all` SHALL expand to the adapted agents only, and an explicit request for a known-but-unadapted agent SHALL be refused with a message distinct from the unrecognized-token error.

#### Scenario: Select all tools non-interactively

- **WHEN** run with `--tools all`
- **THEN** automatically select every adapted AI tool (`claude`, `codex`) without prompting
- **AND** NOT select any unadapted tool
- **AND** proceed with skill generation

#### Scenario: Select specific tools non-interactively

- **WHEN** run with `--tools claude,codex`
- **THEN** parse the comma-separated tool IDs
- **AND** generate skills for the specified adapted tools only

#### Scenario: Skip tool configuration non-interactively

- **WHEN** run with `--tools none`
- **THEN** create only the rasen directory structure
- **AND** skip skill generation
- **AND** create config only when config creation conditions are met

#### Scenario: Known but unadapted tool specification

- **WHEN** run with `--tools cursor` (or any tool that exists in the registry with a skills directory but is not adapted)
- **THEN** fail with exit code 1
- **AND** display a message stating the tool is recognized but not yet adapted in Rasen
- **AND** name the currently adapted tools (`claude`, `codex`)

#### Scenario: Invalid tool specification

- **WHEN** run with `--tools invalid-tool` (a token that matches no registry entry)
- **THEN** fail with exit code 1
- **AND** display an error listing available values (`all`, `none`, and the adapted tool IDs)

#### Scenario: Reserved value combined with tool IDs

- **WHEN** run with `--tools all,claude` or `--tools none,codex`
- **THEN** fail with exit code 1
- **AND** display an error explaining reserved values cannot be combined with specific tool IDs

#### Scenario: Missing --tools in non-interactive mode

- **GIVEN** prompts are unavailable in non-interactive execution
- **WHEN** user runs `rasen init` without `--tools`
- **AND** no adapted tool directories are detected
- **THEN** fail with exit code 1
- **AND** instruct to use `--tools all`, `--tools none`, or explicit tool IDs

### Requirement: Init respects global config
The init command SHALL read and apply settings from global config.

#### Scenario: User has profile preference
- **WHEN** global config contains `profile: "custom"` with custom workflows
- **THEN** init SHALL install custom profile workflows

#### Scenario: Override via flags
- **WHEN** user runs `rasen init --profile core`
- **THEN** the system SHALL use the flag value instead of config value
- **THEN** the system SHALL NOT update the global config

#### Scenario: Invalid profile override
- **WHEN** user runs `rasen init --profile <invalid>`
- **AND** `<invalid>` is not one of `core` or `custom`
- **THEN** the system SHALL exit with code 1
- **THEN** the system SHALL display a validation error listing allowed profile values

### Requirement: Init preserves existing workflows
The init command SHALL NOT remove workflows that are already installed. Skills are the only delivery format; no delivery setting influences installation. Init SHALL always remove any previously installed rasen command files (skill directories are removed only through workflow deselection).

#### Scenario: Existing custom installation
- **WHEN** user has custom profile with extra workflows and runs `rasen init` with core profile
- **THEN** the system SHALL NOT remove extra workflows
- **THEN** the system SHALL regenerate core workflow skill files, overwriting existing content with latest templates

#### Scenario: Init removes any existing command files
- **WHEN** user runs `rasen init` on an existing project that has rasen command files installed
- **THEN** the system SHALL generate skill files only
- **THEN** the system SHALL delete every previously installed rasen command file
- **THEN** this applies to all workflows, including extras not in profile

#### Scenario: Re-init removes command files even when templates are current
- **WHEN** user runs `rasen init` on an existing project
- **AND** existing skill files are already on current template versions
- **AND** rasen command files remain from a prior install
- **THEN** the system SHALL still remove those command files

#### Scenario: Init never removes skill directories for delivery reasons
- **WHEN** user runs `rasen init` on an existing project with skill directories installed
- **THEN** no delivery reason SHALL cause those skill directories to be removed
- **AND** skill directories are removed only through workflow deselection

### Requirement: Init configures Hermes via its global skills home

When Hermes is among the selected tools, the init command SHALL install Rasen's workflow skills to the resolved Hermes skills home rather than a project-local directory. No command files are generated for any tool, including Hermes (Hermes's skills surface as slash commands).

#### Scenario: Init installs Hermes skills to the global home

- **WHEN** user runs `rasen init --tools hermes`
- **THEN** the system SHALL write Rasen skill files under the resolved Hermes skills home (`<HERMES_HOME or ~/.hermes>/skills/rasen-<workflow>/SKILL.md`)
- **AND** SHALL NOT create a project-local `.hermes/skills/` tree

#### Scenario: Init generates no command files for Hermes

- **WHEN** user runs `rasen init --tools hermes`
- **THEN** skill installation for Hermes SHALL occur
- **AND** no command files SHALL be generated for Hermes

## REMOVED Requirements

### Requirement: Slash Command Generation
**Reason**: The command delivery surface is retired. `rasen init` no longer generates command files for any tool or gates generation on a delivery setting; skills are the single delivery format and produce the equivalent slash commands.
**Migration**: Fresh `rasen init` produces only skills; any pre-existing rasen command files in the target directory are removed (see the `legacy-cleanup` capability, "Retired command files are pruned on init and update"). The `Commands skipped for: <tool> (no adapter)` output is removed with the requirement.
