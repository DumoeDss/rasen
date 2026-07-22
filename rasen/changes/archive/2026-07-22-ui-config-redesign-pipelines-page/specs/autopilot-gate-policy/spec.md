# autopilot-gate-policy Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-store-scope` (W1) change's delta to this spec — W1 must archive before this change. The "A vet gate is never auto-approved" requirement is deliberately untouched here (its removal is the vet-removal child's scope); the mask defined below governs ordinary gates only.

## REMOVED Requirements

### Requirement: Gate policy resolves across project, store, and global configuration

**Reason**: `autopilot.gates` is redefined from a blanket switch into a mask base: per-stage gate configuration (`pipelines.<name>.gates.<stage>`) now outranks it, and `on` is defined as honouring stage definitions rather than gating everything. Replaced by "Gate policy is a mask over per-stage gate configuration".
**Migration**: Every existing behavior is preserved: the flag > project > store > global > default resolution of the base switch, the recorded sources including `store`, tolerant parsing, and run-state compatibility all carry over verbatim. New expressiveness only: a per-stage `on` can now pierce an `off` base.

## ADDED Requirements

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
