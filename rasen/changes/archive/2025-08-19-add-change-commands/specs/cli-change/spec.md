## ADDED Requirements

### Requirement: Change Command

The system SHALL provide a `change` command with subcommands for displaying, listing, and validating change proposals.

#### Scenario: Show change as JSON

- **WHEN** executing `openspec change show update-error --json`
- **THEN** parse the markdown change file
- **AND** extract change structure and deltas
- **AND** output valid JSON to stdout

#### Scenario: List all changes

- **WHEN** executing `openspec change list`
- **THEN** scan the openspec/changes directory
- **AND** return list of all pending changes
- **AND** support JSON output with `--json` flag

#### Scenario: Show only requirement changes

- **WHEN** executing `openspec change show update-error --requirements-only`
- **THEN** display only the requirement changes (ADDED/MODIFIED/REMOVED/RENAMED)
- **AND** exclude why and what changes sections

#### Scenario: Validate change structure

- **WHEN** executing `openspec change validate update-error`
- **THEN** parse the change file
- **AND** validate against Zod schema
- **AND** ensure deltas are well-formed

### Requirement: Legacy Compatibility

The system SHALL maintain backward compatibility with the existing `list` command while showing deprecation notices.

#### Scenario: Legacy list command

- **WHEN** executing `openspec list`
- **THEN** display current list of changes (existing behavior)
- **AND** show deprecation notice: "Note: 'openspec list' is deprecated. Use 'openspec change list' instead."

#### Scenario: Legacy list with --all flag

- **WHEN** executing `openspec list --all`
- **THEN** display all changes (existing behavior)
- **AND** show same deprecation notice