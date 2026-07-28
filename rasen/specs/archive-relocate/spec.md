# archive-relocate Specification

## Purpose
TBD — created by archiving change `store-migration-commands`. Update Purpose after archive.

## Requirements
### Requirement: Relocate moves existing archives and flips the destination together
`rasen archive relocate --to <in-repo|external|store>` SHALL move the project's existing archived changes to the chosen destination and set `archive.destination` accordingly in the same operation, so configuration and data never disagree about where the archive lives.

#### Scenario: In-repo to external
- **WHEN** the user runs `rasen archive relocate --to external` in a project whose archive lives in the repo
- **THEN** the archived changes move to the machine home's archive area and the project config records the external destination

#### Scenario: External back to in-repo
- **WHEN** the user runs `rasen archive relocate --to in-repo`
- **THEN** archived changes held in the machine home return to the repo's archive directory and the config records in-repo

#### Scenario: Store destination requires store mode
- **WHEN** the user runs `rasen archive relocate --to store` in a project that is not store-mode
- **THEN** the command exits with an error explaining that the project must be adopted into a store first

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
`--to prune` SHALL be rejected; destructive pruning remains exclusively on the existing archive-destination configuration path with its own confirmation and tombstone contract.

#### Scenario: Prune target rejected
- **WHEN** the user runs `rasen archive relocate --to prune`
- **THEN** the command exits with an error pointing to `rasen config set archive.destination prune` and its confirmation flow

### Requirement: Relocate is previewable and scriptable
Relocate SHALL support `--dry-run` (list every archived change and its source and target location, change nothing) and `--json`.

#### Scenario: Dry run lists the move plan
- **WHEN** the user passes `--dry-run`
- **THEN** the output lists each archived change with source and destination paths and neither files nor config change
