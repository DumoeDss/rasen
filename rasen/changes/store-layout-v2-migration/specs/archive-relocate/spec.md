## MODIFIED Requirements

### Requirement: Relocate consolidates archives into the planning root

`rasen archive relocate` SHALL support `--to in-repo` (move all discoverable archives — including legacy machine-home archives — into the planning root's archive directory) and `--to store` (into the store's archive, for store-mode projects). `--to external` SHALL be rejected with an error explaining that the external destination is retired and archives always land in the planning root. Relocation SHALL NOT write an `archive.destination` config value.

When the target store declares planning layout version 2, `--to store` SHALL require the project to be a bound planning member and SHALL require an explicit `--target-line <id>` naming an existing target-line catalog, because archives are partitioned by stable target line and no legacy archive entry records one. Entries SHALL land under that project's stable target-line archive directory with their existing directory names and record files unchanged, and relocation SHALL NOT synthesize an archive outcome, reachability fact, or workspace-pair identity. Without a target line, or for an unbound project, relocation SHALL fail closed rather than choose a line or a partition. Relocation SHALL NOT write a root-level store `rasen/changes/archive` path in a store declaring layout version 2.

#### Scenario: Legacy external archives return to the planning root

- **WHEN** the user runs `rasen archive relocate --to in-repo` in a project whose machine home holds archives from the retired external destination
- **THEN** those archived changes move to the planning root's archive directory
- **AND** no `archive.destination` value is written to the config

#### Scenario: Store relocation lands in the project's target-line archive

- **WHEN** the user runs `rasen archive relocate --to store --target-line line-0.2` for a project bound to a layout version 2 store
- **THEN** the archived changes move under that project's `line-0.2` archive directory in the store
- **AND** their directory names and record files remain byte-identical

#### Scenario: Store relocation without a target line is refused

- **WHEN** the user runs `rasen archive relocate --to store` against a layout version 2 store with no `--target-line`
- **THEN** the command exits naming the missing selector and moves nothing
- **AND** no target line is derived from a branch name, a ref, or another archive entry

#### Scenario: External target rejected

- **WHEN** the user runs `rasen archive relocate --to external`
- **THEN** the command exits with an error explaining the external destination is retired
