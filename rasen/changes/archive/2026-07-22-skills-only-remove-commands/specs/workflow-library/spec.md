## ADDED Requirements

### Requirement: Workflow definitions carry no command surface
The command delivery surface is retired. A built-in or user-authored workflow definition SHALL NOT carry a `command` field, and no command template SHALL be registered for any workflow. A user-authored workflow package that still contains command content SHALL be accepted on install with that content ignored, rather than rejected.

#### Scenario: No built-in workflow registers a command template
- **WHEN** the built-in workflow definitions are enumerated
- **THEN** no definition SHALL expose a `command` field
- **AND** no command template SHALL be produced for any built-in workflow

#### Scenario: User package command content is ignored, not rejected
- **WHEN** a user-authored workflow package that still contains command content is installed
- **THEN** the install SHALL succeed
- **AND** the command content SHALL be ignored (only the skill surface is installed)

## MODIFIED Requirements

### Requirement: The `ff` workflow is not a built-in

The built-in workflow set SHALL NOT include a workflow with id `ff`. The `propose` workflow is the canonical entry point for generating a change and all its artifacts in one step; no built-in adapter or skill template for `ff` SHALL be registered.

#### Scenario: ff absent from the built-in registry

- **WHEN** the built-in workflow definitions are enumerated
- **THEN** no definition SHALL have id `ff`
- **AND** no built-in skill directory named `rasen-ff-change` SHALL be produced
