## Purpose

Define how the autopilot's ordinary human-confirmation gates (`gate: true`) resolve under an explicit unattended-run directive — the `--no-gate` flag and the `autopilot.gates` project config — including the recorded-decision audit trail and the `vet` gate exemption.

## Requirements

### Requirement: --no-gate auto-approves ordinary gates in autopilot

`/rasen:auto` SHALL accept a `--no-gate` argument. When it is present, ordinary gate stages (stages marked `gate: true`) SHALL be auto-approved: the autopilot proceeds past them without pausing for human Continue/Stop confirmation. When `--no-gate` is absent and no project default overrides it, gate stages SHALL pause for human confirmation exactly as they do today.

#### Scenario: Autopilot runs unattended with --no-gate

- **WHEN** a user runs `/rasen:auto --no-gate <task>` on a pipeline whose stages include `gate: true` gates
- **THEN** each ordinary gate is auto-approved and the workflow continues to the next stage without waiting for human input

#### Scenario: Gates still pause by default

- **WHEN** a user runs `/rasen:auto <task>` without `--no-gate` and no project gate default is set
- **THEN** each `gate: true` stage pauses and waits for the human to Continue, Stop, or switch to Manual

### Requirement: Gate policy resolves across project, store, and global configuration

A project SHALL be able to declare a default autopilot gate policy in `rasen/config.yaml` under an `autopilot.gates` key, a store SHALL be able to declare the same key in its own config for its inheriting member projects, and a machine SHALL be able to declare a default in the global config, with the values `on` (gates pause) or `off` (gates auto-approved). The effective policy SHALL resolve with precedence: the run argument (`--no-gate`) first, then the project config default, then the inherited store config default (when a store layer is active), then the global config default, then the built-in default of gates ON. The resolved policy's recorded source SHALL distinguish `flag`, `project`, `store`, `global`, and `default`. An absent or unrecognized `autopilot.gates` value at any scope SHALL fall back to the next layer without failing config parsing.

#### Scenario: Config default is honored without the flag

- **WHEN** `rasen/config.yaml` declares `autopilot.gates: off` and the user runs `/rasen:auto <task>` without `--no-gate`
- **THEN** ordinary gates are auto-approved as if `--no-gate` were passed

#### Scenario: Store default is honored when no project value is set

- **WHEN** a project inherits configuration from a store whose config declares `autopilot.gates: off`, the project sets no `autopilot.gates`, and the user runs `/rasen:auto <task>` without `--no-gate`
- **THEN** ordinary gates are auto-approved, and the resolved policy identifies the store config as its source

#### Scenario: Project value wins over store and global

- **WHEN** the inherited store's config declares `autopilot.gates: off`, the global config declares `autopilot.gates: off`, and the project config declares `autopilot.gates: on`
- **THEN** the effective policy is gates ON with source `project`

#### Scenario: Store value wins over global

- **WHEN** the inherited store's config declares `autopilot.gates: on` and the global config declares `autopilot.gates: off`, with no project value and no flag
- **THEN** the effective policy is gates ON with source `store`

#### Scenario: Global default is honored when no project or store value is set

- **WHEN** the global config declares `autopilot.gates: off`, neither the project nor an active store layer sets `autopilot.gates`, and the user runs without `--no-gate`
- **THEN** ordinary gates are auto-approved with the global config identified as the source

#### Scenario: Run flag overrides config

- **WHEN** any combination of project, store, and global configs declare `autopilot.gates: on` and the user runs `/rasen:auto --no-gate <task>`
- **THEN** ordinary gates are auto-approved (the run flag wins over every config layer)

#### Scenario: Absent config falls back to gates on

- **WHEN** no `autopilot.gates` key is present in the project, store, or global config and no `--no-gate` flag is passed
- **THEN** the effective policy is gates ON and gate stages pause

#### Scenario: Unrecognized config value does not break parsing

- **WHEN** `autopilot.gates` holds a value other than `on` or `off` in any scope
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, and resolution falls through to the next layer

#### Scenario: Recorded run-state accepts the store source

- **WHEN** a run's gate policy resolved from the store layer is recorded in run-state and the run is later resumed
- **THEN** the recorded `gatePolicy` with source `store` reads back without error, and run-states recorded before this capability existed still parse unchanged

### Requirement: Auto-approved gates are recorded and survive resume

An auto-approved gate SHALL be recorded in the change's run-state with an explicit decision indicating it was auto-approved (rather than deleted or silently skipped). The resolved gate policy SHALL be persisted in run-state so that resuming the change reads the policy from run-state and the user does NOT re-pass `--no-gate` on resume.

#### Scenario: Skipped gate leaves an audit entry

- **WHEN** an ordinary gate is auto-approved under `--no-gate`
- **THEN** run-state records a gate decision marking it auto-approved (identifying the policy source, e.g. `--no-gate`)
- **AND** the audit trail shows the stage advanced by auto-approval, not by a human Continue

#### Scenario: Resume honors the recorded policy

- **WHEN** a run started with `--no-gate` is resumed later without re-passing the flag
- **THEN** the resumed run reads the gate policy from run-state and continues to auto-approve ordinary gates

### Requirement: A vet gate is never auto-approved

A pipeline stage SHALL be able to mark its gate as `gate: 'vet'` to indicate a human MUST vet the stage. A `vet` gate SHALL always pause for human confirmation and SHALL never be auto-approved by `--no-gate` or by an `autopilot.gates: off` project default. This precedence SHALL also hold for a decomposed portfolio's child-pipeline gates: a parent `--no-gate` directive auto-approves ordinary child gates but never a child `vet` gate.

#### Scenario: Vet gate pauses even under --no-gate

- **WHEN** a pipeline has a stage marked `gate: 'vet'` and the user runs `/rasen:auto --no-gate <task>`
- **THEN** the `vet` stage still pauses and waits for explicit human confirmation before proceeding

#### Scenario: Goal-loop define-goal is vetted before any round

- **WHEN** a goal-loop pipeline runs under `--no-gate` and its `define-goal` stage is marked `gate: 'vet'`
- **THEN** the human still confirms the goal and the measure/evaluate configuration (including any arbitrary-shell measure command) before the first iterate round runs

#### Scenario: Child vet gate is not skipped by parent directive

- **WHEN** a decomposed run under `--no-gate` produces child pipelines that contain a `gate: 'vet'` stage
- **THEN** the parent auto-approve directive applies to ordinary child gates but the child `vet` gate still pauses

### Requirement: Existing boolean gate configuration parses unchanged

Widening the stage `gate` field to accept `'vet'` SHALL be backward compatible: existing pipeline YAML using `gate: true`, `gate: false`, or omitting `gate` SHALL parse and behave exactly as before, and the pipeline inspection output (`rasen pipeline show`) SHALL continue to report each stage's gate value.

#### Scenario: Boolean and absent gates are unchanged

- **WHEN** a pipeline YAML stage sets `gate: true`, `gate: false`, or omits `gate`
- **THEN** the stage parses successfully with its existing meaning (pause, no-pause, and default no-pause respectively)
- **AND** `rasen pipeline show --json` reports the stage's gate value (`true`, `false`, or `'vet'`) without error
