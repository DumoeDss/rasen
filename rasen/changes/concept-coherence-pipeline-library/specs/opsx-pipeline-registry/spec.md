## MODIFIED Requirements

### Requirement: Pipeline CLI Surface

The system SHALL provide a `rasen pipeline` command group with `list`, `show <name>`, `agents <name>`, `classify "<task>"`, `resume <change>`, `init <name>`, `validate <name-or-path>`, `import <path>`, `export <name> <path>`, and `delete <name>` subcommands, each supporting `--json`. Every subcommand SHALL resolve its Rasen root through the shared root-selection layer used by `rasen validate` — the same nearest-root walk, implicit-root fallback, and `--store <id>` selector — so a given directory or store resolves to the identical root across `pipeline` and `validate`. No pipeline subcommand SHALL resolve its root from the current working directory alone. `resume` SHALL locate run-state per the `change-work-dir` capability: the change's external work directory is checked first, falling back to the change directory, and the JSON output SHALL report the directory the run-state (or portfolio state) was actually read from (`runStateDir`) so a resuming orchestrator writes updates where it read them. Locating run-state SHALL NOT write to the repository or the registry.

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
- **AND** the run-state SHALL be read from the change's work directory when present there, falling back to the change directory in the resolved root — never from the current working directory
- **AND** when run-state is found, the JSON SHALL include `runStateDir` naming the directory it was read from

#### Scenario: Resume reads legacy run-state

- **WHEN** `rasen pipeline resume <change> --json` runs for a change whose `auto-run.json` predates the work directory and lives in the change directory
- **THEN** it SHALL read that run-state (`hasRunState: true`) and report the change directory as `runStateDir`

#### Scenario: Root resolution matches validate

- **WHEN** `rasen pipeline list --json` and `rasen validate --pipelines --json` are run from the same subdirectory of a project, or with the same `--store <id>`
- **THEN** both SHALL resolve to the same Rasen root and report the same set of pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** `pipeline resume <change> --store <id>` SHALL read run-state from that change's work directory (falling back to the store's change directory) and report `hasRunState: true` when that change has recorded run-state

#### Scenario: Init and validate

- **WHEN** `rasen pipeline init <name> --output <dir>` runs
- **THEN** it SHALL scaffold a minimal valid `pipeline.yaml` draft at the output location without installing it
- **WHEN** `rasen pipeline validate <name-or-path>` runs
- **THEN** it SHALL apply the structural pipeline validation rules and report pass/fail

## ADDED Requirements

### Requirement: Pipeline packages

A `.rasenpkg` package SHALL support a `pipeline` kind that carries one or more pipelines, each as `{ name, digest, files }` where `files` includes the pipeline's `pipeline.yaml`. Packaging and importing a pipeline SHALL reuse the transactional install machinery used for workflow and profile packages: import SHALL stage to a temporary location, re-verify each pipeline's digest after staging, and atomically install into the user pipeline layer, rolling back completely on any failure. Import SHALL display the package's provenance (source path) and the verified digest, and SHALL surface them in `--json`. Pipeline packages SHALL install only into the user layer; the project layer SHALL remain file-based. Structural validation of an imported pipeline SHALL accept skill references in both `rasen-<name>` and `rasen:<name>` forms.

#### Scenario: Round-trip a user pipeline

- **WHEN** a user exports a user pipeline to a `.rasenpkg` and imports it on another machine
- **THEN** the pipeline SHALL be installed into the user pipeline layer with its content preserved
- **AND** the import SHALL report the source path and verified digest

#### Scenario: Import rejects a tampered package

- **WHEN** a pipeline package's contents do not match its recorded digest
- **THEN** import SHALL fail and install nothing

#### Scenario: Wrong-kind package rejected

- **WHEN** `rasen pipeline import <path>` is given a workflow or profile package
- **THEN** import SHALL fail with a kind-mismatch error

### Requirement: Pipeline delete refcount guard

`rasen pipeline delete` SHALL, by default, refuse to delete a user pipeline that is still referenced — by any installed workflow's `requires.pipelines`, or by another pipeline's `decompose` `childPipeline` — and SHALL name the referrers. Package-layer (built-in) pipelines SHALL never be deletable regardless of any flag. A `--force` flag SHALL bypass only the referrer guard: the delete proceeds, a warning naming every dangling referrer SHALL be emitted, and the forced referrers SHALL be reported in `--json`. Confirmation SHALL still be required in non-interactive mode.

#### Scenario: Delete refused when referenced

- **WHEN** a user runs `rasen pipeline delete <name>` without `--force` and the pipeline is referenced by a workflow's `requires.pipelines` or another pipeline's `childPipeline`
- **THEN** the deletion SHALL be refused with an error naming the referrers

#### Scenario: Force override deletes and warns

- **WHEN** a user runs `rasen pipeline delete <name> --force` (with confirmation) and the pipeline is referenced
- **THEN** the pipeline SHALL be deleted and a warning naming every dangling referrer SHALL be emitted

#### Scenario: Built-in pipeline never deleted

- **WHEN** a user runs `rasen pipeline delete <built-in-name> --force`
- **THEN** the deletion SHALL be refused because package-layer pipelines cannot be deleted

### Requirement: Package version gating

A `.rasenpkg` package MAY declare an optional `minRasenVersion`. When decoding any package, the reader SHALL check the package's format version and `minRasenVersion` before strict schema validation, and SHALL reject — with a clear, actionable message naming the required version — any package whose format version exceeds the supported version or whose `minRasenVersion` is newer than the running CLI. The running CLI version SHALL be read from the package metadata (version-agnostic), not hard-coded. Packages within the supported range SHALL import normally.

#### Scenario: Package newer than the CLI is rejected clearly

- **WHEN** a package declares a `minRasenVersion` newer than the running CLI
- **THEN** decoding SHALL fail with a message stating the required version and that the CLI should be upgraded
- **AND** nothing SHALL be installed

#### Scenario: Supported package imports normally

- **WHEN** a package declares a `minRasenVersion` at or below the running CLI version (or omits it)
- **THEN** decoding SHALL proceed to normal validation and import
