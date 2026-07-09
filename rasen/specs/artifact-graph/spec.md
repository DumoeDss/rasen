# artifact-graph Specification

## Purpose
Define the artifact graph model, dependency validation, and completion-state logic used by schema-driven workflows.
## Requirements
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

### Requirement: Build Order Calculation
The system SHALL compute a valid topological build order for artifacts.

#### Scenario: Linear dependency chain
- **WHEN** artifacts form a linear chain (A → B → C)
- **THEN** getBuildOrder() returns [A, B, C]

#### Scenario: Diamond dependency
- **WHEN** artifacts form a diamond (A → B, A → C, B → D, C → D)
- **THEN** getBuildOrder() returns A before B and C, and D last

#### Scenario: Independent artifacts
- **WHEN** artifacts have no dependencies
- **THEN** getBuildOrder() returns them in a stable order

### Requirement: State Detection
The system SHALL detect artifact completion state by scanning the filesystem.

#### Scenario: Simple file exists
- **WHEN** an artifact generates "proposal.md" and the file exists
- **THEN** the artifact is marked as completed

#### Scenario: Simple file missing
- **WHEN** an artifact generates "proposal.md" and the file does not exist
- **THEN** the artifact is not marked as completed

#### Scenario: Glob pattern with files
- **WHEN** an artifact generates "specs/*.md" and the specs/ directory contains .md files
- **THEN** the artifact is marked as completed

#### Scenario: Glob pattern empty
- **WHEN** an artifact generates "specs/*.md" and the specs/ directory is empty or missing
- **THEN** the artifact is not marked as completed

#### Scenario: Missing change directory
- **WHEN** the change directory does not exist
- **THEN** all artifacts are marked as not completed (empty state)

### Requirement: Ready Artifact Query
The system SHALL identify which artifacts are ready to be created based on dependency completion.

#### Scenario: Root artifacts ready initially
- **WHEN** no artifacts are completed
- **THEN** getNextArtifacts() returns artifacts with no dependencies

#### Scenario: Dependent artifact becomes ready
- **WHEN** an artifact's dependencies are all completed
- **THEN** getNextArtifacts() includes that artifact

#### Scenario: Blocked artifacts excluded
- **WHEN** an artifact has uncompleted dependencies
- **THEN** getNextArtifacts() does not include that artifact

### Requirement: Completion Check
The system SHALL determine when all artifacts in a graph are complete.

#### Scenario: All complete
- **WHEN** all artifacts in the graph are in the completed set
- **THEN** isComplete() returns true

#### Scenario: Partially complete
- **WHEN** some artifacts in the graph are not completed
- **THEN** isComplete() returns false

### Requirement: Blocked Query
The system SHALL identify which artifacts are blocked and return all their unmet dependencies.

#### Scenario: Artifact blocked by single dependency
- **WHEN** artifact B requires artifact A and A is not complete
- **THEN** getBlocked() returns `{ B: ['A'] }`

#### Scenario: Artifact blocked by multiple dependencies
- **WHEN** artifact C requires A and B, and only A is complete
- **THEN** getBlocked() returns `{ C: ['B'] }`

#### Scenario: Artifact blocked by all dependencies
- **WHEN** artifact C requires A and B, and neither is complete
- **THEN** getBlocked() returns `{ C: ['A', 'B'] }`

### Requirement: Schema Directory Structure
The system SHALL support self-contained schema directories with co-located templates.

#### Scenario: Schema with templates
- **WHEN** a schema directory contains `schema.yaml` and `templates/` subdirectory
- **THEN** artifacts can reference templates relative to the schema's templates directory

#### Scenario: User schema override
- **WHEN** a schema directory exists at `${XDG_DATA_HOME}/openspec/schemas/<name>/`
- **THEN** the system uses that directory instead of the built-in

#### Scenario: Built-in schema fallback
- **WHEN** no user override exists for a schema
- **THEN** the system uses the package built-in schema directory

#### Scenario: List available schemas
- **WHEN** listing schemas
- **THEN** the system returns schema names from both user and package directories

### Requirement: Extended Field Validation
The system SHALL validate that `context-from` references point to valid artifact IDs within the same schema and that the referenced artifact is in the declaring artifact's `requires` list.

#### Scenario: Valid context-from reference
- **WHEN** artifact "qa-report" has `context-from: "specs"` and `requires: ["specs"]`
- **THEN** schema validation passes

#### Scenario: context-from references non-existent artifact
- **WHEN** artifact has `context-from: "nonexistent"`
- **THEN** the system throws an error: "context-from 'nonexistent' references non-existent artifact"

#### Scenario: context-from without dependency
- **WHEN** artifact has `context-from: "specs"` but "specs" is not in its `requires` list
- **THEN** the system throws an error: "context-from 'specs' must be in the artifact's requires list"

