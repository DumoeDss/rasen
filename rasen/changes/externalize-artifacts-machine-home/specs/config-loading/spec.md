# config-loading Specification (delta)

## ADDED Requirements

### Requirement: Project config carries an optional projectId

The project config (`rasen/config.yaml` or `config.yml`) SHALL support an optional `projectId` string field identifying the project to machine-local features such as the project registry. Parsing SHALL follow the config's existing resilient policy: a valid string value is exposed on the parsed config; a non-string value is dropped with a warning naming the field; the field's absence is not an error. Any string value SHALL be accepted as an opaque identifier.

#### Scenario: Valid projectId is exposed

- **WHEN** the config contains `projectId: 6f9c1e2a-3b44-4b7e-9d15-2f8a1c0e5d21`
- **THEN** the parsed project config includes that `projectId` value unchanged

#### Scenario: Invalid projectId is dropped resiliently

- **WHEN** the config contains `projectId: [not, a, string]`
- **THEN** a warning identifies the invalid `projectId` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Absent projectId is not an error

- **WHEN** the config has no `projectId` field
- **THEN** the config parses without warnings about `projectId`
