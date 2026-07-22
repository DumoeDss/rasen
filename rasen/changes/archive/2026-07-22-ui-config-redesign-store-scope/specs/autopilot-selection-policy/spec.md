# autopilot-selection-policy Delta Specification

## REMOVED Requirements

### Requirement: Opt-in automatic pipeline selection with defined precedence

**Reason**: The precedence chain gains a store layer between the project and global configs. Replaced by "Opt-in automatic pipeline selection across project, store, and global configuration".
**Migration**: Existing flag/project/global behavior is identical; a store layer applies only where a project declares `store:` beside local planning (see `store-config-inheritance`).

## ADDED Requirements

### Requirement: Opt-in automatic pipeline selection across project, store, and global configuration

`/rasen:auto` SHALL accept an `--auto-select` argument and an `--auto-compose` argument, and a default selection policy SHALL be declarable under an `autopilot.selection` key in the project config, in an inheriting store's config, and in the global config, with the values `classify` (the LEAD adopts the classification suggestion), `compose` (classify-first, with composition permitted when no registered pipeline fits — see `autopilot-composed-pipelines`), or `manual` (today's behavior: default `small-feature`, classification advisory-only). The effective policy SHALL resolve with precedence: the run arguments first — `--auto-compose` ahead of `--auto-select` when both are present — then the project config default, then the inherited store config default (when a store layer is active), then the global config default, then the built-in default of `manual`. An absent or unrecognized `autopilot.selection` value at any scope SHALL fall back to the next layer without failing config parsing, and the resolved policy SHALL be displayed at run start with its source (`flag`, `project`, `store`, `global`, or `default`) so an opted-in run is never silent about how it will pick a pipeline.

#### Scenario: Flag opts in for a single run

- **WHEN** a user runs `/rasen:auto --auto-select <task>` with no explicit pipeline selector
- **THEN** the effective selection policy is `classify` (source: flag) and the LEAD adopts the classification suggestion as the starting pipeline choice

#### Scenario: Compose flag wins when both flags are present

- **WHEN** a user runs `/rasen:auto --auto-compose --auto-select <task>`
- **THEN** the effective policy is `compose` (the superset policy wins; classification still runs first under it)

#### Scenario: Config default is honored without the flag

- **WHEN** `rasen/config.yaml` declares `autopilot.selection: classify` and the user runs `/rasen:auto <task>` without a selection flag or explicit selector
- **THEN** the LEAD adopts the classification suggestion as if `--auto-select` were passed

#### Scenario: Store default is honored when no project value is set

- **WHEN** a project inherits configuration from a store whose config declares `autopilot.selection: classify`, the project sets no `autopilot.selection`, and the user runs without a selection flag or explicit selector
- **THEN** the LEAD adopts the classification suggestion, and the displayed policy identifies the store config as its source

#### Scenario: Project value wins over store and global

- **WHEN** the inherited store's config declares `autopilot.selection: classify` and the project config declares `autopilot.selection: manual`
- **THEN** the effective policy is `manual` (the project value wins over the store value)

#### Scenario: Store value wins over global

- **WHEN** the inherited store's config declares `autopilot.selection: compose` and the global config declares `autopilot.selection: classify`, with no project value and no flags
- **THEN** the effective policy is `compose` with source `store`

#### Scenario: Global default is honored when no project or store value is set

- **WHEN** the global config declares `autopilot.selection: classify` and neither the project nor an active store layer sets `autopilot.selection`
- **THEN** the LEAD adopts the classification suggestion, and the displayed policy identifies the global config as its source

#### Scenario: Run flag overrides config

- **WHEN** any config layer declares `autopilot.selection: manual` and the user runs `/rasen:auto --auto-select <task>`
- **THEN** the effective policy is `classify` (the run flag wins over every config layer)

#### Scenario: Default off leaves selection unchanged

- **WHEN** no `autopilot.selection` key is present in any scope and neither `--auto-select` nor `--auto-compose` is passed
- **THEN** the effective policy is `manual` and pipeline selection behaves exactly as before this capability existed

#### Scenario: Unrecognized config value does not break parsing

- **WHEN** `autopilot.selection` holds a value other than `classify`, `compose`, or `manual` in any scope
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, sibling `autopilot` fields still parse, and resolution falls through to the next layer
