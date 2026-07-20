## MODIFIED Requirements

### Requirement: Opt-in automatic pipeline selection with defined precedence

`/rasen:auto` SHALL accept an `--auto-select` argument and an `--auto-compose` argument, and a project SHALL be able to declare a default selection policy in `rasen/config.yaml` — with a machine SHALL be able to declare a default in the global config — under an `autopilot.selection` key with the values `classify` (the LEAD adopts the classification suggestion), `compose` (classify-first, with composition permitted when no registered pipeline fits — see `autopilot-composed-pipelines`), or `manual` (today's behavior: default `small-feature`, classification advisory-only). The effective policy SHALL resolve with precedence: the run arguments first — `--auto-compose` ahead of `--auto-select` when both are present — then the project config default, then the global config default, then the built-in default of `manual`. An absent or unrecognized `autopilot.selection` value at either scope SHALL fall back to the next layer without failing config parsing, and the resolved policy SHALL be displayed at run start with its source so an opted-in run is never silent about how it will pick a pipeline.

#### Scenario: Flag opts in for a single run

- **WHEN** a user runs `/rasen:auto --auto-select <task>` with no explicit pipeline selector
- **THEN** the effective selection policy is `classify` (source: flag) and the LEAD adopts the classification suggestion as the starting pipeline choice

#### Scenario: Compose flag opts into composition for a single run

- **WHEN** a user runs `/rasen:auto --auto-compose <task>` with no explicit pipeline selector
- **THEN** the effective selection policy is `compose` (source: flag)

#### Scenario: Compose flag wins when both flags are present

- **WHEN** a user runs `/rasen:auto --auto-compose --auto-select <task>`
- **THEN** the effective policy is `compose` (the superset policy wins; classification still runs first under it)

#### Scenario: Config default is honored without the flag

- **WHEN** `rasen/config.yaml` declares `autopilot.selection: classify` and the user runs `/rasen:auto <task>` without `--auto-select` and without an explicit pipeline selector
- **THEN** the LEAD adopts the classification suggestion as if `--auto-select` were passed

#### Scenario: Global default is honored when no project value is set

- **WHEN** the global config declares `autopilot.selection: classify`, the project sets no `autopilot.selection`, and the user runs `/rasen:auto <task>` without a selection flag or explicit selector
- **THEN** the LEAD adopts the classification suggestion, and the displayed policy identifies the global config as its source

#### Scenario: Project value wins over global

- **WHEN** the global config declares `autopilot.selection: classify` and the project config declares `autopilot.selection: manual`
- **THEN** the effective policy is `manual` (the project value wins over the global value)

#### Scenario: Run flag overrides config

- **WHEN** `rasen/config.yaml` declares `autopilot.selection: manual` and the user runs `/rasen:auto --auto-select <task>`
- **THEN** the effective policy is `classify` (the run flag wins over the config default)

#### Scenario: Default off leaves selection unchanged

- **WHEN** no `autopilot.selection` key is present in either scope and neither `--auto-select` nor `--auto-compose` is passed
- **THEN** the effective policy is `manual` and pipeline selection behaves exactly as before this capability existed: explicit selection wins, otherwise the default is `small-feature` and classification is advisory-only

#### Scenario: Unrecognized config value does not break parsing

- **WHEN** `autopilot.selection` holds a value other than `classify`, `compose`, or `manual` in either scope
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, sibling `autopilot` fields still parse, and resolution falls through to the next layer (built-in default `manual` when no valid value remains)
