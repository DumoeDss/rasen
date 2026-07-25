## ADDED Requirements

### Requirement: Update reconciles retention workflow dependencies

The update command SHALL resolve the same effective workflow install set as init, including strong workflow dependencies and temporary compatibility dependencies. It SHALL install or refresh the canonical retention runner whenever shipping or the generated retro compatibility wrapper requires it, and SHALL remove a generated retention runner only when no current dependency requires it.

#### Scenario: Existing ship-only profile gains retention runner

- **WHEN** a project uses a custom or named profile containing `ship-command` without `auto-command`
- **AND** its configured tool does not currently contain `rasen-retain`
- **THEN** `rasen update` SHALL generate `rasen-retain/SKILL.md`, `rasen-retain/report.md`, and `rasen-retain/codify.md`
- **AND** it SHALL leave the stored profile membership unchanged

#### Scenario: Compatibility wrapper prevents orphaned backing runner

- **WHEN** update refreshes the temporary `rasen-retro` wrapper for a configured tool
- **THEN** cleanup SHALL preserve or regenerate the canonical `rasen-retain` directory required by that wrapper
- **AND** cleanup SHALL NOT leave a generated wrapper whose report branch is unavailable

#### Scenario: Duplicate dependency paths produce one runner

- **WHEN** the selected workflow set reaches `retain-command` through both `auto-command` and `ship-command`
- **THEN** update SHALL materialize one canonical `rasen-retain` directory
- **AND** drift and removal checks SHALL treat that directory as one desired generated artifact

#### Scenario: Update paths are cross-platform

- **WHEN** update reconciles retention artifacts on POSIX or Windows
- **THEN** it SHALL resolve and compare their identities below the configured tool's skills root using platform-native paths
- **AND** cleanup SHALL use exact generated identities rather than prefixes, globs, or regular expressions
