## MODIFIED Requirements

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
- **AND** no adapted tool directories are detected
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
