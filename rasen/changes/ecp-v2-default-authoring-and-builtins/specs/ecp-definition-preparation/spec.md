# ecp-definition-preparation Specification Delta

## MODIFIED Requirements

### Requirement: Pipeline Definition v2 has one closed, typed language

Rasen SHALL accept a Pipeline Definition v2 envelope with stable definition and node identities, typed definition inputs, artifact outputs, and named outcomes. The root graph SHALL use only `AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`, `Gate`, and `Finish` nodes. Node kinds outside that closed vocabulary SHALL be rejected rather than treated as extension hooks. Every authored v2 `AtomicStage` SHALL declare a versioned execution contract containing its role and workspace access plus any authored verification or runtime-policy fields. Every authored v2 `Gate` SHALL target exactly one AtomicStage in the same graph and declare a closed outcome-to-`proceed | fail | escalate` disposition map; it SHALL be the sole authored gate authority and `AtomicStage.execution.gate` SHALL be rejected. Every authored v2 `BoundedLoop` SHALL include a complete shared lifecycle policy; missing execution or lifecycle fields SHALL NOT be supplied by compatibility payloads or runtime guesses.

#### Scenario: A complete v2 definition is accepted

- **WHEN** a version 2 definition has a stable source identity, unique stable node identities, compatible typed ports, complete AtomicStage execution declarations, complete bounded-loop lifecycle policies, and a root graph made from the closed vocabulary
- **THEN** preparation returns one normalized v2 definition with the declared inputs, artifacts, outcomes, execution meaning, lifecycle, and identities preserved

#### Scenario: An open-ended node kind is rejected

- **WHEN** a version 2 definition contains a node kind outside the closed vocabulary
- **THEN** preparation fails with an error diagnostic at that node's `kind` path
- **AND** the diagnostic does not offer arbitrary node-kind plug-ins as a fallback

#### Scenario: Incomplete v2 execution declaration fails closed

- **WHEN** an authored v2 AtomicStage omits workspace access or declares a role, verification policy, runtime, sandbox, reuse value, or retired `execution.gate` field outside the closed execution vocabulary
- **THEN** preparation reports every independent error under that node's execution path
- **AND** no execution policy or immutable plan is returned

#### Scenario: Gate node is the single runtime authority

- **WHEN** an authored Gate changes its target, identity, outcomes, or dispositions
- **THEN** the lowered runtime gate changes by exactly that authored meaning
- **AND** removing the Gate removes the runtime gate instead of falling back to AtomicStage metadata
- **AND** reconciliation admits `proceed`, terminates with `fail`, and terminates with `escalate` without collapsing either terminal disposition

#### Scenario: Authored v2 loop requires the shared lifecycle contract

- **WHEN** an authored v2 BoundedLoop omits or contradicts its complete `lifecycle.version: 1` policy
- **THEN** preparation fails at the lifecycle path
- **AND** v1 compatibility normalization is not used to repair the authored v2 source

## ADDED Requirements

### Requirement: Authored v2 serialization preserves semantic and capability identity

Rasen SHALL serialize newly authored v2 definitions through one canonical writer used by scaffold, save, export, and package staging. Re-reading the serialized definition with the same trusted capability catalog SHALL preserve the normalized definition and its semantic source, capability, and plan digests. Serialization SHALL be deterministic across Windows, Linux, and macOS, use UTF-8 with normalized line endings, and SHALL NOT rewrite an authored v1 source as authored v2.

#### Scenario: Canonical v2 round trip keeps all digests

- **WHEN** a valid authored v2 definition is serialized, saved, read, exported, imported, and prepared with the same capability catalog
- **THEN** every semantic field and the source, capability, and plan digests remain equal
- **AND** the packaged definition remains content version 2

#### Scenario: Formatting and host path style do not change semantics

- **WHEN** equivalent v2 YAML is processed on Windows and on a POSIX host with different input formatting or line endings
- **THEN** canonical serialization and preparation produce the same semantic and plan meaning
- **AND** file destinations are resolved with platform path APIs rather than embedded separators

#### Scenario: Compatibility source is not silently reauthored

- **WHEN** an authored v1 definition is prepared or exported through the same public seams
- **THEN** it remains an authored v1 definition with explicit compatibility preparation metadata
- **AND** its normalized v2 plan is never emitted as replacement authored source

### Requirement: Native v2 lowering consumes only typed authored contracts

The runtime profile and lowerer SHALL derive a native v2 node's capability, effective execution policy, workspace access, verification behavior, loop variant, parallel membership, and terminal routing from its validated v2 definition plus the ordinary configuration override layers. An authored v2 built-in SHALL NOT require `legacy`, `legacyStageId`, `legacyRuntimeOwner`, or pipeline-name inference to produce its execution plan.

#### Scenario: Authored execution metadata reaches the immutable plan

- **WHEN** a v2 AtomicStage declares a reviewer role, read-only workspace, adaptive verification, and authored reuse intent and a Gate node targets that stage
- **THEN** profile resolution and lowering preserve those facts with their correct provenance
- **AND** changing a semantic execution field changes the source or policy meaning used by the Run

#### Scenario: Typed goal and parallel metadata replace legacy inference

- **WHEN** an authored v2 built-in declares a GoalLoop variant or FanOut/Join membership and limits
- **THEN** preparation validates that metadata and lowering produces the corresponding goal or parallel runtime nodes
- **AND** neither the pipeline name nor a v1 compatibility payload is consulted to recover the missing meaning

### Requirement: Native v2 phase capabilities are semantically compatible

Every ReviewCycle and GoalLoop phase capability descriptor SHALL advertise the exact closed phase contract it implements. Preparation SHALL reject phase declarations whose capability contract, role, or workspace access is incompatible before lowering.

#### Scenario: Incompatible phase binding fails closed

- **WHEN** ReviewCycle fix is bound to a read-only review capability or GoalLoop judge is bound to a work capability
- **THEN** preparation reports `INVALID_LOWERING_METADATA` at the phase capability or execution path
- **AND** no immutable plan or Run is created
