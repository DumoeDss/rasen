## MODIFIED Requirements

### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as data files at `pipelines/<name>/pipeline.yaml`, each an ordered DAG of stages, parsed and validated into typed objects through a loader that mirrors the artifact-graph schema loader.

#### Scenario: Pipeline file shape

- **WHEN** a `pipeline.yaml` is loaded
- **THEN** it SHALL declare a `name`, optional `description`, and a non-empty `stages` array
- **AND** it MAY declare an `origin` field whose only value is `composed`, marking a pipeline assembled by the autopilot LEAD (absent means human-authored); `rasen pipeline show` SHALL surface the field when present
- **AND** each stage SHALL declare an `id` and a `skill`, and MAY declare `role`, `requires`, `gate`, `loop`, `parallelGroup`, `condition`, `leadReview`, and `verifyPolicy`
- **AND** parse or validation failures SHALL raise a typed error identifying the offending file and field

#### Scenario: Stages form a dependency DAG

- **WHEN** a pipeline declares stages with `requires` edges
- **THEN** the registry SHALL expose a stage build order via topological sort
- **AND** SHALL expose, for a set of completed stages, which stages are ready and which are blocked

### Requirement: Pipeline Validation

`rasen validate` SHALL validate pipeline definitions for structural integrity.

#### Scenario: Structural rules enforced

- **WHEN** a pipeline is validated
- **THEN** validation SHALL fail if stage ids are not unique, if any `requires` references a missing stage, if the dependency graph contains a cycle, if a `skill` is not a registered skill, or if a `role` is unknown
- **AND** `parallelGroup` members SHALL be mutually independent in the DAG

#### Scenario: Composed-pipeline quality floor enforced

- **WHEN** a pipeline declaring `origin: composed` is parsed or validated
- **THEN** it SHALL fail unless it contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`
- **AND** pipelines without an `origin` field SHALL be entirely unaffected by this rule — existing built-in, user, and project pipelines parse and validate unchanged
