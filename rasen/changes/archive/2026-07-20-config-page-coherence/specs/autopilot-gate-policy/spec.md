## MODIFIED Requirements

### Requirement: Project config sets a default gate policy with defined precedence

A project SHALL be able to declare a default autopilot gate policy in `rasen/config.yaml` under an `autopilot.gates` key, and a machine SHALL be able to declare a default in the global config under the same key, with the values `on` (gates pause) or `off` (gates auto-approved). The effective policy SHALL resolve with precedence: the run argument (`--no-gate`) first, then the project config default, then the global config default, then the built-in default of gates ON. An absent or unrecognized `autopilot.gates` value at either scope SHALL fall back to the next layer without failing config parsing.

#### Scenario: Config default is honored without the flag
- **WHEN** `rasen/config.yaml` declares `autopilot.gates: off` and the user runs `/rasen:auto <task>` without `--no-gate`
- **THEN** ordinary gates are auto-approved as if `--no-gate` were passed

#### Scenario: Global default is honored when no project value is set
- **WHEN** the global config declares `autopilot.gates: off`, the project sets no `autopilot.gates`, and the user runs `/rasen:auto <task>` without `--no-gate`
- **THEN** ordinary gates are auto-approved, and the resolved policy identifies the global config as its source

#### Scenario: Project value wins over global
- **WHEN** the global config declares `autopilot.gates: off` and the project config declares `autopilot.gates: on`
- **THEN** the effective policy is gates ON (the project value wins over the global value)

#### Scenario: Run flag overrides config
- **WHEN** `rasen/config.yaml` declares `autopilot.gates: on` and the user runs `/rasen:auto --no-gate <task>`
- **THEN** ordinary gates are auto-approved (the run flag wins over the config default)

#### Scenario: Absent config falls back to gates on
- **WHEN** no `autopilot.gates` key is present in either the project or the global config and no `--no-gate` flag is passed
- **THEN** the effective policy is gates ON and gate stages pause

#### Scenario: Unrecognized config value does not break parsing
- **WHEN** `autopilot.gates` holds a value other than `on` or `off` in either scope
- **THEN** config parsing succeeds, the invalid value is ignored with a warning, and resolution falls through to the next layer (built-in default gates ON when no valid value remains)
