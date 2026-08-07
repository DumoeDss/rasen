## MODIFIED Requirements

### Requirement: Non-Interactive Mode

The command SHALL support non-interactive operation through command-line options. Tool selection SHALL be restricted to adapted agents: `--tools all` SHALL expand to the adapted agents only, and an explicit request for a known-but-unadapted agent SHALL be refused with a message distinct from the unrecognized-token error. Every place this requirement's scenarios name the adapted set, the set SHALL be the one the shipped registry declares rather than a list restated here.

#### Scenario: Select all tools non-interactively

- **WHEN** run with `--tools all`
- **THEN** automatically select every adapted AI tool — the shipped set, which includes `claude`, `codex`, `hermes`, and `omp` — without prompting
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
- **AND** name every currently adapted tool from the shipped registry

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
