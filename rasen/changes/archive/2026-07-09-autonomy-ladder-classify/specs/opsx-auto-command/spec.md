## MODIFIED Requirements

### Requirement: Task Complexity Classification

The auto command SHALL classify the task and select a pipeline from the pipeline registry rather than from a hard-coded set of prose pipelines, following the resolved selection policy (see `autopilot-selection-policy`): under the default `manual` policy an explicit selection wins and the default is otherwise `small-feature` with classification advisory-only; under the opt-in `classify` policy the LEAD adopts the classification suggestion when no explicit selection is present, falling back to `small-feature` when classification is unavailable or unhelpful. In every policy the selection SHALL be displayed and the classification result SHALL be overridable by the user before execution.

#### Scenario: Classification selects a registry pipeline

- **WHEN** the user invokes `/rasen:auto` with a task description
- **THEN** auto SHALL classify the task (e.g. via `rasen pipeline classify "<task>" --json`) to a pipeline name resolved from the registry (`full-feature`, `small-feature`, `bug-fix`, or any user/project-defined pipeline)
- **AND** under the `classify` selection policy SHALL adopt that suggestion as the starting choice, while under the `manual` policy it remains advisory
- **AND** SHALL display the classification and allow the user to override it before proceeding

#### Scenario: New task types need no auto changes

- **WHEN** a new pipeline definition is added to the registry
- **THEN** auto SHALL be able to classify to and execute it without any change to the auto template or other source
