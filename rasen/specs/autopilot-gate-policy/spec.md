## Purpose

Define how the autopilot's ordinary human-confirmation gates (`gate: true`) resolve under an explicit unattended-run directive — the `--no-gate` flag and the `autopilot.gates` project config — including the recorded-decision audit trail and the `vet` gate exemption.

## Requirements

### Requirement: --no-gate auto-approves ordinary gates in autopilot

`/rasen-auto` SHALL accept a `--no-gate` argument. When it is present, ordinary gate stages (stages marked `gate: true`) SHALL be auto-approved: the autopilot proceeds past them without pausing for human Continue/Stop confirmation. When `--no-gate` is absent and no project default overrides it, gate stages SHALL pause for human confirmation exactly as they do today.

#### Scenario: Autopilot runs unattended with --no-gate

- **WHEN** a user runs `/rasen-auto --no-gate <task>` on a pipeline whose stages include `gate: true` gates
- **THEN** each ordinary gate is auto-approved and the workflow continues to the next stage without waiting for human input

#### Scenario: Gates still pause by default

- **WHEN** a user runs `/rasen-auto <task>` without `--no-gate` and no project gate default is set
- **THEN** each `gate: true` stage pauses and waits for the human to Continue, Stop, or switch to Manual

### Requirement: Gate policy is a mask over every stage gate

The gate for a `(pipeline, stage)` SHALL resolve with three-tier precedence: (1) a `pipelines.<name>.gates.<stage>` configuration instance, itself resolving project over store over global, decides that stage outright; (2) otherwise, an effective `autopilot.gates: off` suppresses the gate; (3) otherwise the stage definition's own `gate:` value decides. The effective `autopilot.gates` base SHALL keep its existing resolution — the run argument (`--no-gate`) first, then project config, then the inherited store config (when a store layer is active), then global config, then the built-in default of `on` — with its recorded source distinguishing `flag`, `project`, `store`, `global`, and `default`, and an absent or unrecognized value at any scope falling through without failing config parsing. `autopilot.gates: on` therefore means the stage definitions are honoured, not that every stage gates. Run-state SHALL record the resolved base policy and source exactly as before — per-stage instances resolve live at each gate, never frozen into run-state — and run-states recorded before per-stage configuration existed SHALL parse unchanged. The LEAD SHALL learn each stage's effective gate from the pipeline inspection surface (which reports mask-resolved effective gates) rather than combining layers itself.

#### Scenario: Per-stage on pierces an off base

- **WHEN** `autopilot.gates: off` is effective and `pipelines.goal-loop-measure.gates.define-goal` is `on` at any scope
- **THEN** the `define-goal` stage pauses while every other gate in the run is auto-approved

#### Scenario: Per-stage off silences one stage under an on base

- **WHEN** `autopilot.gates` resolves `on` and `pipelines.full-feature.gates.review` is `off` at project scope
- **THEN** the `review` stage's gate is auto-approved while other gated stages still pause per their definitions

#### Scenario: Per-stage instances rank project over store over global

- **WHEN** `pipelines.bug-fix.gates.apply` is `off` globally and `on` in the project's config
- **THEN** the stage gates on — the project instance wins within tier one

#### Scenario: Base resolution and sources are unchanged

- **WHEN** no per-stage instance exists for a stage and the base resolves from flag, project, store, or global configuration
- **THEN** the outcome and the recorded source (`flag`, `project`, `store`, `global`, or `default`) match the prior behavior exactly, including `--no-gate` beating every config layer

#### Scenario: On means honour the definitions

- **WHEN** `autopilot.gates` resolves `on` and no per-stage instance exists
- **THEN** exactly the stages whose definitions declare a gate pause, and ungated stages run through

#### Scenario: No stage is exempt from the mask

- **WHEN** a goal-loop pipeline runs under `--no-gate` with no per-stage instance set
- **THEN** every gate in the run, including `define-goal`, is auto-approved — no gate type exists that the mask cannot control

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

### Requirement: Legacy vet gate values read as ordinary gates

Boolean and absent gate declarations SHALL keep their exact meaning: `gate: true` pauses, `gate: false` and an omitted `gate` do not. A pipeline YAML stage declaring the legacy `gate: 'vet'` SHALL parse successfully as `gate: true`, with a warning emitted at most once per pipeline per process naming the pipeline and stage and pointing at `pipelines.<name>.gates.<stage>` as the per-stage control — never a parse error, so existing user libraries keep loading. The built-in pipeline definitions SHALL contain no `'vet'` gate. Pipeline inspection output SHALL report every stage's gate as a boolean.

#### Scenario: Boolean and absent gates are unchanged

- **WHEN** a pipeline YAML stage sets `gate: true`, `gate: false`, or omits `gate`
- **THEN** the stage parses with its existing meaning (pause, no-pause, and default no-pause respectively) and inspection reports the boolean value

#### Scenario: Legacy vet coerces with a one-time warning

- **WHEN** a user pipeline YAML stage still declares `gate: vet` and the pipeline is loaded twice in one process
- **THEN** the stage parses as `gate: true`, exactly one warning names the pipeline, the stage, and the per-stage configuration key, and no error is raised

#### Scenario: Built-ins carry no vet gate

- **WHEN** the built-in pipeline definitions are enumerated
- **THEN** no stage declares `'vet'`; the goal-loop `define-goal` stages declare `gate: true`
