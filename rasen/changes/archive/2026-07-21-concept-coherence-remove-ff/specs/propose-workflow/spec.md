<!-- Reconciled at archive time: the implementation commit (0ddaa6d) applied this
     rename directly to the main spec during apply, so the original REMOVED("Propose
     workflow combines new and ff")+ADDED pair had already been absorbed into main and
     the REMOVED header no longer exists to remove. Rewritten as an idempotent MODIFIED
     over the current header so the archive sync is a no-op overwrite. -->
## MODIFIED Requirements

### Requirement: Propose workflow creates the change and all artifacts

The `propose` workflow SHALL create the change and generate all artifacts required for implementation in one step, equivalent to creating the change (`new`) and then generating every remaining artifact in the schema's apply requirements.

#### Scenario: Change and artifacts created in one step

- **WHEN** user invokes `/rasen:propose "feature name"`
- **THEN** the change directory SHALL be created
- **AND** all artifacts required for implementation SHALL be generated
- **THEN** console output MAY include onboarding explanations
