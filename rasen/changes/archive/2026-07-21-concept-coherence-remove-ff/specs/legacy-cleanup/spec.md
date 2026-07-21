## ADDED Requirements

### Requirement: Retired built-in workflow artifacts are pruned on init and update

`rasen init` and `rasen update` SHALL remove installed artifacts left orphaned by a retired built-in workflow — specifically the retired `rasen-ff-change` skill directory and the retired `ff` command file — from each configured AI tool. Because a retired workflow is no longer present in the built-in registry, the registry-derived deselection cleanup cannot reach it; this prune therefore keys on the retired identifiers directly. The prune SHALL be scoped to exactly those retired identifiers so it cannot remove any current skill directory or command file, SHALL be idempotent (a no-op when no such artifact exists), and SHALL run before the "already up to date" short-circuit so an install is healed even when nothing else needs updating.

#### Scenario: Retired ff skill directory removed on update

- **WHEN** `rasen update` runs in a project whose skills directory still contains a `rasen-ff-change/` directory from a prior install
- **THEN** the `rasen-ff-change/` directory SHALL be removed
- **AND** current skill directories SHALL be left intact

#### Scenario: Retired ff command file removed on update

- **WHEN** `rasen update` runs in a project that still has an installed `ff` command file for a configured tool
- **THEN** the `ff` command file SHALL be removed
- **AND** current command files SHALL be left intact

#### Scenario: Prune is scoped to the retired identifiers

- **WHEN** the retired-artifact prune runs
- **THEN** it SHALL remove only the `rasen-ff-change` skill directory and the `ff` command file
- **AND** it SHALL NOT remove any current workflow's skill directory or command file

#### Scenario: No retired artifacts is a no-op

- **WHEN** `rasen init` or `rasen update` runs and no retired `ff` artifact exists
- **THEN** the prune SHALL complete without error and remove nothing
