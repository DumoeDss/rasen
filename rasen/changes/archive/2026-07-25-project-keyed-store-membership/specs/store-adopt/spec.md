## MODIFIED Requirements

### Requirement: Adopt migrates an in-repo project into a store in one command
`rasen store adopt [path] --to <store-id>` SHALL move the project's planning content (specs and changes) into the target store, convert the repo to a config-only pointer (`store: <id>` in the planning config), record the project as a planning member of the store, register the project in the project namespace and the store's references, add a membership locator hint to the project's config, and refresh the machine registry so the project's mode is `store` immediately. Membership SHALL be established in the order and with the repair reporting defined by `store-project-membership`.

#### Scenario: Successful adopt from the repo root
- **WHEN** the user runs `rasen store adopt . --to team-store` in an in-repo project with specs and changes
- **THEN** the specs and changes appear under the store's planning root, the repo's planning directory contains only the pointer config, and `rasen status` addressed at the project resolves to the store
- **AND** the store carries a membership record for the project recording it as a planning member

#### Scenario: Registry mode flips without waiting for self-heal
- **WHEN** adopt completes
- **THEN** the machine project registry entry for the repo shows mode `store` on the very next command, not after a later self-heal touch

#### Scenario: Adopt on Windows and POSIX paths
- **WHEN** the repo and the store live on different drives or filesystems
- **THEN** the migration completes by copying then deleting (never a cross-device rename), and all recorded paths are portable across platforms
- **AND** no filesystem path from this machine is written into either repository's shared files

### Requirement: Adopt records reversible ownership in the store
Adopt SHALL record ownership in the target store's membership record for the project, listing the adopted spec names, change names, and the adoption timestamp, so that the migration can be inspected and reversed later. Ownership SHALL be keyed by the project's permanent identity. Adopt SHALL NOT record the source repository's path — restoring the project later resolves its destination explicitly (see `store-eject`) rather than from a path captured on the machine that ran the adoption.

#### Scenario: Manifest written before source deletion
- **WHEN** adopt is interrupted after copying but before source cleanup finishes
- **THEN** the ownership record already exists, and rerunning adopt detects the partial state and resumes to completion instead of duplicating or failing opaquely

#### Scenario: Ownership carries no source path
- **WHEN** adopt records ownership for the project
- **THEN** the recorded ownership contains the adopted spec names, change names, and timestamp
- **AND** it contains no filesystem path from the machine that ran the adoption, on any platform
