# opsx-pipeline-registry Specification

## Purpose
Defines a data-driven registry of orchestration **pipelines** — ordered DAGs of stages that describe WHAT runs for a task type — mirroring how OpenSpec defines artifact schemas as data. Pipelines are extensible (package + user + project), surfaced via CLI as JSON, and validated. They carry no orchestration logic; HOW they run is owned by `opsx-orchestration`.

## ADDED Requirements

### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as data files at `pipelines/<name>/pipeline.yaml`, each an ordered DAG of stages, parsed and validated into typed objects through a loader that mirrors the artifact-graph schema loader.

#### Scenario: Pipeline file shape

- **WHEN** a `pipeline.yaml` is loaded
- **THEN** it SHALL declare a `name`, optional `description`, and a non-empty `stages` array
- **AND** each stage SHALL declare an `id` and a `skill`, and MAY declare `role`, `requires`, `gate`, `loop`, `parallelGroup`, `condition`, `leadReview`, and `verifyPolicy`
- **AND** parse or validation failures SHALL raise a typed error identifying the offending file and field

#### Scenario: Stages form a dependency DAG

- **WHEN** a pipeline declares stages with `requires` edges
- **THEN** the registry SHALL expose a stage build order via topological sort
- **AND** SHALL expose, for a set of completed stages, which stages are ready and which are blocked

### Requirement: Dual-Root Extensible Resolution

Pipelines SHALL resolve from package built-ins, a user directory, and a project directory using the same precedence OpenSpec uses for schemas (project ⊃ user ⊃ package).

#### Scenario: Project overrides user overrides package

- **WHEN** a pipeline `<name>` exists in more than one root
- **THEN** the project copy (`<projectRoot>/openspec/pipelines/<name>/pipeline.yaml`) SHALL win over the user copy (`${XDG_DATA_HOME}/openspec/pipelines/...`), which SHALL win over the package built-in
- **AND** listing SHALL report each resolved pipeline's `source` (`project` | `user` | `package`)

#### Scenario: Adding a task type requires only data

- **WHEN** a new pipeline definition file is added under any pipelines root
- **THEN** it SHALL become available to listing, show, classification, and orchestration with no change to TypeScript source

### Requirement: Pipeline CLI Surface

The system SHALL provide an `openspec pipeline` command group with `list`, `show <name>`, `classify "<task>"`, and `resume <change>` subcommands, each supporting `--json`.

#### Scenario: List and show

- **WHEN** `openspec pipeline list --json` runs
- **THEN** it SHALL print the resolved pipelines with name, description, and source
- **WHEN** `openspec pipeline show <name> --json` runs
- **THEN** it SHALL print the pipeline's full stage DAG including all stage metadata

#### Scenario: Classify

- **WHEN** `openspec pipeline classify "<task description>" --json` runs
- **THEN** it SHALL return a suggested pipeline name plus the indicators that drove the suggestion
- **AND** the suggestion SHALL be overridable by the caller

#### Scenario: Resume

- **WHEN** `openspec pipeline resume <change> --json` runs
- **THEN** it SHALL return the next incomplete stage and the remaining stages, derived from the change's artifacts and run-state

### Requirement: Pipeline Validation

`openspec validate` SHALL validate pipeline definitions for structural integrity.

#### Scenario: Structural rules enforced

- **WHEN** a pipeline is validated
- **THEN** validation SHALL fail if stage ids are not unique, if any `requires` references a missing stage, if the dependency graph contains a cycle, if a `skill` is not a registered skill, or if a `role` is unknown
- **AND** `parallelGroup` members SHALL be mutually independent in the DAG

### Requirement: Built-In Pipelines

The package SHALL ship built-in pipelines for the initial task types.

#### Scenario: Initial built-ins present

- **WHEN** no user or project pipelines are defined
- **THEN** `full-feature`, `small-feature`, and `bug-fix` SHALL resolve from the package
- **AND** they SHALL be included in the published package files
