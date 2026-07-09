## MODIFIED Requirements

### Requirement: Opt-in automatic pipeline selection with defined precedence

`/rasen:auto` SHALL accept an `--auto-select` argument and an `--auto-compose` argument, and a project SHALL be able to declare a default selection policy in `rasen/config.yaml` under an `autopilot.selection` key with the values `classify` (the LEAD adopts the classification suggestion), `compose` (classify-first, with composition permitted when no registered pipeline fits — see `autopilot-composed-pipelines`), or `manual` (today's behavior: default `small-feature`, classification advisory-only). The effective policy SHALL resolve with precedence: the run arguments first — `--auto-compose` ahead of `--auto-select` when both are present — then the project config default, then the built-in default of `manual`. An absent or unrecognized `autopilot.selection` value SHALL fall back to the built-in default without failing config parsing, and the resolved policy SHALL be displayed at run start with its source so an opted-in run is never silent about how it will pick a pipeline.

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

#### Scenario: Run flag overrides config

- **WHEN** `rasen/config.yaml` declares `autopilot.selection: manual` and the user runs `/rasen:auto --auto-select <task>`
- **THEN** the effective policy is `classify` (the run flag wins over the config default)

#### Scenario: Default off leaves selection unchanged

- **WHEN** no `autopilot.selection` key is present and neither `--auto-select` nor `--auto-compose` is passed
- **THEN** the effective policy is `manual` and pipeline selection behaves exactly as before this capability existed: explicit selection wins, otherwise the default is `small-feature` and classification is advisory-only

#### Scenario: Unrecognized config value does not break parsing

- **WHEN** `autopilot.selection` holds a value other than `classify`, `compose`, or `manual`
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, sibling `autopilot` fields still parse, and the built-in default (`manual`) applies
