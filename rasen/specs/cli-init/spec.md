# CLI Init Specification

## Purpose

The `rasen init` command SHALL create a complete Rasen directory structure in any project, enabling immediate adoption of Rasen conventions with support for multiple AI coding assistants.
## Requirements
### Requirement: Progress Indicators

The command SHALL display progress indicators during initialization to provide clear feedback about each step.

#### Scenario: Displaying initialization progress

- **WHEN** executing initialization steps
- **THEN** validate environment silently in background (no output unless error)
- **AND** display progress with ora spinners:
  - Show spinner: "⠋ Creating Rasen structure..."
  - Then success: "✔ Rasen structure created"
  - Show spinner: "⠋ Configuring AI tools..."
  - Then success: "✔ AI tools configured"

### Requirement: Directory Creation

The command SHALL create the rasen workspace directory structure with config file.

#### Scenario: Creating rasen workspace structure

- **WHEN** `rasen init` is executed
- **THEN** create the following directory structure:
```
rasen/
├── config.yaml
├── specs/
└── changes/
    └── archive/
```

### Requirement: Safety Checks
The command SHALL perform safety checks to prevent overwriting existing structures and ensure proper permissions.

#### Scenario: Detecting existing initialization
- **WHEN** the `rasen/` directory already exists
- **THEN** inform the user that rasen is already initialized, skip recreating the base structure, and enter an extend mode
- **AND** continue to the AI tool selection step so additional tools can be configured
- **AND** display the existing-initialization error message only when the user declines to add any AI tools

### Requirement: Success Output

The command SHALL provide clear, actionable next steps upon successful initialization.

#### Scenario: Displaying success message

- **WHEN** initialization completes successfully
- **THEN** display categorized summary:
  - "Created: <tools>" for newly configured tools
  - "Refreshed: <tools>" for already-configured tools that were updated
  - Count of skills and commands generated
- **AND** display getting started section with:
  - `/rasen:new` - Start a new change
  - `/rasen:continue` - Create the next artifact
  - `/rasen:apply` - Implement tasks
- **AND** display links to documentation and feedback

#### Scenario: Displaying restart instruction

- **WHEN** initialization completes successfully and tools were created or refreshed
- **THEN** display instruction to restart IDE for slash commands to take effect

### Requirement: Exit Codes

The command SHALL use consistent exit codes to indicate different failure modes.

#### Scenario: Returning exit codes

- **WHEN** the command completes
- **THEN** return appropriate exit code:
  - 0: Success
  - 1: General error (including when Rasen directory already exists)
  - 2: Insufficient permissions (reserved for future use)
  - 3: User cancelled operation (reserved for future use)

### Requirement: Additional AI Tool Initialization
`rasen init` SHALL allow users to add configuration files for new AI coding assistants after the initial setup.

#### Scenario: Configuring an extra tool after initial setup
- **GIVEN** a `rasen/` directory already exists and at least one AI tool file is present
- **WHEN** the user runs `rasen init` and selects a different supported AI tool
- **THEN** generate that tool's configuration files with Rasen markers the same way as during first-time initialization
- **AND** leave existing tool configuration files unchanged except for managed sections that need refreshing
- **AND** exit with code 0 and display a success summary highlighting the newly added tool files

### Requirement: Success Output Enhancements
`rasen init` SHALL summarize tool actions when initialization or extend mode completes.

#### Scenario: Showing tool summary
- **WHEN** the command completes successfully
- **THEN** display a categorized summary of tools that were created, refreshed, or skipped (including already-configured skips)
- **AND** personalize the "Next steps" header using the names of the selected tools, defaulting to a generic label when none remain

### Requirement: Exit Code Adjustments
`rasen init` SHALL treat extend mode without new native tool selections as a successful refresh.

#### Scenario: Allowing empty extend runs
- **WHEN** Rasen is already initialized and the user selects no additional natively supported tools
- **THEN** complete successfully without requiring additional tool setup
- **AND** preserve the existing Rasen structure and config files
- **AND** exit with code 0

### Requirement: Non-Interactive Mode

The command SHALL support non-interactive operation through command-line options. Tool selection SHALL be restricted to adapted agents: `--tools all` SHALL expand to the adapted agents only, and an explicit request for a known-but-unadapted agent SHALL be refused with a message distinct from the unrecognized-token error.

#### Scenario: Select all tools non-interactively

- **WHEN** run with `--tools all`
- **THEN** automatically select every adapted AI tool (`claude`, `codex`) without prompting
- **AND** NOT select any unadapted tool
- **AND** proceed with skill and command generation

#### Scenario: Select specific tools non-interactively

- **WHEN** run with `--tools claude,codex`
- **THEN** parse the comma-separated tool IDs
- **AND** generate skills and commands for the specified adapted tools only

#### Scenario: Skip tool configuration non-interactively

- **WHEN** run with `--tools none`
- **THEN** create only the rasen directory structure
- **AND** skip skill and command generation
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

### Requirement: Skill Generation
The init command SHALL generate skills based on the active profile, not a fixed set.

#### Scenario: Core profile skill generation
- **WHEN** user runs init with profile `core`
- **THEN** the system SHALL generate skills for workflows in CORE_WORKFLOWS constant: propose, explore, apply, sync, archive, auto-command, help
- **THEN** the system SHALL NOT generate skills for workflows outside the profile

#### Scenario: Custom profile skill generation
- **WHEN** user runs init with profile `custom`
- **THEN** the system SHALL generate skills only for workflows listed in config `workflows` array

#### Scenario: Propose workflow included in skill templates
- **WHEN** generating skills
- **THEN** the system SHALL include the `propose` workflow as an available skill template

### Requirement: Slash Command Generation

The init command SHALL generate commands based on profile AND delivery settings, and SHALL generate command files only for selected tools that have a registered command adapter; adapterless tools remain valid for skill generation. Skill generation is unconditional: every delivery setting installs skills.

#### Scenario: Skills-only delivery
- **WHEN** delivery is set to `skills`
- **THEN** the system SHALL NOT generate any command files

#### Scenario: Both delivery
- **WHEN** delivery is set to `both`
- **THEN** the system SHALL generate both skill and command files for profile workflows

#### Scenario: Skills generated under every delivery setting
- **WHEN** init runs with any delivery setting (`both` or `skills`, including a legacy value mapped to one of them)
- **THEN** the system SHALL generate skill files for the profile workflows

#### Scenario: Propose workflow included in command templates
- **WHEN** generating commands
- **THEN** the system SHALL include the `propose` workflow as an available command template

#### Scenario: Selected tool has no command adapter
- **GIVEN** a selected tool has `skillsDir` configured but no registered command adapter
- **WHEN** initialization includes command generation
- **THEN** skill generation for that tool SHALL still remain valid
- **AND** command-file generation SHALL be skipped for that tool
- **AND** the command output SHALL include `Commands skipped for: <tool-id> (no adapter)`

#### Scenario: Kimi CLI skips command-file generation
- **WHEN** the user selects Kimi CLI during initialization
- **THEN** Rasen SHALL treat it as a supported tool with `skillsDir: '.kimi'`
- **AND** command-file generation SHALL be skipped because no Kimi adapter is registered

### Requirement: Config File Generation

The command SHALL create a rasen config file with schema settings.

#### Scenario: Creating config.yaml

- **WHEN** initialization completes
- **AND** config.yaml does not exist
- **THEN** create `rasen/config.yaml` with default schema setting
- **AND** display config location in output

#### Scenario: Preserving existing config.yaml

- **WHEN** initialization runs in extend mode
- **AND** `rasen/config.yaml` already exists
- **THEN** preserve the existing config file
- **AND** display "(exists)" indicator in output

### Requirement: Init output uses the rasen namespace

All init success output, next-step hints, and generated artifact references SHALL use the rasen namespace: slash commands as `/rasen:*`, the workspace as `rasen/`, and skill directories as `rasen-*`.

#### Scenario: Success message references rasen commands

- **WHEN** `rasen init` completes successfully
- **THEN** the next-step hints reference `/rasen:*` commands and the `rasen/` workspace
- **AND** no hint references `/rasen:*` or a `rasen/` path

### Requirement: Experimental Command Alias

The command SHALL maintain backward compatibility with the experimental command.

#### Scenario: Running rasen experimental

- **WHEN** user runs `rasen experimental`
- **THEN** delegate to `rasen init`
- **AND** the command SHALL be hidden from help output

### Requirement: Tool auto-detection
The init command SHALL detect installed AI tools by scanning for their configuration directories in the project root.

#### Scenario: Detection from directories
- **WHEN** scanning for tools
- **THEN** the system SHALL check for directories matching each supported AI tool's configuration directory (e.g., `.claude/`, `.cursor/`, `.windsurf/`)
- **THEN** all tools with a matching directory SHALL be returned as detected

#### Scenario: Detection covers all supported tools
- **WHEN** scanning for tools
- **THEN** the system SHALL check for all tools defined in the supported tools configuration that have a configuration directory

#### Scenario: No tools detected
- **WHEN** no tool configuration directories exist in project root
- **THEN** the system SHALL return an empty list of detected tools

### Requirement: Smart defaults init flow
The init command SHALL work with sensible defaults and tool confirmation, minimizing required user input. Interactive selection and non-interactive auto-selection SHALL consider only adapted agents; detected directories for unadapted agents SHALL NOT be offered or auto-selected.

#### Scenario: Init with detected tools (interactive)
- **WHEN** user runs `rasen init` interactively and adapted tool directories are detected
- **THEN** the system SHALL show detected adapted tools pre-selected
- **THEN** the system SHALL ask for confirmation (not full selection)
- **THEN** the system SHALL use default profile (`core`) and delivery (`both`)

#### Scenario: Init with no detected tools (interactive)
- **WHEN** user runs `rasen init` interactively and no adapted tool directories are detected
- **THEN** the system SHALL prompt for tool selection from the adapted tools
- **THEN** the system SHALL use default profile (`core`) and delivery (`both`)

#### Scenario: Non-interactive with detected tools
- **WHEN** user runs `rasen init` non-interactively (e.g., in CI)
- **AND** adapted tool directories are detected
- **THEN** the system SHALL use the detected adapted tools automatically without prompting
- **AND** SHALL ignore detected directories for unadapted tools
- **THEN** the system SHALL use default profile and delivery

#### Scenario: Non-interactive with no detected tools
- **WHEN** user runs `rasen init` non-interactively
- **AND** no tool directories are detected
- **THEN** the system SHALL fail with exit code 1
- **AND** display message to use `--tools` flag

#### Scenario: Non-interactive with explicit tools
- **WHEN** user runs `rasen init --tools claude`
- **THEN** the system SHALL use specified tools
- **THEN** the system SHALL NOT prompt for any input

#### Scenario: Interactive with explicit tools
- **WHEN** user runs `rasen init --tools claude` interactively
- **THEN** the system SHALL use specified tools (ignoring auto-detection)
- **THEN** the system SHALL NOT prompt for tool selection
- **THEN** the system SHALL proceed with default profile and delivery

#### Scenario: Init success message (propose installed)
- **WHEN** init completes successfully
- **AND** `propose` is in the active profile
- **THEN** the system SHALL display a tool-appropriate success message
- **THEN** for tools using colon syntax (Claude Code): "Start your first change: /rasen:propose \"your idea\""
- **THEN** for tools using hyphen syntax (Cursor, others): "Start your first change: /rasen-propose \"your idea\""

#### Scenario: Init success message (propose not installed, new installed)
- **WHEN** init completes successfully
- **AND** `propose` is NOT in the active profile
- **AND** `new` is in the active profile
- **THEN** for tools using colon syntax: "Start your first change: /rasen:new \"your idea\""
- **THEN** for tools using hyphen syntax: "Start your first change: /rasen-new \"your idea\""

#### Scenario: Init success message (neither propose nor new)
- **WHEN** init completes successfully
- **AND** neither `propose` nor `new` is in the active profile
- **THEN** the system SHALL display: "Done. Run 'rasen config profile' to configure your workflows."

### Requirement: Init performs migration on existing projects
The init command SHALL perform one-time migration when re-initializing an existing project, using the same shared migration logic as the update command.

#### Scenario: Re-init on existing project (no profile set)
- **WHEN** user runs `rasen init` on a project with existing workflow files
- **AND** global config does not contain a `profile` field
- **THEN** the system SHALL perform one-time migration before proceeding (see `specs/cli-update/spec.md`)
- **THEN** the system SHALL proceed with init using the migrated config

#### Scenario: Init on new project (no existing workflows)
- **WHEN** user runs `rasen init` on a project with no existing workflow files
- **AND** global config does not contain a `profile` field
- **THEN** the system SHALL NOT perform migration
- **THEN** the system SHALL use `core` profile defaults

### Requirement: Init respects global config
The init command SHALL read and apply settings from global config.

#### Scenario: User has profile preference
- **WHEN** global config contains `profile: "custom"` with custom workflows
- **THEN** init SHALL install custom profile workflows

#### Scenario: User has delivery preference
- **WHEN** global config contains `delivery: "skills"`
- **THEN** init SHALL install only skill files, not commands

#### Scenario: Override via flags
- **WHEN** user runs `rasen init --profile core`
- **THEN** the system SHALL use the flag value instead of config value
- **THEN** the system SHALL NOT update the global config

#### Scenario: Invalid profile override
- **WHEN** user runs `rasen init --profile <invalid>`
- **AND** `<invalid>` is not one of `core` or `custom`
- **THEN** the system SHALL exit with code 1
- **THEN** the system SHALL display a validation error listing allowed profile values

### Requirement: Init applies configured profile without confirmation
The init command SHALL apply the resolved profile (`--profile` override or global config) directly without prompting for confirmation.

#### Scenario: Init with custom profile (interactive)
- **WHEN** user runs `rasen init` interactively
- **AND** global config specifies `profile: "custom"` with workflows
- **THEN** the system SHALL proceed directly using the custom profile workflows
- **AND** the system SHALL NOT show a profile confirmation prompt

#### Scenario: Non-interactive init with custom profile
- **WHEN** user runs `rasen init` non-interactively
- **AND** global config specifies a custom profile
- **THEN** the system SHALL proceed without confirmation

#### Scenario: Init with core profile
- **WHEN** user runs `rasen init` interactively
- **AND** profile is `core` (default)
- **THEN** the system SHALL proceed directly without a profile confirmation prompt

### Requirement: Init preserves existing workflows
The init command SHALL NOT remove workflows that are already installed, but SHALL respect delivery setting. Delivery-driven cleanup applies to command files only; skill directories are never removed because of a delivery setting.

#### Scenario: Existing custom installation
- **WHEN** user has custom profile with extra workflows and runs `rasen init` with core profile
- **THEN** the system SHALL NOT remove extra workflows
- **THEN** the system SHALL regenerate core workflow files, overwriting existing content with latest templates

#### Scenario: Init with different delivery setting
- **WHEN** user runs `rasen init` on existing project
- **AND** delivery setting differs from what's installed (e.g., was `both`, now `skills`)
- **THEN** the system SHALL generate files matching current delivery setting
- **THEN** the system SHALL delete files that don't match delivery (e.g., commands removed if `skills`)
- **THEN** this applies to all workflows, including extras not in profile

#### Scenario: Re-init applies delivery cleanup even when templates are current
- **WHEN** user runs `rasen init` on an existing project
- **AND** existing files are already on current template versions
- **AND** delivery changed since the previous init
- **THEN** the system SHALL still remove files that no longer match delivery
- **THEN** for example, switching from `both` to `skills` SHALL remove generated command files

#### Scenario: Delivery never removes skill directories
- **WHEN** user runs `rasen init` on an existing project with skill directories installed
- **THEN** no delivery setting SHALL cause those skill directories to be removed
- **AND** skill directories are removed only through workflow deselection, never through delivery

### Requirement: Init tool confirmation UX
The init command SHALL show detected tools and ask for confirmation.

#### Scenario: Confirmation prompt
- **WHEN** tools are detected in interactive mode
- **THEN** the system SHALL display: "Detected: Claude Code, Cursor"
- **THEN** the system SHALL show pre-selected checkboxes for confirmation
- **THEN** the system SHALL allow user to deselect unwanted tools

### Requirement: Init establishes machine-home identity and registration

`rasen init` SHALL ensure the project has a stable `projectId` in its config (minting one only when absent, preserving an existing one), register the project in the machine-wide project registry, and create the project's machine home directory. The success summary SHALL mention the machine home location. Registration failures (e.g. an unwritable global data dir) SHALL be reported as warnings without failing init: the repo-side setup still completes.

#### Scenario: Fresh init registers the project

- **WHEN** `rasen init` completes in a new project
- **THEN** the config contains a `projectId`
- **AND** the machine registry contains an entry for the project's absolute path
- **AND** the project's home directory exists under the global data dir

#### Scenario: Re-init is idempotent for identity

- **WHEN** `rasen init` runs again in an already-initialized, already-registered project
- **THEN** the `projectId`, registry entry, and home directory are unchanged

#### Scenario: Registry failure does not fail init

- **WHEN** the machine registry cannot be written during `rasen init`
- **THEN** init completes its repo-side setup and prints a warning describing the registration problem

### Requirement: Init configures Hermes via its global skills home

When Hermes is among the selected tools, the init command SHALL install Rasen's workflow skills to the resolved Hermes skills home rather than a project-local directory, and SHALL skip command-file generation for Hermes (Hermes has no command-file adapter; its skills surface as slash commands). Skills SHALL be installed under every delivery setting.

#### Scenario: Init installs Hermes skills to the global home

- **WHEN** user runs `rasen init --tools hermes`
- **THEN** the system SHALL write Rasen skill files under the resolved Hermes skills home (`<HERMES_HOME or ~/.hermes>/skills/rasen-<workflow>/SKILL.md`)
- **AND** SHALL NOT create a project-local `.hermes/skills/` tree

#### Scenario: Init skips command files for Hermes

- **WHEN** user runs `rasen init --tools hermes` with a delivery setting that would generate commands
- **THEN** skill installation for Hermes SHALL still occur
- **AND** command-file generation SHALL be skipped for Hermes
- **AND** the command output SHALL report Hermes among tools with skipped command generation

#### Scenario: Init reports where Hermes skills were installed

- **WHEN** init completes Hermes setup
- **THEN** the success output SHALL make clear that Hermes skills were installed to the Hermes home (a machine-global location), not the project

### Requirement: Init tolerates retired workflow ids in stored profile config

When `rasen init` resolves the workflow selection from a stored `custom` profile in global config that lists a workflow id no longer present in the catalog (such as a retired `ff`), init SHALL drop the unknown id with a warning and continue, rather than aborting before generating any tool configuration.

#### Scenario: Init with a stale retired id in custom profile

- **WHEN** user runs `rasen init`
- **AND** the global config `custom` profile selection still lists a retired id such as `ff`
- **THEN** the system SHALL drop the unknown id and emit a warning naming it
- **AND** init SHALL proceed to generate configuration for the remaining known workflows

## Why

Manual creation of Rasen structure is error-prone and creates adoption friction. A standardized init command ensures:
- Consistent structure across all projects
- Proper AI instruction files are always included
- Quick onboarding for new projects
- Clear conventions from the start
