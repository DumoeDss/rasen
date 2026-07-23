# store-eject Specification

## Purpose
TBD — created by archiving change `store-migration-commands`. Update Purpose after archive.

## Requirements
### Requirement: Eject restores a store-hosted project to in-repo planning
`rasen store eject <project-id> [--from <store-id>]` SHALL copy the project's owned specs and changes (per the adoption manifest) from the store back into the repo's planning directory, remove the `store:` pointer from the repo config, remove the manifest entry, and refresh the machine registry so the project's mode is `in-repo`.

#### Scenario: Manifest-driven eject
- **WHEN** the user ejects a project that was previously adopted
- **THEN** exactly the manifest-listed specs and changes return to the repo, the pointer is gone, and subsequent commands in the repo resolve to the local planning root

#### Scenario: Content edited in the store still ejects
- **WHEN** a manifest-listed spec was modified inside the store after adoption
- **THEN** eject moves the current store version back (names are the contract; content history remains in the store's git)

### Requirement: Manifest-less eject requires explicit full-copy consent
When no manifest entry exists for the project, eject SHALL refuse by default and offer `--all`, which copies the store's entire planning content back to the repo only after an interactive confirmation that lists what will move.

#### Scenario: Missing manifest without --all
- **WHEN** the user ejects a project the store has no manifest entry for
- **THEN** the command exits with an explanation and names the `--all` fallback without moving anything

#### Scenario: --all lists before it moves
- **WHEN** the user passes `--all`
- **THEN** the full list of specs and changes is shown and confirmation is required before any file moves

### Requirement: Eject fails closed on manifest drift
When manifest-listed files are missing from the store, eject SHALL stop and report the missing names; `--force` proceeds with whatever exists, still reporting the gaps.

#### Scenario: Missing files block eject
- **WHEN** two manifest-listed changes are absent from the store
- **THEN** eject exits listing both names and moves nothing

### Requirement: Eject is git-safe and previewable
Eject SHALL follow the same safety contract as adopt: copy → verify → delete, no git writes, `--dry-run` and `--json` support, and suggested per-repo commit commands on completion.

#### Scenario: Dry run previews the restore
- **WHEN** the user runs eject with `--dry-run`
- **THEN** the output lists every spec and change that would return to the repo and nothing changes
