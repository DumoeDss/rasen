## ADDED Requirements

### Requirement: Change validation detects destructive scenario omission against canonical specs

When validating a change, the command SHALL compare every `MODIFIED` requirement with the same requirement in the selected planning root's canonical specs. Every current scenario absent from the replacement block SHALL be reported with the delta file, capability, requirement, and complete missing-scenario list. Plain validation SHALL expose the finding as a warning while preserving its existing zero exit status for warning-only reports; `--strict` SHALL treat the same finding as an error and exit non-zero.

#### Scenario: Plain validation warns without changing its exit contract

- **WHEN** `rasen validate <change>` sees a `MODIFIED` requirement that omits one or more current scenarios and has no other error
- **THEN** it SHALL display the scenario-preservation warning and remediation
- **AND** its JSON result SHALL include the same structured warning
- **AND** the command SHALL retain the warning-only success exit status

#### Scenario: Strict validation blocks omitted scenarios

- **WHEN** `rasen validate <change> --strict` sees the same omission
- **THEN** it SHALL report the change as invalid and exit non-zero
- **AND** the diagnostic SHALL explain that `MODIFIED` replaces the complete requirement and must include every scenario that should survive

#### Scenario: Every omitted requirement is reported together

- **WHEN** several `MODIFIED` requirements across several capabilities omit canonical scenarios
- **THEN** one direct or bulk validation run SHALL report every affected requirement in deterministic path and requirement order
- **AND** each issue SHALL list all missing scenario names for that requirement

#### Scenario: Selected planning scope supplies the baseline

- **WHEN** validation runs against a repo, registered Store, or registered project selected by the command
- **THEN** the comparison SHALL read canonical specs from that resolved planning scope
- **AND** it SHALL NOT fall back to a similarly named spec under the current working directory

#### Scenario: New requirement has no preservation baseline

- **WHEN** a delta adds a new capability or requirement for which no canonical requirement exists
- **THEN** validation SHALL apply the existing delta-shape rules without fabricating a scenario-preservation warning
