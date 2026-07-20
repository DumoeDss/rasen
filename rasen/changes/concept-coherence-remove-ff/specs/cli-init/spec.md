## ADDED Requirements

### Requirement: Init tolerates retired workflow ids in stored profile config

When `rasen init` resolves the workflow selection from a stored `custom` profile in global config that lists a workflow id no longer present in the catalog (such as a retired `ff`), init SHALL drop the unknown id with a warning and continue, rather than aborting before generating any tool configuration.

#### Scenario: Init with a stale retired id in custom profile

- **WHEN** user runs `rasen init`
- **AND** the global config `custom` profile selection still lists a retired id such as `ff`
- **THEN** the system SHALL drop the unknown id and emit a warning naming it
- **AND** init SHALL proceed to generate configuration for the remaining known workflows
