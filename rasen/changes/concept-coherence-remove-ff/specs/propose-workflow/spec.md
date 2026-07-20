## REMOVED Requirements

### Requirement: Propose workflow combines new and ff

**Reason**: The `ff` workflow is being removed as a duplicate of `propose`. The requirement is replaced by an equivalent one that describes propose's own behavior without referencing `ff`.

The `propose` workflow SHALL perform the same operations as running `new` followed by `ff`.

## ADDED Requirements

### Requirement: Propose workflow creates the change and all artifacts

The `propose` workflow SHALL create the change and generate all artifacts required for implementation in one step, equivalent to creating the change (`new`) and then generating every remaining artifact in the schema's apply requirements.

#### Scenario: Change and artifacts created in one step

- **WHEN** user invokes `/rasen:propose "feature name"`
- **THEN** the change directory SHALL be created
- **AND** all artifacts required for implementation SHALL be generated
- **THEN** console output MAY include onboarding explanations
