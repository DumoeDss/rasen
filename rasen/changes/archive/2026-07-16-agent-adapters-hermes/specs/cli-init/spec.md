## ADDED Requirements

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
