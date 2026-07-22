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

### Requirement: Gate policy is a mask over per-stage gate configuration

An ordinary gate for a `(pipeline, stage)` SHALL resolve with three-tier precedence: (1) a `pipelines.<name>.gates.<stage>` configuration instance, itself resolving project over store over global, decides that stage outright; (2) otherwise, an effective `autopilot.gates: off` suppresses the gate; (3) otherwise the stage definition's own `gate:` value decides. The effective `autopilot.gates` base SHALL keep its existing resolution — the run argument (`--no-gate`) first, then project config, then the inherited store config (when a store layer is active), then global config, then the built-in default of `on` — with its recorded source distinguishing `flag`, `project`, `store`, `global`, and `default`, and an absent or unrecognized value at any scope falling through without failing config parsing. `autopilot.gates: on` therefore means the stage definitions are honoured, not that every stage gates. A stage whose definition declares the always-pausing `'vet'` gate SHALL be outside this mask entirely, per the vet requirement of this capability. Run-state SHALL record the resolved base policy and source exactly as before — per-stage instances resolve live at each gate, never frozen into run-state — and run-states recorded before per-stage configuration existed SHALL parse unchanged. The LEAD SHALL learn each stage's effective gate from the pipeline inspection surface (which reports mask-resolved effective gates) rather than combining layers itself.

#### Scenario: Per-stage on pierces an off base

- **WHEN** `autopilot.gates: off` is effective and `pipelines.small-feature.gates.propose` is `on` at any scope
- **THEN** the `propose` stage of `small-feature` pauses while every other ordinary gate in the run is auto-approved

#### Scenario: Per-stage off silences one stage under an on base

- **WHEN** `autopilot.gates` resolves `on` and `pipelines.full-feature.gates.review` is `off` at project scope
- **THEN** the `review` stage's ordinary gate is auto-approved while other gated stages still pause per their definitions

#### Scenario: Per-stage instances rank project over store over global

- **WHEN** `pipelines.bug-fix.gates.apply` is `off` globally and `on` in the project's config
- **THEN** the stage gates on — the project instance wins within tier one

#### Scenario: Base resolution and sources are unchanged

- **WHEN** no per-stage instance exists for a stage and the base resolves from flag, project, store, or global configuration
- **THEN** the outcome and the recorded source (`flag`, `project`, `store`, `global`, or `default`) match the pre-mask behavior exactly, including `--no-gate` beating every config layer

#### Scenario: On means honour the definitions

- **WHEN** `autopilot.gates` resolves `on` and no per-stage instance exists
- **THEN** exactly the stages whose definitions declare a gate pause, and ungated stages run through — identical to today

#### Scenario: Unrecognized values fall through

- **WHEN** `autopilot.gates` or a per-stage instance holds a value other than `on`/`off` in any scope
- **THEN** parsing succeeds, the invalid value is ignored with a warning, and resolution falls to the next tier or layer

#### Scenario: Recorded run-state stays compatible

- **WHEN** a run's base gate policy resolved from the store layer is recorded and the run is later resumed after per-stage instances change
- **THEN** the recorded `gatePolicy` with source `store` reads back without error, and the resumed run's gates reflect the live per-stage instances

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
