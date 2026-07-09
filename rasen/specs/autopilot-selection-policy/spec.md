# autopilot-selection-policy Specification

## Purpose
TBD - created by archiving change autonomy-ladder-classify. Update Purpose after archive.
## Requirements
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

### Requirement: Explicit pipeline selection always wins over the selection policy

An explicit pipeline selection — `--pipeline <name>` or a leading known-pipeline token in the invocation — SHALL always determine the pipeline, regardless of the resolved selection policy. When an explicit selection is present, classification SHALL NOT be consulted and `--auto-select` SHALL have no effect.

#### Scenario: Explicit selector beats the flag

- **WHEN** a user runs `/rasen:auto --auto-select --pipeline full-feature <task>`
- **THEN** the pipeline is `full-feature` and the classification suggestion is not consulted

#### Scenario: Explicit selector beats the config default

- **WHEN** `rasen/config.yaml` declares `autopilot.selection: classify` and the user invokes `/rasen:auto bug-fix <task>` with `bug-fix` as a known pipeline name
- **THEN** the pipeline is `bug-fix`, the selector token is stripped from the task description, and classification is not consulted

### Requirement: Adopted classification is displayed and remains user-changeable

When the effective selection policy is `classify` and no explicit selection is present, the LEAD SHALL obtain the classification suggestion (via `rasen pipeline classify "<task>" --json`), adopt a suggestion whose pipeline is among the available pipelines, and display the adopted pipeline together with its basis — the matched indicators for a keyword-driven suggestion, or the default basis when nothing matched. The user SHALL be able to change the adopted pipeline before execution proceeds. The LEAD SHALL adopt the suggestion exactly as returned and SHALL NOT escalate or substitute a different pipeline by its own judgment.

#### Scenario: Keyword-driven suggestion adopted and displayed

- **WHEN** the policy is `classify` and classification suggests `bug-fix` with matched indicators (e.g. `fix`)
- **THEN** the LEAD adopts `bug-fix`, displays the choice with its matched indicators, and lets the user change it before proceeding

#### Scenario: Default-basis suggestion lands on the default pipeline

- **WHEN** the policy is `classify` and classification reports its suggestion with a default basis (no indicators matched)
- **THEN** the adopted pipeline is `small-feature` and the display identifies the default basis

#### Scenario: User overrides the adopted choice

- **WHEN** the LEAD has adopted a classification suggestion and displayed it
- **THEN** the user can replace it with any available pipeline before any stage runs, and the user's choice is used

### Requirement: Classification failure falls back to the default pipeline

When the effective selection policy is `classify` but classification is unavailable, fails, returns no suggestion, or suggests a pipeline that is not among the available pipelines, the LEAD SHALL fall back to `small-feature` — the same default as the `manual` policy — and SHALL display the fallback and its cause.

#### Scenario: Classify command fails

- **WHEN** the policy is `classify` and `rasen pipeline classify` errors or produces no usable output
- **THEN** the pipeline is `small-feature` and the display notes the fallback and why it happened

#### Scenario: Suggestion is not an available pipeline

- **WHEN** the policy is `classify` and the classification suggestion names a pipeline that is not in the reported available list
- **THEN** the LEAD does not dispatch the unavailable name; the pipeline is `small-feature` and the fallback is displayed

