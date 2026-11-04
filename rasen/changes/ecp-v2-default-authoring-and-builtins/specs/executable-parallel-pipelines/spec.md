# executable-parallel-pipelines Specification Delta

## ADDED Requirements

### Requirement: full-feature authors its parallel graph natively in Definition v2

The package `full-feature` pipeline SHALL declare its condition evaluation, FanOut membership, required/optional semantics, concurrency cap, budget, Join target/outcomes, and downstream ReviewCycle directly in validated Definition v2. Preparation and lowering SHALL use those typed fields without v1 `parallelGroup`, `condition`, legacy payload, or pipeline-name inference.

#### Scenario: Full-feature native graph preserves the expert frontier

- **WHEN** the native v2 `full-feature` definition is prepared and lowered
- **THEN** the immutable plan contains the same expert members, required/optional classification, conditions, concurrency cap, budget, and collect-all Join behavior as the established Change-level pipeline
- **AND** the Join gates the downstream ReviewCycle

#### Scenario: Parallel metadata is path-addressed and fail closed

- **WHEN** a v2 full-feature-style definition has a missing member, inconsistent required/optional membership, invalid cap/budget, or mismatched Join reference
- **THEN** preparation reports deterministic diagnostics at the authored parallel paths
- **AND** no partial execution profile or Run is created

#### Scenario: Inspection and launch agree on parallel capabilities

- **WHEN** CLI/API inspection and launch process the native `full-feature` definition under the same configuration
- **THEN** FanOut evaluator and member capability paths, member roles/workspace access, Join semantics, and engine support agree
- **AND** the human execution view does not report a v1 normalization warning

### Requirement: Native full-feature serialization keeps its parallel plan meaning

Saving, detailing, exporting, packaging, and importing the native v2 `full-feature` definition SHALL preserve its condition, FanOut/Join, ReviewCycle, capabilities, and semantic plan digest across supported hosts.

#### Scenario: Cross-platform full-feature round trip

- **WHEN** the built-in is duplicated to a user definition, exported, and re-imported using Windows or POSIX paths
- **THEN** preparation returns an equivalent parallel execution view and plan digest
- **AND** no path separator or YAML key-order difference changes member identity or Join routing
