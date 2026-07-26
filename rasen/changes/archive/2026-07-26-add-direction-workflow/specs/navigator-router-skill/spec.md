## ADDED Requirements

### Requirement: Navigator maps Direction as an optional long-horizon on-ramp

The navigator SHALL describe `rasen-direction` as an optional governance
workflow above the normal Change flow for work spanning multiple Changes,
versions, horizons, projects, or recurring principle-level choices. It SHALL
keep the ordinary main flow unchanged and SHALL distinguish Direction Target
State from `rasen-goal`.

#### Scenario: Direction appears outside the mandatory main line

- **WHEN** the generated navigator is inspected
- **THEN** it SHALL name `rasen-direction` using its canonical skill name
- **AND** it SHALL describe Establish/select/project/reconcile use in a concise
  "when to reach for it" entry
- **AND** it SHALL NOT place Direction as a required numbered step in the main
  Change flow

#### Scenario: Navigator preserves direct daily work

- **WHEN** the navigator explains the ordinary idea-to-ship flow
- **THEN** that flow SHALL continue from exploration/office-hours to propose
  without a mandatory Direction step
- **AND** Direction SHALL be presented only for long-horizon governance needs

#### Scenario: Navigator separates target concepts

- **WHEN** the navigator references both `rasen-direction` and `rasen-goal`
- **THEN** it SHALL identify Direction Target State as cross-Change workstream
  state
- **AND** it SHALL identify `rasen-goal` as bounded iteration toward a gate
