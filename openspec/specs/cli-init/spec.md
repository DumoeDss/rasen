# CLI Init Specification

## Purpose

The `openspec init` command SHALL create a complete OpenSpec directory structure in any project, enabling immediate adoption of OpenSpec conventions with support for multiple AI coding assistants.
## Requirements
### Requirement: Progress Indicators

The command SHALL display progress indicators during initialization to provide clear feedback about each step.

#### Scenario: Displaying initialization progress

- **WHEN** executing initialization steps
- **THEN** validate environment silently in background (no output unless error)
- **AND** display progress with ora spinners:
  - Show spinner: "⠋ Creating OpenSpec structure..."
  - Then success: "✔ OpenSpec structure created"
  - Show spinner: "⠋ Configuring AI tools..."
  - Then success: "✔ AI tools configured"

### Requirement: Directory Creation

The command SHALL create the OpenSpec directory structure with config file.

#### Scenario: Creating OpenSpec structure

- **WHEN** `openspec init` is executed
- **THEN** create the following directory structure:
```
openspec/
├── config.yaml
├── specs/
└── changes/
    └── archive/
```

### Requirement: Safety Checks
The command SHALL perform safety checks to prevent overwriting existing structures and ensure proper permissions.

#### Scenario: Detecting existing initialization
- **WHEN** the `openspec/` directory already exists
- **THEN** inform the user that OpenSpec is already initialized, skip recreating the base structure, and enter an extend mode
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
  - `/opsx:new` - Start a new change
  - `/opsx:continue` - Create the next artifact
  - `/opsx:apply` - Implement tasks
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
  - 1: General error (including when OpenSpec directory already exists)
  - 2: Insufficient permissions (reserved for future use)
  - 3: User cancelled operation (reserved for future use)

### Requirement: Additional AI Tool Initialization
`openspec init` SHALL allow users to add configuration files for new AI coding assistants after the initial setup.

#### Scenario: Configuring an extra tool after initial setup
- **GIVEN** an `openspec/` directory already exists and at least one AI tool file is present
- **WHEN** the user runs `openspec init` and selects a different supported AI tool
- **THEN** generate that tool's configuration files with OpenSpec markers the same way as during first-time initialization
- **AND** leave existing tool configuration files unchanged except for managed sections that need refreshing
- **AND** exit with code 0 and display a success summary highlighting the newly added tool files

### Requirement: Success Output Enhancements
`openspec init` SHALL summarize tool actions when initialization or extend mode completes.

#### Scenario: Showing tool summary
- **WHEN** the command completes successfully
- **THEN** display a categorized summary of tools that were created, refreshed, or skipped (including already-configured skips)
- **AND** personalize the "Next steps" header using the names of the selected tools, defaulting to a generic label when none remain

### Requirement: Exit Code Adjustments
`openspec init` SHALL treat extend mode without new native tool selections as a successful refresh.

#### Scenario: Allowing empty extend runs
- **WHEN** OpenSpec is already initialized and the user selects no additional natively supported tools
- **THEN** complete successfully without requiring additional tool setup
- **AND** preserve the existing OpenSpec structure and config files
- **AND** exit with code 0

### Requirement: Non-Interactive Mode

The command SHALL support non-interactive operation through command-line options.

#### Scenario: Select all tools non-interactively

- **WHEN** run with `--tools all`
- **THEN** automatically select every available AI tool without prompting
- **AND** proceed with skill and command generation

#### Scenario: Select specific tools non-interactively

- **WHEN** run with `--tools claude,cursor`
- **THEN** parse the comma-separated tool IDs
- **AND** generate skills and commands for specified tools only

#### Scenario: Skip tool configuration non-interactively

- **WHEN** run with `--tools none`
- **THEN** create only the openspec directory structure
- **AND** skip skill and command generation
- **AND** create config only when config creation conditions are met

#### Scenario: Invalid tool specification

- **WHEN** run with `--tools invalid-tool`
- **THEN** fail with exit code 1
- **AND** display an error listing available values (`all`, `none`, and supported tool IDs)

#### Scenario: Reserved value combined with tool IDs

- **WHEN** run with `--tools all,claude` or `--tools none,cursor`
- **THEN** fail with exit code 1
- **AND** display an error explaining reserved values cannot be combined with specific tool IDs

#### Scenario: Missing --tools in non-interactive mode

- **GIVEN** prompts are unavailable in non-interactive execution
- **WHEN** user runs `openspec init` without `--tools`
- **THEN** fail with exit code 1
- **AND** instruct to use `--tools all`, `--tools none`, or explicit tool IDs

### Requirement: Skill Generation
The init command SHALL generate skills based on the active profile, not a fixed set.

#### Scenario: Core profile skill generation
- **WHEN** user runs init with profile `core`
- **THEN** the system SHALL generate skills for workflows in CORE_WORKFLOWS constant: propose, explore, apply, archive
- **THEN** the system SHALL NOT generate skills for workflows outside the profile

#### Scenario: Custom profile skill generation
- **WHEN** user runs init with profile `custom`
- **THEN** the system SHALL generate skills only for workflows listed in config `workflows` array

#### Scenario: Propose workflow included in skill templates
- **WHEN** generating skills
- **THEN** the system SHALL include the `propose` workflow as an available skill template

### Requirement: Slash Command Generation
The init command SHALL generate commands based on profile AND delivery settings.

#### Scenario: Skills-only delivery
- **WHEN** delivery is set to `skills`
- **THEN** the system SHALL NOT generate any command files

#### Scenario: Commands-only delivery
- **WHEN** delivery is set to `commands`
- **THEN** the system SHALL NOT generate any skill files

#### Scenario: Both delivery
- **WHEN** delivery is set to `both`
- **THEN** the system SHALL generate both skill and command files for profile workflows

#### Scenario: Propose workflow included in command templates
- **WHEN** generating commands
- **THEN** the system SHALL include the `propose` workflow as an available command template

### Requirement: Config File Generation

The command SHALL create an OpenSpec config file with schema settings.

#### Scenario: Creating config.yaml

- **WHEN** initialization completes
- **AND** config.yaml does not exist
- **THEN** create `openspec/config.yaml` with default schema setting
- **AND** display config location in output

#### Scenario: Preserving existing config.yaml

- **WHEN** initialization runs in extend mode
- **AND** `openspec/config.yaml` already exists
- **THEN** preserve the existing config file
- **AND** display "(exists)" indicator in output

### Requirement: Experimental Command Alias

The command SHALL maintain backward compatibility with the experimental command.

#### Scenario: Running openspec experimental

- **WHEN** user runs `openspec experimental`
- **THEN** delegate to `openspec init`
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
The init command SHALL work with sensible defaults and tool confirmation, minimizing required user input.

#### Scenario: Init with detected tools (interactive)
- **WHEN** user runs `openspec init` interactively and tool directories are detected
- **THEN** the system SHALL show detected tools pre-selected
- **THEN** the system SHALL ask for confirmation (not full selection)
- **THEN** the system SHALL use default profile (`core`) and delivery (`both`)

#### Scenario: Init with no detected tools (interactive)
- **WHEN** user runs `openspec init` interactively and no tool directories are detected
- **THEN** the system SHALL prompt for tool selection
- **THEN** the system SHALL use default profile (`core`) and delivery (`both`)

#### Scenario: Non-interactive with detected tools
- **WHEN** user runs `openspec init` non-interactively (e.g., in CI)
- **AND** tool directories are detected
- **THEN** the system SHALL use detected tools automatically without prompting
- **THEN** the system SHALL use default profile and delivery

#### Scenario: Non-interactive with no detected tools
- **WHEN** user runs `openspec init` non-interactively
- **AND** no tool directories are detected
- **THEN** the system SHALL fail with exit code 1
- **AND** display message to use `--tools` flag

#### Scenario: Non-interactive with explicit tools
- **WHEN** user runs `openspec init --tools claude`
- **THEN** the system SHALL use specified tools
- **THEN** the system SHALL NOT prompt for any input

#### Scenario: Interactive with explicit tools
- **WHEN** user runs `openspec init --tools claude` interactively
- **THEN** the system SHALL use specified tools (ignoring auto-detection)
- **THEN** the system SHALL NOT prompt for tool selection
- **THEN** the system SHALL proceed with default profile and delivery

#### Scenario: Init success message (propose installed)
- **WHEN** init completes successfully
- **AND** `propose` is in the active profile
- **THEN** the system SHALL display a tool-appropriate success message
- **THEN** for tools using colon syntax (Claude Code): "Start your first change: /opsx:propose \"your idea\""
- **THEN** for tools using hyphen syntax (Cursor, others): "Start your first change: /opsx-propose \"your idea\""

#### Scenario: Init success message (propose not installed, new installed)
- **WHEN** init completes successfully
- **AND** `propose` is NOT in the active profile
- **AND** `new` is in the active profile
- **THEN** for tools using colon syntax: "Start your first change: /opsx:new \"your idea\""
- **THEN** for tools using hyphen syntax: "Start your first change: /opsx-new \"your idea\""

#### Scenario: Init success message (neither propose nor new)
- **WHEN** init completes successfully
- **AND** neither `propose` nor `new` is in the active profile
- **THEN** the system SHALL display: "Done. Run 'openspec config profile' to configure your workflows."

### Requirement: Init performs migration on existing projects
The init command SHALL perform one-time migration when re-initializing an existing project, using the same shared migration logic as the update command.

#### Scenario: Re-init on existing project (no profile set)
- **WHEN** user runs `openspec init` on a project with existing workflow files
- **AND** global config does not contain a `profile` field
- **THEN** the system SHALL perform one-time migration before proceeding (see `specs/cli-update/spec.md`)
- **THEN** the system SHALL proceed with init using the migrated config

#### Scenario: Init on new project (no existing workflows)
- **WHEN** user runs `openspec init` on a project with no existing workflow files
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
- **WHEN** user runs `openspec init --profile core`
- **THEN** the system SHALL use the flag value instead of config value
- **THEN** the system SHALL NOT update the global config

#### Scenario: Invalid profile override
- **WHEN** user runs `openspec init --profile <invalid>`
- **AND** `<invalid>` is not one of `core` or `custom`
- **THEN** the system SHALL exit with code 1
- **THEN** the system SHALL display a validation error listing allowed profile values

### Requirement: Init applies configured profile without confirmation
The init command SHALL apply the resolved profile (`--profile` override or global config) directly without prompting for confirmation.

#### Scenario: Init with custom profile (interactive)
- **WHEN** user runs `openspec init` interactively
- **AND** global config specifies `profile: "custom"` with workflows
- **THEN** the system SHALL proceed directly using the custom profile workflows
- **AND** the system SHALL NOT show a profile confirmation prompt

#### Scenario: Non-interactive init with custom profile
- **WHEN** user runs `openspec init` non-interactively
- **AND** global config specifies a custom profile
- **THEN** the system SHALL proceed without confirmation

#### Scenario: Init with core profile
- **WHEN** user runs `openspec init` interactively
- **AND** profile is `core` (default)
- **THEN** the system SHALL proceed directly without a profile confirmation prompt

### Requirement: Init preserves existing workflows
The init command SHALL NOT remove workflows that are already installed, but SHALL respect delivery setting.

#### Scenario: Existing custom installation
- **WHEN** user has custom profile with extra workflows and runs `openspec init` with core profile
- **THEN** the system SHALL NOT remove extra workflows
- **THEN** the system SHALL regenerate core workflow files, overwriting existing content with latest templates

#### Scenario: Init with different delivery setting
- **WHEN** user runs `openspec init` on existing project
- **AND** delivery setting differs from what's installed (e.g., was `both`, now `skills`)
- **THEN** the system SHALL generate files matching current delivery setting
- **THEN** the system SHALL delete files that don't match delivery (e.g., commands removed if `skills`)
- **THEN** this applies to all workflows, including extras not in profile

#### Scenario: Re-init applies delivery cleanup even when templates are current
- **WHEN** user runs `openspec init` on an existing project
- **AND** existing files are already on current template versions
- **AND** delivery changed since the previous init
- **THEN** the system SHALL still remove files that no longer match delivery
- **THEN** for example, switching from `both` to `skills` SHALL remove generated command files

### Requirement: Init tool confirmation UX
The init command SHALL show detected tools and ask for confirmation.

#### Scenario: Confirmation prompt
- **WHEN** tools are detected in interactive mode
- **THEN** the system SHALL display: "Detected: Claude Code, Cursor"
- **THEN** the system SHALL show pre-selected checkboxes for confirmation
- **THEN** the system SHALL allow user to deselect unwanted tools

## Why

Manual creation of OpenSpec structure is error-prone and creates adoption friction. A standardized init command ensures:
- Consistent structure across all projects
- Proper AI instruction files are always included
- Quick onboarding for new projects
- Clear conventions from the start
