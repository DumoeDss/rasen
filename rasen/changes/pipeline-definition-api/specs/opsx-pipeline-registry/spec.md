## MODIFIED Requirements

### Requirement: Data-Driven Pipeline Definitions

The system SHALL define pipelines as data files at `pipelines/<name>/pipeline.yaml`, each an ordered DAG of stages, parsed and validated into typed objects through a loader that mirrors the artifact-graph schema loader.

#### Scenario: Pipeline file shape

- **WHEN** a `pipeline.yaml` is loaded
- **THEN** it SHALL declare a `name`, optional `description`, and a non-empty `stages` array
- **AND** it MAY declare an `origin` field whose values are `composed` (a pipeline assembled by the autopilot LEAD) or `ui` (a pipeline assembled in the management UI's canvas); absent means human-authored; `rasen pipeline show` SHALL surface the field when present
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

#### Scenario: Origin-stamped quality floor enforced

- **WHEN** a pipeline declaring an `origin` (`composed` or `ui`) is parsed or validated
- **THEN** it SHALL fail unless it contains at least one stage with role `reviewer` and at least one stage with `loop.kind: review-cycle`, with the failure message naming the pipeline's actual origin value
- **AND** pipelines without an `origin` field SHALL be entirely unaffected by this rule — existing built-in, user, and project pipelines parse and validate unchanged

## ADDED Requirements

### Requirement: Pipeline save subcommand installs a definition into the user layer

The `rasen pipeline` command group SHALL provide `save <name> --from <file>` (with `--force` and `--json`), reading the file as a pipeline definition (JSON or YAML), validating it through the full structural chain plus the skill known/enabled checks, and installing it as the named USER pipeline, emitting canonical YAML. Without `--force` an existing user pipeline of that name SHALL be refused; a built-in name SHALL be refused regardless of `--force`. The subcommand SHALL preserve the definition's `origin` field verbatim and stamp none itself, and SHALL resolve its root through the same shared root-selection layer as every other pipeline subcommand. A definition saved and then read back (via `pipeline show` or export) SHALL be semantically identical to the input after loader normalization.

#### Scenario: Save installs a valid definition

- **WHEN** `rasen pipeline save my-pipe --from <absolute path to a valid definition file>` runs
- **THEN** the pipeline is installed under the user pipelines layer and `rasen pipeline list --json` reports it with source `user`

#### Scenario: Overwrite requires force, built-ins refused

- **WHEN** `save` targets an existing user pipeline without `--force`, or a built-in pipeline name with `--force`
- **THEN** the former is refused naming the overwrite flag and the latter is refused naming the built-in protection, and no file is modified in either case

#### Scenario: Invalid definition never installs

- **WHEN** `save` is given a definition failing any structural or skill rule
- **THEN** the command fails reporting the violation and the user layer is unchanged

#### Scenario: Round-trip fidelity

- **WHEN** a definition containing optional fields (agents, handoff, loop configuration, parallel groups) is saved and read back
- **THEN** every field survives with equal values after loader normalization
