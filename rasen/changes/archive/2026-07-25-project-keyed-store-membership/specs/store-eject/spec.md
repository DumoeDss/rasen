## ADDED Requirements

### Requirement: Eject resolves its destination explicitly, never from a path recorded elsewhere

Eject SHALL determine which repository to restore into by an explicit, ordered rule: an explicit `--into <path>`; otherwise the current checkout when its project identity matches the project being ejected; otherwise the machine registry's single live checkout for that project. When none of these yields exactly one destination, eject SHALL fail, naming `--into` and listing the candidate checkouts it found. Eject SHALL NOT read a source path recorded in legacy shared data, SHALL NOT infer a local path from a remote, SHALL NOT guess from a display name, and SHALL NOT choose the first of several checkouts. Checkout comparison SHALL be canonical, so a Windows path differing only by drive-letter case or separator form still matches.

#### Scenario: Explicit destination wins

- **WHEN** the user passes `--into <path>`
- **THEN** the project is restored into that path regardless of any other candidate

#### Scenario: The current checkout is used when its identity matches

- **WHEN** eject runs from inside a checkout whose project identity is the project being ejected, and no `--into` is passed
- **THEN** that checkout is the destination

#### Scenario: A single registered checkout is used

- **WHEN** the machine registry holds exactly one live checkout for the project and eject runs from elsewhere
- **THEN** that checkout is the destination

#### Scenario: Several checkouts require an explicit choice

- **WHEN** the machine registry holds more than one live checkout for the project and no `--into` is passed
- **THEN** eject fails listing every candidate checkout and naming `--into`
- **AND** no file is moved

#### Scenario: A legacy recorded source path is never followed

- **WHEN** the store's legacy shared data records an absolute path from another machine and no `--into` is passed
- **THEN** that recorded path has no influence on the destination
- **AND** resolution proceeds by the ordered rule above, failing for `--into` if it yields no single destination

#### Scenario: Destination matching is canonical on Windows

- **WHEN** the registered checkout path and the current directory name the same location but differ in drive-letter case or separator form
- **THEN** they are recognized as the same checkout and eject does not report an ambiguous or missing destination on that basis

## MODIFIED Requirements

### Requirement: Eject restores a store-hosted project to in-repo planning
`rasen store eject <project-id> [--from <store-id>]` SHALL copy the project's owned specs and changes — taken from the store's membership record for that project, with legacy adoption data read as a fallback while it still exists — from the store back into the destination repository's planning directory, remove the `store:` pointer from that repository's config, remove the project's ownership from the store, and refresh the machine registry so the project's mode is `in-repo`. The destination SHALL be resolved by the explicit rule in "Eject resolves its destination explicitly, never from a path recorded elsewhere".

#### Scenario: Manifest-driven eject
- **WHEN** the user ejects a project that was previously adopted
- **THEN** exactly the recorded specs and changes return to the repo, the pointer is gone, and subsequent commands in the repo resolve to the local planning root

#### Scenario: Content edited in the store still ejects
- **WHEN** a recorded spec was modified inside the store after adoption
- **THEN** eject moves the current store version back (names are the contract; content history remains in the store's git)

### Requirement: Manifest-less eject requires explicit full-copy consent
When the store holds no ownership record for the project — neither a membership record's ownership nor legacy adoption data — eject SHALL refuse by default and offer `--all`, which copies the store's entire planning content back to the repo only after an interactive confirmation that lists what will move. `--all` SHALL still resolve its destination by the explicit rule and SHALL NOT accept a destination inferred from any recorded path.

#### Scenario: Missing manifest without --all
- **WHEN** the user ejects a project the store has no ownership record for
- **THEN** the command exits with an explanation and names the `--all` fallback without moving anything

#### Scenario: --all lists before it moves
- **WHEN** the user passes `--all`
- **THEN** the full list of specs and changes is shown and confirmation is required before any file moves

### Requirement: Eject fails closed on manifest drift
When recorded content is missing from the store, eject SHALL stop and report the missing names; `--force` proceeds with whatever exists, still reporting the gaps.

#### Scenario: Missing files block eject
- **WHEN** two recorded changes are absent from the store
- **THEN** eject exits listing both names and moves nothing
