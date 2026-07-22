# autopilot-gate-policy Delta Specification

> Stacked delta: the third REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-pipelines-page` (W3) change's delta to this spec — W3 must archive before this change. The first two REMOVED requirements are current main-spec text no sibling touches.

## REMOVED Requirements

### Requirement: A vet gate is never auto-approved

**Reason**: The vet carve-out was a blunt instrument from before per-stage gate control existed — a gate no configuration could ever auto-approve. With the gate mask, every stage's gate is individually visible and controllable, so the special type is retired and `define-goal` becomes an ordinary default-on gate. Consequence, chosen deliberately: under `autopilot.gates: off`, a goal-loop's `define-goal` — including an arbitrary-shell measure command — can now be auto-approved and run unattended up to `maxRounds`.
**Migration**: The built-in goal-loop pipelines change `define-goal` to `gate: true` (pauses by default, exactly as before under the default policy). A user who runs with `autopilot.gates: off` and wants the old always-pause behavior for a stage sets `pipelines.<name>.gates.<stage>: on` — one value restores the pause. User YAML still carrying `gate: vet` is read per "Legacy vet gate values read as ordinary gates".

### Requirement: Existing boolean gate configuration parses unchanged

**Reason**: This requirement guarantees backward compatibility for *widening* the gate field to accept `'vet'`; the field now narrows back to boolean, inverting the compatibility obligation. Replaced by "Legacy vet gate values read as ordinary gates".
**Migration**: Boolean and absent gates keep their exact meaning; the `'vet'` literal moves from a distinct accepted value to a coerced legacy spelling of `true`.

### Requirement: Gate policy is a mask over per-stage gate configuration

**Reason**: The mask's text carves stages with the always-pausing `'vet'` gate out of the mask; with the vet type retired there is no unmaskable gate. Replaced by "Gate policy is a mask over every stage gate", which differs from W3's text in four ways, all consequences of removing the vet type: (1) the vet-exemption sentence ("A stage whose definition declares the always-pausing `'vet'` gate SHALL be outside this mask entirely…") is dropped; (2) gates are no longer qualified as "ordinary" (there is no non-ordinary gate to distinguish from), and the "pre-mask"/"identical to today" phrasings become "prior"/plain since the prior behavior is now this one; (3) the "Per-stage on pierces an off base" scenario's example re-points from `small-feature`/`propose` to `goal-loop-measure`/`define-goal` — the stage the vet removal actually affects; and (4) a new "No stage is exempt from the mask" scenario is added, asserting that `define-goal` under `--no-gate` is auto-approved like every other gate. Every other clause carries over verbatim.
**Migration**: Mask precedence, base resolution, sources, tolerant parsing, and run-state compatibility are all unchanged; the only difference is that no stage is exempt from the mask.

## ADDED Requirements

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
