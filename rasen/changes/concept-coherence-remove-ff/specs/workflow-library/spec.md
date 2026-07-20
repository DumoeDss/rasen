## ADDED Requirements

### Requirement: The `ff` workflow is not a built-in

The built-in workflow set SHALL NOT include a workflow with id `ff`. The `propose` workflow is the canonical entry point for generating a change and all its artifacts in one step; no built-in adapter, skill template, or command template for `ff` SHALL be registered.

#### Scenario: ff absent from the built-in registry

- **WHEN** the built-in workflow definitions are enumerated
- **THEN** no definition SHALL have id `ff`
- **AND** no built-in skill directory named `rasen-ff-change` SHALL be produced

### Requirement: Stored workflow selections tolerate unknown ids

When a stored workflow selection read from global config (a `custom` profile's workflow list) references a workflow id that is not present in the current catalog, resolution of that stored selection SHALL drop the unknown id with a warning rather than failing. This tolerance applies to selections read from persisted configuration; explicitly authored named-profile files retain strict validation with immediate errors.

#### Scenario: Stored selection lists a retired id

- **WHEN** a stored `custom` profile selection lists an id (such as a retired `ff`) that is not in the catalog
- **THEN** the unknown id SHALL be dropped from the resolved selection
- **AND** a warning naming the dropped id SHALL be emitted
- **AND** resolution SHALL succeed for the remaining known ids
