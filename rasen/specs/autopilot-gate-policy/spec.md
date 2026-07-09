## ADDED Requirements

### Requirement: --no-gate auto-approves ordinary gates in autopilot

`/rasen:auto` SHALL accept a `--no-gate` argument. When it is present, ordinary gate stages (stages marked `gate: true`) SHALL be auto-approved: the autopilot proceeds past them without pausing for human Continue/Stop confirmation. When `--no-gate` is absent and no project default overrides it, gate stages SHALL pause for human confirmation exactly as they do today.

#### Scenario: Autopilot runs unattended with --no-gate

- **WHEN** a user runs `/rasen:auto --no-gate <task>` on a pipeline whose stages include `gate: true` gates
- **THEN** each ordinary gate is auto-approved and the workflow continues to the next stage without waiting for human input

#### Scenario: Gates still pause by default

- **WHEN** a user runs `/rasen:auto <task>` without `--no-gate` and no project gate default is set
- **THEN** each `gate: true` stage pauses and waits for the human to Continue, Stop, or switch to Manual

### Requirement: Project config sets a default gate policy with defined precedence

A project SHALL be able to declare a default autopilot gate policy in `rasen/config.yaml` under an `autopilot.gates` key with the values `on` (gates pause) or `off` (gates auto-approved). The effective policy SHALL resolve with precedence: the run argument (`--no-gate`) first, then the project config default, then the built-in default of gates ON. An absent or unrecognized `autopilot.gates` value SHALL fall back to the built-in default without failing config parsing.

#### Scenario: Config default is honored without the flag

- **WHEN** `rasen/config.yaml` declares `autopilot.gates: off` and the user runs `/rasen:auto <task>` without `--no-gate`
- **THEN** ordinary gates are auto-approved as if `--no-gate` were passed

#### Scenario: Run flag overrides config

- **WHEN** `rasen/config.yaml` declares `autopilot.gates: on` and the user runs `/rasen:auto --no-gate <task>`
- **THEN** ordinary gates are auto-approved (the run flag wins over the config default)

#### Scenario: Absent config falls back to gates on

- **WHEN** no `autopilot.gates` key is present and no `--no-gate` flag is passed
- **THEN** the effective policy is gates ON and gate stages pause

#### Scenario: Unrecognized config value does not break parsing

- **WHEN** `autopilot.gates` holds a value other than `on` or `off`
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, and the built-in default (gates ON) applies

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
