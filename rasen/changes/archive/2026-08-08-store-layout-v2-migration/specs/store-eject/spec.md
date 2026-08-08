## MODIFIED Requirements

### Requirement: Eject restores a store-hosted project to in-repo planning

`rasen store eject <project-id> [--from <store-id>]` SHALL copy the project's owned planning content from the store back into the destination repository's planning directory, remove the `store:` pointer from that repository's config, release the project's planning binding in the store, and refresh the machine registry so the project's mode is `in-repo`. The destination SHALL be resolved by the explicit rule in "Eject resolves its destination explicitly, never from a path recorded elsewhere".

In a store declaring layout version 2, the project's partition SHALL be what it owns: specs, project design docs, active changes, and target-line archive directories are read from that partition, no name list is consulted, and the partition SHALL be removed once the copy is verified. Releasing the binding SHALL set the project's catalog planning binding to unbound while preserving its roles, so ejecting removes where the project plans, not the roster it belongs to. In a store that has not declared layout version 2, eject SHALL continue to read the store's membership record ownership, with legacy adoption data as a fallback while it still exists.

#### Scenario: Manifest-driven eject

- **WHEN** the user ejects a project from a layout version 2 store
- **THEN** exactly that project's partition content returns to the repo, the pointer is gone, and subsequent commands in the repo resolve to the local planning root
- **AND** the project's catalog records an unbound planning binding with its roles preserved

#### Scenario: Content edited in the store still ejects

- **WHEN** a spec was modified inside the store after adoption
- **THEN** eject moves the current store version back (the partition is the contract; content history remains in the store's git)

#### Scenario: Another project's content is never ejected

- **WHEN** a store holds partitions for several projects, including changes and specs with the same names
- **THEN** only the named project's partition SHALL move
- **AND** no other project's partition SHALL be read, copied, or removed

#### Scenario: Missing partition is reported rather than guessed

- **WHEN** the named project has no partition in a layout version 2 store
- **THEN** eject SHALL fail naming the project and the store
- **AND** it SHALL NOT fall back to copying store-level or another project's content

### Requirement: Manifest-less eject requires explicit full-copy consent

When a store that has not declared layout version 2 holds no ownership record for the project — neither a membership record's ownership nor legacy adoption data — eject SHALL refuse by default and offer `--all`, which copies the store's entire flat planning content back to the repo only after an interactive confirmation that lists what will move. `--all` SHALL still resolve its destination by the explicit rule and SHALL NOT accept a destination inferred from any recorded path. In a store declaring layout version 2 there is no ambiguity to consent to, so `--all` SHALL be rejected with an explanation that the project's partition is its ownership record.

#### Scenario: Missing manifest without --all

- **WHEN** the user ejects a project from a legacy flat store that has no ownership record for it
- **THEN** the command exits with an explanation and names the `--all` fallback without moving anything

#### Scenario: --all lists before it moves

- **WHEN** the user passes `--all` against a legacy flat store
- **THEN** the full list of specs and changes is shown and confirmation is required before any file moves

#### Scenario: --all is rejected for a partitioned store

- **WHEN** the user passes `--all` against a store declaring layout version 2
- **THEN** the command exits explaining that the project's partition already defines what it owns
- **AND** no store-level or other-project content is copied

### Requirement: Eject fails closed on manifest drift

When recorded content is missing from the store, eject SHALL stop and report the missing names; `--force` proceeds with whatever exists, still reporting the gaps. Restoring a layout version 2 partition SHALL additionally fail closed when archive entries from two different target lines would land on the same name in the repository's single archive directory: the command SHALL report both source paths and move nothing, because the in-repo layout has no target-line dimension and overwriting or nesting would corrupt the archive.

#### Scenario: Missing files block eject

- **WHEN** two recorded changes are absent from the store
- **THEN** eject exits listing both names and moves nothing

#### Scenario: Cross-line archive collision blocks

- **WHEN** two archive entries under different target lines in the project's partition share a directory name
- **THEN** eject SHALL fail listing both source paths
- **AND** neither entry SHALL be overwritten, renamed, or restored inside a nested target-line directory
