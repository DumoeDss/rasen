# archive-relocate Specification

## Purpose
TBD — created by archiving change `store-migration-commands`. Update Purpose after archive.
## Requirements
### Requirement: Relocate gathers from every current location
Relocation SHALL enumerate archived changes across all locations readers currently union (repo archive directory, machine home, store archive when applicable) so a previously split archive is consolidated at the target, not just the currently-configured location.

#### Scenario: Split archive is consolidated
- **WHEN** archives exist both in the repo and in the machine home from an earlier config-only flip
- **THEN** relocate moves both sets to the target and the target afterwards holds the union

### Requirement: Collisions and interruptions degrade safely
When a moving archive directory's name already exists at the target, relocate SHALL disambiguate with a timestamp suffix rather than overwriting. An interrupted relocation SHALL leave every archived change readable (union semantics) and rerunning the command SHALL complete the move.

#### Scenario: Name collision at the target
- **WHEN** an archived change with the same directory name already exists at the target
- **THEN** the incoming one is stored under a suffixed name and both remain readable

#### Scenario: Interruption then rerun
- **WHEN** relocation is interrupted partway
- **THEN** `rasen list` style readers still see every archived change, and rerunning relocate finishes moving the remainder

### Requirement: Prune is not a relocation target
`--to prune` SHALL be rejected; destructive pruning is retired entirely (`archive-destination` capability) and no relocation or configuration path SHALL delete archives.

#### Scenario: Prune target rejected
- **WHEN** the user runs `rasen archive relocate --to prune`
- **THEN** the command exits with an error explaining that prune is retired and archives always live in the planning root

### Requirement: Relocate is previewable and scriptable
Relocate SHALL support `--dry-run` (list every archived change and its source and target location, change nothing) and `--json`.

#### Scenario: Dry run lists the move plan
- **WHEN** the user passes `--dry-run`
- **THEN** the output lists each archived change with source and destination paths and neither files nor config change

### Requirement: Relocate consolidates archives into the planning root

`rasen archive relocate` SHALL support `--to in-repo` (move all discoverable archives — including legacy machine-home archives — into the planning root's archive directory) and `--to store` (into the store's archive, for store-mode projects). `--to external` SHALL be rejected with an error explaining that the external destination is retired and archives always land in the planning root. Relocation SHALL NOT write an `archive.destination` config value.

#### Scenario: Legacy external archives return to the planning root

- **WHEN** the user runs `rasen archive relocate --to in-repo` in a project whose machine home holds archives from the retired external destination
- **THEN** those archived changes move to the planning root's archive directory
- **AND** no `archive.destination` value is written to the config

#### Scenario: External target rejected

- **WHEN** the user runs `rasen archive relocate --to external`
- **THEN** the command exits with an error explaining the external destination is retired

