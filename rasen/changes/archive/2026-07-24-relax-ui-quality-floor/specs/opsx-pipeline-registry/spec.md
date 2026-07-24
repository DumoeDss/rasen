## MODIFIED Requirements

### Requirement: Pipeline Validation

`rasen validate` SHALL validate pipeline definitions for structural integrity. The optional `origin` field SHALL record provenance: `composed` identifies an autopilot-assembled definition and `ui` identifies a management-UI Canvas definition. Only `origin: composed` SHALL activate the mandatory quality floor.

#### Scenario: Structural rules enforced

- **WHEN** a pipeline is validated
- **THEN** validation SHALL fail if stage ids are not unique, if any `requires` references a missing stage, if the dependency graph contains a cycle, if a `skill` is not a registered skill, or if a `role` is unknown
- **AND** `parallelGroup` members SHALL be mutually independent in the DAG

#### Scenario: Composed quality floor enforced

- **WHEN** a pipeline declaring `origin: composed` is parsed or validated
- **THEN** it SHALL fail unless it contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`
- **AND** the failure message SHALL name the pipeline's `composed` origin

#### Scenario: UI origin records provenance without imposing the composed floor

- **WHEN** an otherwise valid pipeline declaring `origin: ui` is parsed or validated without a reviewer-role stage, a review-cycle loop, or both
- **THEN** it SHALL pass the quality-floor check
- **AND** its `ui` origin SHALL remain present in the parsed definition

#### Scenario: Origin-free pipelines remain unaffected

- **WHEN** an otherwise valid pipeline has no `origin` field and omits one or both quality-floor stages
- **THEN** it SHALL pass the quality-floor check and continue through every other validation rule unchanged
