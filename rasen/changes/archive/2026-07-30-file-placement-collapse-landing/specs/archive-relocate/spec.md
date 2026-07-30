## MODIFIED Requirements

### Requirement: Prune is not a relocation target
`--to prune` SHALL be rejected; destructive pruning is retired entirely (`archive-destination` capability) and no relocation or configuration path SHALL delete archives.

#### Scenario: Prune target rejected
- **WHEN** the user runs `rasen archive relocate --to prune`
- **THEN** the command exits with an error explaining that prune is retired and archives always live in the planning root

## ADDED Requirements

### Requirement: Relocate consolidates archives into the planning root

`rasen archive relocate` SHALL support `--to in-repo` (move all discoverable archives — including legacy machine-home archives — into the planning root's archive directory) and `--to store` (into the store's archive, for store-mode projects). `--to external` SHALL be rejected with an error explaining that the external destination is retired and archives always land in the planning root. Relocation SHALL NOT write an `archive.destination` config value.

#### Scenario: Legacy external archives return to the planning root

- **WHEN** the user runs `rasen archive relocate --to in-repo` in a project whose machine home holds archives from the retired external destination
- **THEN** those archived changes move to the planning root's archive directory
- **AND** no `archive.destination` value is written to the config

#### Scenario: External target rejected

- **WHEN** the user runs `rasen archive relocate --to external`
- **THEN** the command exits with an error explaining the external destination is retired

## REMOVED Requirements

### Requirement: Relocate moves existing archives and flips the destination together

**Reason**: There is no destination configuration left to flip; relocation only consolidates archive data (see the added requirement above).

**Migration**: `--to in-repo` and `--to store` keep moving data; the config write is dropped and `archive.destination` becomes a deprecated compat-read key (`config-loading` capability).
