## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Update refreshes only rasen-namespace artifacts

The update command SHALL refresh command files under rasen-namespace paths (e.g., `.claude/commands/rasen/`, `rasen-<id>.md` variants) and skill directories under `rasen-*` names. Legacy-namespace files (`opsx` command paths, `openspec-*` skill directories) SHALL NOT be refreshed, rewritten, or deleted by update; when detected, update SHALL print a one-time notice that they may belong to upstream OpenSpec or an older rasen install.

#### Scenario: Rasen artifacts refreshed

- **WHEN** `rasen update` runs in a project with `.claude/commands/rasen/` command files and `rasen-*` skill directories
- **THEN** those files are refreshed from the current templates

#### Scenario: Legacy artifacts left untouched

- **WHEN** `rasen update` runs in a project that also contains `.claude/commands/opsx/` files or `openspec-*` skill directories
- **THEN** those files and directories are not modified or deleted
- **AND** the output includes a notice explaining they may belong to upstream OpenSpec and how to remove them manually if they came from an older rasen install
