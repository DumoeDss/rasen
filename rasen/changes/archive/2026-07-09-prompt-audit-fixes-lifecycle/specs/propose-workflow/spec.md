## ADDED Requirements

### Requirement: Consume office-hours validation as input context

The `propose` workflow SHALL, after creating the change and before drafting the proposal, look for office-hours validation output and read it as input context when present. Path lookups SHALL be resolved from `rasen status --json` (`changeRoot`, `planningHome`) rather than hardcoding repo-local paths. This wires the consumer side of the `opsx-office-hours-command` "Downstream Consumption by Propose" promise.

#### Scenario: Office-hours doc present in the change directory

- **WHEN** propose has created the change and resolved `changeRoot` from status JSON
- **AND** `office-hours-design.md` exists in `changeRoot`
- **THEN** the generated skill/command SHALL instruct reading that file as input context before drafting
- **AND** the generated proposal SHALL incorporate its findings, naming office-hours as the source

#### Scenario: Office-hours doc discoverable by slug in the sibling directory

- **WHEN** no `office-hours-design.md` exists in the change directory
- **AND** a file named `<change-name>.md` exists in the office-hours directory alongside the changes directory (resolved from `planningHome.changesDir`)
- **THEN** propose SHALL read that file as input context, since office-hours derives its filename slug the same way propose derives a change name, so the names align
- **AND** SHALL incorporate its findings into the proposal

#### Scenario: No office-hours output

- **WHEN** neither location contains an office-hours document for the change
- **THEN** propose SHALL proceed normally without office-hours context
