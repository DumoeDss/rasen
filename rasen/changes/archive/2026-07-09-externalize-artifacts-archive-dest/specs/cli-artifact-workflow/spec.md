# cli-artifact-workflow Specification (delta)

## ADDED Requirements

### Requirement: Status payload carries the resolved archive destination and location

`rasen status --change <n> --json`'s `archive` object SHALL additionally carry `destination` (`in-repo` | `external` | `prune`, default applied) and, when one exists, `archiveDir` — the absolute resolved bookkeeping location (the in-repo archive directory, or the machine-home archive for `external`). `archiveDir` SHALL be omitted — not null or empty — for `prune` and when `external` cannot be resolved by a read-only probe, so templates can key their fallback on the field's absence. Resolving these fields SHALL NOT write anywhere and SHALL NOT invoke git or `gh`.

#### Scenario: Status exposes destination and location

- **WHEN** `rasen status --change <n> --json` runs with destination `external` in a registered project
- **THEN** the payload's `archive` object SHALL include `destination` = `external` and an absolute `archiveDir` under the machine home

#### Scenario: Prune omits the location

- **WHEN** the resolved destination is `prune`
- **THEN** the payload SHALL include `destination` = `prune` and omit `archiveDir`

#### Scenario: Unresolvable external omits the location without side effects

- **WHEN** destination is `external` but the project has no machine identity
- **THEN** the payload SHALL include `destination` = `external`, omit `archiveDir`, and the command SHALL perform no writes
