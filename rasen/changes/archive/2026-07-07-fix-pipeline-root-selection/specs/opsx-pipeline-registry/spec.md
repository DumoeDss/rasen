## MODIFIED Requirements

### Requirement: Pipeline CLI Surface

The system SHALL provide an `openspec pipeline` command group with `list`, `show <name>`, `agents <name>`, `classify "<task>"`, and `resume <change>` subcommands, each supporting `--json`. Every subcommand SHALL resolve its OpenSpec root through the shared root-selection layer used by `openspec validate` — the same nearest-root walk, implicit-root fallback, and `--store <id>` selector — so a given directory or store resolves to the identical root across `pipeline` and `validate`. No pipeline subcommand SHALL resolve its root from the current working directory alone.

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
- **AND** the change and its run-state SHALL be read from the resolved root's changes directory, not from the current working directory

#### Scenario: Root resolution matches validate

- **WHEN** `openspec pipeline list --json` and `openspec validate --pipelines --json` are run from the same subdirectory of a project, or with the same `--store <id>`
- **THEN** both SHALL resolve to the same OpenSpec root and report the same set of pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** `pipeline resume <change> --store <id>` SHALL read run-state from the store's change directory and report `hasRunState: true` when that change has recorded run-state
