## ADDED Requirements

### Requirement: Update tolerates retired workflow ids in stored profile config

When `rasen update` reads a stored `custom` profile selection from global config that lists a workflow id no longer present in the catalog (such as a retired `ff`), the command SHALL drop the unknown id with a warning and continue, rather than aborting. The remaining known workflows SHALL be updated normally.

#### Scenario: Update with a stale retired id in custom profile

- **WHEN** user runs `rasen update`
- **AND** the global config `custom` profile selection still lists a retired id such as `ff`
- **THEN** the system SHALL drop the unknown id and emit a warning naming it
- **AND** the system SHALL update the remaining selected workflows without error

#### Scenario: Retired ff install healed on update

- **WHEN** user runs `rasen update`
- **AND** a configured tool still has an installed `rasen-ff-change` skill directory or `ff` command file from a prior install
- **THEN** the retired skill directory and command file SHALL be removed
- **AND** this SHALL occur even when no other update is required
