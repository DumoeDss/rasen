## ADDED Requirements

### Requirement: MODIFIED reconciliation preserves the complete scenario inventory

Before replacing a canonical requirement from a `MODIFIED` delta, the sync workflow SHALL compare the replacement with the current requirement and require every scenario that should survive to remain present. Unchanged scenarios SHALL be carried forward verbatim, and a behavior edit SHALL retain the scenario heading unless the author explicitly intends removal plus addition. The workflow SHALL never describe a partial scenario block as additive merge behavior when the engine performs whole-requirement replacement.

#### Scenario: Partial modified block is refused

- **WHEN** a `MODIFIED` requirement omits a scenario present in the current canonical requirement
- **THEN** the workflow SHALL stop before writing and name the capability, requirement, and every omitted scenario
- **AND** it SHALL instruct the author to refresh the replacement block from the canonical requirement

#### Scenario: Adding one scenario retains existing scenarios

- **WHEN** the intended modification adds one scenario to an existing requirement
- **THEN** the replacement block SHALL contain the new scenario and every existing scenario that should survive
- **AND** synchronization SHALL replace the requirement without losing any retained scenario

#### Scenario: Behavior edit keeps the scenario heading

- **WHEN** the intended modification changes a current scenario's WHEN or THEN behavior
- **THEN** the workflow SHALL retain that scenario's existing heading and update its body
- **AND** it SHALL treat a heading change as an explicit old-scenario deletion and new-scenario addition
