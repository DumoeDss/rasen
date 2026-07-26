## MODIFIED Requirements

### Requirement: Additional AI Tool Initialization

`rasen init` SHALL allow users to add configuration files for supported AI coding assistants after initial setup, including in projects whose planning is externalized to a store. In an externalized-planning repository, only an explicit, non-empty `--tools` selection at the exact repository root SHALL perform tool-only setup, preserving the store pointer without creating a local planning workspace.

#### Scenario: Configuring an extra tool after local setup

- **GIVEN** a local `rasen/` planning workspace already exists and at least one AI tool file is present
- **WHEN** the user runs `rasen init` and selects a different supported AI tool
- **THEN** generate that tool's configuration files with Rasen markers the same way as during first-time initialization
- **AND** leave existing tool configuration files unchanged except for managed sections that need refreshing
- **AND** exit with code 0 and display a success summary highlighting the newly added tool files

#### Scenario: Configuring an explicit tool at an externalized repository root

- **GIVEN** the repository's `rasen/config.yaml` has a valid `store:` declaration and no local planning directories
- **WHEN** the user runs `rasen init --tools codex` at that repository's exact root using the platform-native path spelling
- **THEN** generate or refresh the selected Codex Rasen skills and report success
- **AND** preserve the `store:` declaration
- **AND** leave `rasen/specs`, `rasen/changes`, and `rasen/changes/archive` absent

#### Scenario: Refusing implicit or empty tool setup in an externalized repository

- **GIVEN** the repository's planning is externalized through a valid `store:` declaration
- **WHEN** the user runs plain `rasen init` or `rasen init --tools none`
- **THEN** fail with the externalized-planning guidance
- **AND** leave the pointer repository unchanged

#### Scenario: Refusing tool setup below an externalized repository root

- **GIVEN** the repository's planning is externalized through a valid `store:` declaration
- **WHEN** the user targets a descendant directory with `rasen init --tools codex`
- **THEN** fail with the externalized-planning guidance
- **AND** create neither a nested Rasen root nor tool assets in the descendant

#### Scenario: Refusing tool setup with a malformed store declaration

- **GIVEN** a config-only `rasen/` directory contains a malformed `store:` declaration
- **WHEN** the user runs `rasen init --tools codex`
- **THEN** fail with guidance to fix or remove the malformed declaration
- **AND** create neither local planning directories nor tool assets
