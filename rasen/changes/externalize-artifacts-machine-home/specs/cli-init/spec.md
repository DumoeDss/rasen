# cli-init Specification (delta)

## ADDED Requirements

### Requirement: Init establishes machine-home identity and registration

`rasen init` SHALL ensure the project has a stable `projectId` in its config (minting one only when absent, preserving an existing one), register the project in the machine-wide project registry, and create the project's machine home directory. The success summary SHALL mention the machine home location. Registration failures (e.g. an unwritable global data dir) SHALL be reported as warnings without failing init: the repo-side setup still completes.

#### Scenario: Fresh init registers the project

- **WHEN** `rasen init` completes in a new project
- **THEN** the config contains a `projectId`
- **AND** the machine registry contains an entry for the project's absolute path
- **AND** the project's home directory exists under the global data dir

#### Scenario: Re-init is idempotent for identity

- **WHEN** `rasen init` runs again in an already-initialized, already-registered project
- **THEN** the `projectId`, registry entry, and home directory are unchanged

#### Scenario: Registry failure does not fail init

- **WHEN** the machine registry cannot be written during `rasen init`
- **THEN** init completes its repo-side setup and prints a warning describing the registration problem
