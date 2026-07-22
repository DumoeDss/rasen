# autopilot-gate-policy Delta Specification

## REMOVED Requirements

### Requirement: Project config sets a default gate policy with defined precedence

**Reason**: The precedence chain gains a store layer between the project and global configs. Replaced by "Gate policy resolves across project, store, and global configuration".
**Migration**: Existing flag/project/global behavior is identical; a store layer applies only where a project declares `store:` beside local planning (see `store-config-inheritance`).

## ADDED Requirements

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
