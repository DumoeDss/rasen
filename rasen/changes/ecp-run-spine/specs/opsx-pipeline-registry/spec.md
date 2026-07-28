## MODIFIED Requirements

### Requirement: Pipeline CLI Surface

The system SHALL provide a `rasen pipeline` command group with `list`, `show
<name>`, `agents <name>`, `classify "<task>"`, `start <change>`, `status
<change>`, `resume <change>`, `complete <change>`, `control <change>`, `cancel
<change>`, `init <name>`, `validate <name-or-path>`, `import <path>`, `export
<name> <path>`, and `delete <name>` subcommands, each supporting `--json`.
Every subcommand SHALL resolve its Rasen root through the shared root-selection
layer used by `rasen validate` — the same nearest-root walk, implicit-root
fallback, `--store <id>` selector, and `--project <id>` selector — so a given
directory, store, or project resolves to the identical root across `pipeline`
and `validate`. No pipeline subcommand SHALL resolve its root from the current
working directory alone.
Reconciler commands SHALL derive PlanningSpaceId from the exact selected
registry home/root. `--project <id>` matching multiple clone homes SHALL fail
`project_selector_ambiguous` rather than choose registry order, and
`--planning-space <full-id>` SHALL provide exact selection.

`start` SHALL create a supported reconciler-owned Run from an exact Pipeline
name and Change and SHALL require a caller-stable `--launch-request-id`.
`status` SHALL inspect without advancing. `complete` SHALL
read a bounded typed action receipt from an explicit file or stdin; it SHALL
not accept a writable Record. `control` SHALL read one typed, version-checked
human control, and `cancel` SHALL be typed command-line sugar over that control.
The reconciler JSON result SHALL carry `engine: "reconciler"` and the shared
Change-run view; mutation receipts SHALL additionally carry disposition and
durably admitted actions.

`resume` SHALL first honor an explicitly named reconciler Run, or the Change's
single unambiguous active reconciler Run. When no reconciler Run is selected,
it SHALL retain its existing legacy behavior: locate `auto-run.json` per the
`change-work-dir` capability, compute next/remaining stages, check the external
work directory first, fall back to the Change directory, and report the
directory actually read (`runStateDir`). Locating or inspecting run state SHALL
NOT write to the repository or registry. A resume that advances a reconciler
Run MAY commit only through `ChangePipelineRuntime`.

The `init`, `validate`, `import`, `export`, and `delete` subcommands SHALL
mirror the corresponding `rasen workflow` verbs in behavior and UX: `init`
scaffolds a minimal Pipeline draft; `validate` runs structural Pipeline
validation; `import`/`export` round-trip a `.rasenpkg` Pipeline package;
`delete` removes a user Pipeline subject to the refcount guard.

#### Scenario: List and show

- **WHEN** `rasen pipeline list --json` runs
- **THEN** it SHALL print the resolved Pipelines with name, description, and source
- **WHEN** `rasen pipeline show <name> --json` runs
- **THEN** it SHALL print the Pipeline's full stage DAG including all stage
  metadata plus `availableEngines` and exact
  `reconcilerSupport { supported, reason, profileDigest }`
- **AND** support SHALL come from the same analyzer used by start, management,
  and Canvas rather than Pipeline-name inference

#### Scenario: Legacy normalization is not engine support

- **WHEN** a prepared Pipeline reports phase-1
  `capability.executionMode: legacy` or warning `LEGACY_NORMALIZED`
- **THEN** existing/default legacy behavior and warning compatibility remain
- **AND** reconciler availability is reported separately and may be unsupported
  with an exact reason

#### Scenario: Classify

- **WHEN** `rasen pipeline classify "<task description>" --json` runs
- **THEN** it SHALL return a suggested Pipeline name plus the indicators that drove the suggestion
- **AND** it SHALL report the suggestion's basis: `keyword` when indicators matched, `default` when the suggestion is the fallback default with no matched indicators
- **AND** the suggestion SHALL be overridable by the caller

#### Scenario: Start and status a reconciler Run

- **WHEN** `rasen pipeline start <change> --pipeline bug-fix
  --launch-request-id <stable-id> --json` starts a supported simple reconciler
  Run and `pipeline status <change> --run <id> --json` inspects it
- **THEN** start SHALL return the committed first action(s) and view
- **AND** status SHALL return the same canonical view without advancing the Record

#### Scenario: Start retry and conflict are explicit

- **WHEN** start is retried with the same launch request identity and canonical
  caller intent
- **THEN** it SHALL return the original Run and report idempotent reuse
- **AND** reusing that identity with different intent SHALL fail non-zero with
  `launch_request_conflict`

#### Scenario: Complete an admitted action

- **WHEN** `rasen pipeline complete <change> --run <id> --from <receipt-file>
  --json` receives a valid receipt for an admitted Action
- **THEN** it SHALL return the runtime's committed receipt and next admitted
  actions/view
- **AND** retrying the same file SHALL return idempotent success

#### Scenario: Control and cancel require an observed version

- **WHEN** `pipeline control` or `pipeline cancel` is submitted with the current
  expected Record version
- **THEN** it SHALL commit only a currently allowed control and return the new view
- **AND** a stale expected version SHALL fail non-zero without modifying the Run

#### Scenario: Reconciler resume

- **WHEN** `rasen pipeline resume <change> --run <id> --json` names a canonical reconciler Run
- **THEN** it SHALL resume from that Run's frozen plan and canonical Record
- **AND** it SHALL report admitted recovery actions, stable-sorted waits, or
  terminal state

#### Scenario: Reconciler resume first-claims deferred Actions

- **WHEN** an exact Run contains a stable admitted_undelivered frontier created
  by deferred management control
- **THEN** trusted CLI resume atomically commits granted and returns the
  executable Action payloads
- **AND** a concurrent second resume cannot perform another first claim and
  follows the sealed granted-action recovery policy

#### Scenario: Legacy resume

- **WHEN** `rasen pipeline resume <change> --json` runs with no selected
  reconciler Run
- **THEN** it SHALL return the next incomplete stage and remaining stages
  derived from the Change's artifacts and legacy run-state
- **AND** the run-state SHALL be read from the Change's work directory when
  present there, falling back to the Change directory in the resolved root —
  never from the current working directory
- **AND** when run-state is found, the JSON SHALL include `runStateDir` naming
  the directory it was read from

#### Scenario: Resume reads legacy run-state

- **WHEN** `rasen pipeline resume <change> --json` runs for a Change whose
  `auto-run.json` predates the work directory and lives in the Change directory
- **THEN** it SHALL read that run-state (`hasRunState: true`) and report the Change directory as `runStateDir`

#### Scenario: Active canonical owner never falls through to legacy

- **WHEN** `pipeline resume` finds an active canonical Run, with or without a
  concurrently active legacy file
- **THEN** it SHALL select the unique canonical owner or return the applicable
  ambiguity/engine-owner conflict
- **AND** it SHALL NOT invoke legacy resume while canonical ownership remains
  active

#### Scenario: Invalid canonical candidate blocks legacy fallback

- **WHEN** canonical Run storage is present but corrupt or unreadable and a
  legacy Run file is also available
- **THEN** `pipeline resume` SHALL return the canonical integrity error
- **AND** it SHALL NOT use the legacy file as an alternate progression path

#### Scenario: Ambiguous canonical selection fails safely

- **WHEN** resume or status omits `--run` and more than one active reconciler
  Run matches the Change
- **THEN** the command SHALL fail with `active_run_ambiguous` and list the exact
  candidate Run IDs
- **AND** it SHALL NOT fall through to legacy progression

#### Scenario: Root resolution matches validate

- **WHEN** `rasen pipeline list --json` and `rasen validate --pipelines --json`
  are run from the same project subdirectory or with the same `--store <id>` or
  `--project <id>`
- **THEN** both SHALL resolve to the same Rasen root and report the same set of Pipelines

#### Scenario: Store selection

- **WHEN** any `pipeline` subcommand is run with `--store <id>` naming a registered store
- **THEN** it SHALL operate on that store's root
- **AND** legacy `pipeline resume <change> --store <id>` SHALL read run-state
  from that Change's work directory (falling back to the store's Change
  directory) and report `hasRunState: true` when that Change has recorded run-state
- **AND** reconciler commands SHALL locate only the canonical Run store for that selected space

#### Scenario: Project selection

- **WHEN** a reconciler `pipeline` subcommand is run with `--project <id>`
  naming a registered project
- **THEN** its Change and canonical Run store SHALL resolve within that project
  rather than the current working directory

#### Scenario: Duplicate projectId is ambiguous for reconciler mutation

- **WHEN** two independent registered clones share projectId and a reconciler
  command uses only `--project <id>`
- **THEN** it fails `project_selector_ambiguous`, lists candidate
  PlanningSpaceIds in structured output, and writes neither clone
- **AND** `--planning-space <full-id>` or an exact root selects only that clone

#### Scenario: Receipt input is bounded and typed

- **WHEN** `complete --from` or `control --from` receives an oversized,
  unreadable, malformed, or schema-invalid body
- **THEN** the command SHALL fail before calling the runtime and SHALL NOT
  modify any Run Record

#### Scenario: Wait-scoped control carries exact identity

- **WHEN** `control --from` or resume targets one of multiple active waits
- **THEN** its closed body SHALL carry that WaitId and current Record version
- **AND** wrong/closed WaitId fails non-zero without advancing another wait

#### Scenario: Init and validate

- **WHEN** `rasen pipeline init <name> --output <dir>` runs
- **THEN** it SHALL scaffold a minimal valid `pipeline.yaml` draft at the output location without installing it
- **WHEN** `rasen pipeline validate <name-or-path>` runs
- **THEN** it SHALL apply the structural Pipeline validation rules and report pass/fail
