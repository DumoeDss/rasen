# cli-artifact-workflow Specification (delta)

## ADDED Requirements

### Requirement: Status payload carries the resolved archive timing

`rasen status --change <n> --json` SHALL include an `archive` object carrying the resolved archive timing (`{ timing: "on-merge" | "in-ship" }`), with the default already applied, so workflow templates read one authoritative value from the payload they already consume instead of parsing config themselves. The field is additive; resolving it SHALL NOT invoke git or `gh` and SHALL NOT write anywhere.

#### Scenario: Status exposes the resolved timing

- **WHEN** `rasen status --change <n> --json` runs in a project whose config sets `archive.timing: in-ship`
- **THEN** the payload SHALL include `archive.timing` = `in-ship`

#### Scenario: Default exposed when unconfigured

- **WHEN** the project config has no `archive` block
- **THEN** the payload SHALL include `archive.timing` = `on-merge`
- **AND** the command SHALL perform no writes and no git/gh invocations for this field
