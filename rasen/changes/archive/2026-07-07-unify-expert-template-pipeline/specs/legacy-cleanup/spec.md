## ADDED Requirements

### Requirement: Retired expert skill directories are pruned on init and update

`openspec init` and `openspec update` SHALL remove installed skill directories left orphaned by the expert-skill rebrand — those whose directory name begins with the retired `openspec-gstack-` prefix — from each configured AI tool's skills directory (e.g. `.claude/skills/`). The prune SHALL be scoped to exactly the `openspec-gstack-` prefix so it cannot remove current `openspec-*` skills or any unrelated directory, and SHALL be idempotent (a no-op when no such directory exists).

#### Scenario: Renamed-skill orphan removed on update

- **WHEN** `openspec update` runs in a project whose skills directory still contains an `openspec-gstack-review/` directory from a prior install
- **THEN** the `openspec-gstack-review/` directory SHALL be removed
- **AND** the current `openspec-review/` skill directory SHALL be written and left intact

#### Scenario: Prune is scoped to the retired prefix

- **WHEN** the prune runs
- **THEN** it SHALL NOT remove any directory whose name begins with `openspec-` but not `openspec-gstack-`
- **AND** it SHALL NOT remove directories unrelated to OpenSpec skills

#### Scenario: No orphans is a no-op

- **WHEN** `openspec init` or `openspec update` runs and no `openspec-gstack-*` directory exists
- **THEN** the prune SHALL complete without error and remove nothing
