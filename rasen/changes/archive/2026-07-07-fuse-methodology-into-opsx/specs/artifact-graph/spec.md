## MODIFIED Requirements

### Requirement: Schema Loading
The system SHALL load artifact graph definitions from YAML schema files within schema directories. The schema parser SHALL accept optional `enhance` (string), `provider` (string), and `context-from` (string) fields on artifact definitions without requiring them.

#### Scenario: Valid schema loaded
- **WHEN** a schema directory contains a valid `schema.yaml` file
- **THEN** the system returns an ArtifactGraph with all artifacts and dependencies

#### Scenario: Schema with enhance field
- **WHEN** a schema contains an artifact with `enhance: "review"`
- **THEN** the system loads the artifact with the enhance field preserved

#### Scenario: Schema without new fields
- **WHEN** a schema contains artifacts without enhance, provider, or context-from fields
- **THEN** the system loads normally with these fields as undefined (backward compatible)

#### Scenario: Schema with provider field
- **WHEN** a schema contains an artifact with `provider: "review"`
- **THEN** the system loads the artifact with the provider field preserved

#### Scenario: Invalid schema rejected
- **WHEN** a schema YAML file is missing required fields
- **THEN** the system throws an error with a descriptive message

#### Scenario: Cyclic dependencies detected
- **WHEN** a schema contains cyclic artifact dependencies
- **THEN** the system throws an error listing the artifact IDs in the cycle

#### Scenario: Invalid dependency reference
- **WHEN** an artifact's `requires` array references a non-existent artifact ID
- **THEN** the system throws an error identifying the invalid reference

#### Scenario: Duplicate artifact IDs rejected
- **WHEN** a schema contains multiple artifacts with the same ID
- **THEN** the system throws an error identifying the duplicate

#### Scenario: Schema directory not found
- **WHEN** resolving a schema name that has no corresponding directory
- **THEN** the system throws an error listing available schemas
