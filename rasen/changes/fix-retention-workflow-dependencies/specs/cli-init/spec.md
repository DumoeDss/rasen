## MODIFIED Requirements

### Requirement: Skill Generation

The init command SHALL generate skills from the active profile plus its resolved workflow dependencies and temporary compatibility dependencies, rather than from a fixed set. Internal dependency workflows SHALL be materialized into the configured tool but SHALL remain absent from stored profile membership and profile checkboxes.

#### Scenario: Core profile skill generation

- **WHEN** a user runs init with profile `core`
- **THEN** the system SHALL generate skills for workflows in `CORE_WORKFLOWS`: propose, explore, apply, sync, archive, auto-command, and help
- **AND** it SHALL generate workflow skills required by dependency closure, including `rasen-retain` for `auto-command`, even when retention is `off`
- **AND** it SHALL NOT generate ordinary selectable workflow skills outside the profile or its dependency closure

#### Scenario: Custom profile with ship but no auto installs retention

- **WHEN** a user runs init with a custom or named profile that contains `ship-command` but not `auto-command`
- **THEN** the generated tool skills SHALL include `rasen-ship` and `rasen-retain`
- **AND** the installed `rasen-retain` directory SHALL contain `SKILL.md`, `report.md`, and `codify.md`
- **AND** the stored profile SHALL remain unchanged and SHALL NOT gain the internal `retain-command` ID

#### Scenario: Temporary retro wrapper has its backing runner

- **WHEN** init generates the temporary `rasen-retro` compatibility wrapper for a configured tool
- **THEN** the same generated skill set SHALL contain the canonical `rasen-retain` runner and both retention sidecars
- **AND** direct invocation of `rasen-retro` SHALL have access to the report branch it delegates to regardless of the active profile's retention mode

#### Scenario: Generated retention paths are cross-platform

- **WHEN** init materializes the runner, wrapper, and sidecars on POSIX or Windows
- **THEN** each file SHALL be placed below the configured tool's resolved skills root using platform-native path handling
- **AND** no forward-slash, drive-letter, or case-sensitive path assumption SHALL be required

#### Scenario: Propose workflow included in skill templates

- **WHEN** generating skills
- **THEN** the system SHALL include the `propose` workflow as an available skill template
