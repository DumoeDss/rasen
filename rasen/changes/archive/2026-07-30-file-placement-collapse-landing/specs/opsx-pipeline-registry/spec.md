## MODIFIED Requirements

### Requirement: Pipeline CLI Surface

The system SHALL provide a `rasen pipeline` command group with `list`, `show <name>`, `agents <name>`, `classify "<task>"`, `resume <change>`, `init <name>`, `validate <name-or-path>`, `import <path>`, `export <name> <path>`, and `delete <name>` subcommands, each supporting `--json`. Every subcommand SHALL resolve its Rasen root through the shared root-selection layer used by `rasen validate` — the same nearest-root walk, implicit-root fallback, and `--store <id>` selector — so a given directory or store resolves to the identical root across `pipeline` and `validate`. No pipeline subcommand SHALL resolve its root from the current working directory alone. `resume` SHALL locate run-state per the `file-placement` capability's sticky-legacy chain: the execution root's ephemera directory is checked first, then the legacy machine-home work directory, then the change directory — and the JSON output SHALL report the directory the run-state (or portfolio state) was actually read from (`runStateDir`) so a resuming orchestrator writes updates where it read them. Locating run-state SHALL NOT write to the repository or the registry.

The `init`, `validate`, `import`, `export`, and `delete` subcommands SHALL mirror the corresponding `rasen workflow` verbs in behavior and UX: `init` scaffolds a minimal pipeline draft; `validate` runs structural pipeline validation; `import`/`export` round-trip a `.rasenpkg` pipeline package; `delete` removes a user pipeline subject to the refcount guard.

#### Scenario: List and show

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL print the resolved pipelines with name, description, and source
- **WHEN** `rasen pipeline show <name> --json` runs
- **THEN** it SHALL print the pipeline's full stage DAG including all stage metadata

#### Scenario: Classify

- **WHEN** `rasen pipeline classify "<task description>" --json` runs
- **THEN** it SHALL return a suggested pipeline name plus the indicators that drove the suggestion
- **AND** it SHALL report the suggestion's basis: `keyword` when indicators matched, `default` when the suggestion is the fallback default with no matched indicators
- **AND** the suggestion SHALL be overridable by the caller

#### Scenario: Resume

- **WHEN** `rasen pipeline resume <change> --json` runs
- **THEN** it SHALL return the next incomplete stage and the remaining stages, derived from the change's artifacts and run-state
- **AND** the run-state SHALL be read from the execution root's ephemera directory when present there, then the legacy machine-home work directory, then the change directory in the resolved root — never from the current working directory alone
- **AND** when run-state is found, the JSON SHALL include `runStateDir` naming the directory it was read from

#### Scenario: Resume reads legacy run-state

- **WHEN** `rasen pipeline resume <change> --json` runs for a change whose `auto-run.json` predates the ephemera directory and lives in the machine-home work directory or the change directory
- **THEN** it SHALL read that run-state (`hasRunState: true`) and report that legacy directory as `runStateDir`

#### Scenario: Root resolution matches validate

- **WHEN** `rasen pipeline list --json` and `rasen validate --pipelines --json` are run from the same subdirectory of a project, or with the same `--store <id>`
- **THEN** both SHALL resolve to the same Rasen root and report the same set of pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** `pipeline resume <change> --store <id>` SHALL read run-state per the same sticky-legacy chain (the execution root's ephemera directory, the legacy work directory, then the store's change directory) and report `hasRunState: true` when that change has recorded run-state

#### Scenario: Init and validate

- **WHEN** `rasen pipeline init <name> --output <dir>` runs
- **THEN** it SHALL scaffold a minimal valid `pipeline.yaml` draft at the output location without installing it
- **WHEN** `rasen pipeline validate <name-or-path>` runs
- **THEN** it SHALL apply the structural pipeline validation rules and report pass/fail

### Requirement: Resume distinguishes invalid run-state from absent run-state
`rasen pipeline resume` SHALL report a located-but-unparseable `auto-run.json` (malformed JSON, or schema validation failure after normalization) distinctly from the no-file case, so the failure is diagnosable instead of masquerading as "no run-state found". The JSON output SHALL keep `hasRunState: false` for both cases (additive compatibility) and, for the invalid case, SHALL additionally carry `invalidRunState: true`, the file path, and a note naming the validation reason.

#### Scenario: Invalid run-state file is reported with its reason
- **WHEN** `rasen pipeline resume <change> --json` locates an `auto-run.json` (via the ephemera-first sticky-legacy chain) that fails to parse even after host-tolerance normalization
- **THEN** the output SHALL report `hasRunState: false` and `invalidRunState: true`
- **AND** SHALL name the file path and the parse/validation reason in the note

#### Scenario: Absent run-state is unchanged
- **WHEN** `rasen pipeline resume <change> --json` finds no `auto-run.json` in any location of the chain
- **THEN** the output SHALL report `hasRunState: false` without `invalidRunState`, with the existing "no run-state" note
