## ADDED Requirements

### Requirement: Runtime adapters declare independent capabilities

Rasen SHALL maintain one runtime adapter registry in which every runtime id declares independent context-probe, token-audit, and pipeline-dispatch capabilities. The shipped registry SHALL declare Claude and Codex capable of all three operations, and Zed capable of audit only.

#### Scenario: Shipped capability matrix is reported consistently

- **WHEN** a consumer requests the registered runtimes for context probing, token auditing, or pipeline dispatch
- **THEN** the probe set SHALL be `claude` and `codex`
- **AND** the audit set SHALL be `claude`, `codex`, and `zed`
- **AND** the dispatch set SHALL be `claude` and `codex`

#### Scenario: Capabilities remain independent

- **WHEN** a registered runtime supports token auditing but has no context-probe or pipeline-dispatch adapter
- **THEN** Rasen SHALL include it only in audit-capable runtime results
- **AND** SHALL reject it at probe and dispatch validation boundaries

### Requirement: Runtime eligibility derives from the required capability

Every Rasen surface that validates a context-probe, token-audit, or pipeline-dispatch runtime SHALL derive its accepted values from the corresponding registry capability. This contract SHALL cover CLI validation, core schemas and types, configuration-key enum metadata and parsing, management services, and management wire types; those surfaces SHALL present the same capability-specific runtime set.

#### Scenario: Context probe accepts only probe-capable runtimes

- **WHEN** a user selects a runtime for `rasen agent context`
- **THEN** Claude and Codex SHALL be accepted from the probe-capable registry set
- **AND** Zed or an unknown runtime SHALL be rejected with an actionable error naming the accepted probe runtimes

#### Scenario: Audit surfaces accept only audit-capable runtimes

- **WHEN** a runtime is selected through the audit CLI, native audit management service, report validation, or its management wire contract
- **THEN** Claude, Codex, and Zed SHALL be accepted from the audit-capable registry set
- **AND** an unknown runtime SHALL be rejected without preventing valid runtimes from remaining usable

#### Scenario: Pipeline surfaces accept only dispatch-capable runtimes

- **WHEN** a runtime is declared in pipeline YAML or written through `pipelines.<name>.runtimes.<role>`
- **THEN** Claude and Codex SHALL be accepted from the dispatch-capable registry set across schema, configuration, inspection, and wire surfaces
- **AND** Zed or an unknown runtime SHALL be rejected as not dispatch-capable

### Requirement: Registry-backed consumers preserve existing runtime behavior

Moving runtime eligibility to the registry SHALL preserve current command defaults, runtime detection, serialized values, configuration values, and runtime-specific processing. The registry SHALL select which runtime ids are valid; the existing probe readers, audit parsers/discoverers, and dispatch implementations SHALL continue to perform the runtime-specific work.

#### Scenario: Existing valid values round-trip unchanged

- **WHEN** existing context, audit, pipeline, configuration, or management API flows use a runtime that was valid before this change
- **THEN** the same runtime value SHALL be accepted and serialized unchanged
- **AND** the same runtime-specific implementation SHALL process it

#### Scenario: Runtime detection keeps its established fallback

- **WHEN** context or audit runtime detection receives no explicit override
- **THEN** existing filename, content, path, and default detection behavior SHALL remain unchanged
- **AND** the detected runtime SHALL still be checked against the capability required by that consumer

### Requirement: Adding an adapter has one capability source of truth

When shipped code adds a runtime adapter and marks one of its capabilities true, the corresponding derived type, value list, guard, schema choices, configuration metadata, and wire contract SHALL obtain that runtime from the registry without adding another consumer-owned allow-list. Runtime-specific parser, probe, or dispatch implementation lookup SHALL remain explicit and exhaustively checked.

#### Scenario: A future probe adapter becomes binding-eligible

- **WHEN** a future shipped runtime has a working context-probe adapter and its registry entry declares `canProbeContext`
- **THEN** probe-capable runtime consumers SHALL include it from the registry
- **AND** later runtime-binding validation can use the same probe-capable set without duplicating runtime names

#### Scenario: Registration does not fabricate an implementation

- **WHEN** a runtime-specific consumer needs to read a transcript, database, or process protocol
- **THEN** that consumer SHALL use an explicit implementation for the selected registered runtime
- **AND** SHALL NOT infer an implementation solely from the presence of a capability flag
