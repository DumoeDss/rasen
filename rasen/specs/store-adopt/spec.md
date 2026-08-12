# store-adopt Specification

## Purpose
TBD — created by archiving change `store-migration-commands`. Update Purpose after archive.
## Requirements
### Requirement: Adopt migrates an in-repo project into a store in one command

`rasen store adopt [path] --to <store-id>` SHALL move the project's planning content (specs, project design docs, and changes) into the target store, convert the repo to a config-only pointer (`store: <id>` in the planning config), record the project as a planning member of the store, register the project in the project namespace and the store's references, add a membership locator hint to the project's config, and refresh the machine registry so the project's mode is `store` immediately. Membership SHALL be established in the order and with the repair reporting defined by `store-project-membership`.

In a store declaring layout version 2, the destination SHALL be that project's planning partition — its project home, canonical specs, project design docs, and active changes — resolved through the layout contract, never a root-level store `rasen/specs` or `rasen/changes` path. The adopted project's permanent identity SHALL satisfy the v2 portable identifier contract, and an identity that does not SHALL be rejected rather than sanitized. A store that has not declared layout version 2 SHALL refuse adoption and name the layout migration command; a store found holding both layouts SHALL refuse and name the recovery command.

#### Scenario: Successful adopt from the repo root

- **WHEN** the user runs `rasen store adopt . --to team-store` in an in-repo project with specs and changes
- **THEN** the specs and changes appear under that project's planning partition in the store, the repo's planning directory contains only the pointer config, and `rasen status` addressed at the project resolves to the store
- **AND** the store carries a membership record for the project recording it as a planning member

#### Scenario: Registry mode flips without waiting for self-heal

- **WHEN** adopt completes
- **THEN** the machine project registry entry for the repo shows mode `store` on the very next command, not after a later self-heal touch

#### Scenario: Adopt on Windows and POSIX paths

- **WHEN** the repo and the store live on different drives or filesystems
- **THEN** the migration completes by copying then deleting (never a cross-device rename), and all recorded paths are portable across platforms
- **AND** no filesystem path from this machine is written into either repository's shared files

#### Scenario: Adopt into a legacy flat store is refused

- **WHEN** the target store has not declared layout version 2
- **THEN** adopt SHALL fail naming the layout migration command
- **AND** no file SHALL be moved and no flat store planning path SHALL be written

#### Scenario: No flat store planning path is created

- **WHEN** adoption completes into a layout version 2 store
- **THEN** every adopted spec, design doc, and change SHALL be located under that project's partition
- **AND** no root-level store `rasen/specs` or `rasen/changes` path SHALL exist as a result of the adoption

### Requirement: Adopt fails closed before moving anything

Adopt SHALL validate the whole operation before any file moves: the target store must be registered and healthy, the store's declared layout must accept the write, the source must have planning shape, the source must not already declare a store pointer, and no spec or change name may collide with content already present **in that project's partition**. Name comparison SHALL be case-insensitive on all platforms. A name that exists in another project's partition SHALL NOT be a collision. On any precheck failure the command reports every problem found and changes nothing.

#### Scenario: Name collision aborts with a full list

- **WHEN** the target project's partition already contains a spec or change whose name (case-insensitively) matches one being adopted
- **THEN** adopt exits with an error listing every colliding name and no files have moved

#### Scenario: Another project's identical name is not a collision

- **WHEN** a different project's partition in the same store already contains a change with the same name
- **THEN** the precheck SHALL NOT report a collision
- **AND** both changes SHALL exist afterwards, each in its own project's partition

#### Scenario: Already-pointed repo is rejected

- **WHEN** the repo's config already declares a `store:` pointer
- **THEN** adopt reports the existing pointer and suggests `store eject` or doctor instead of proceeding

### Requirement: Adopt records reversible ownership in the store

Adopt SHALL record ownership in the store before deleting anything from the source. In a store declaring layout version 2, ownership SHALL be recorded by writing the project's catalog with planning membership and a bound planning binding carrying its binding timestamp; that bound catalog SHALL be the resume marker for an interrupted adoption, and the project's own partition SHALL be its ownership record thereafter, so no spec or change name list is written. Ownership SHALL be keyed by the project's permanent identity. Adopt SHALL NOT record the source repository's path — restoring the project later resolves its destination explicitly (see `store-eject`) rather than from a path captured on the machine that ran the adoption.

#### Scenario: Manifest written before source deletion

- **WHEN** adopt is interrupted after copying but before source cleanup finishes
- **THEN** the ownership record already exists — in a layout version 2 store, the project's catalog already records a bound planning binding — and rerunning adopt detects the partial state and resumes to completion instead of duplicating or failing opaquely

#### Scenario: Ownership carries no source path

- **WHEN** adopt records ownership for the project
- **THEN** the recorded ownership contains the project identity, roles, and binding timestamp
- **AND** it contains no filesystem path from the machine that ran the adoption, on any platform

#### Scenario: The partition is the ownership record

- **WHEN** adoption into a layout version 2 store completes
- **THEN** the store SHALL hold no spec or change name list for that project
- **AND** what the project owns SHALL be readable from its partition alone

### Requirement: Archive handling is an explicit choice on adopt

Adopt SHALL accept `--archive move|leave` (default `move`): `move` migrates the existing archive into the store with everything else; `leave` keeps it in the source repo. `--archive external` SHALL be rejected with an error explaining that the external archive destination is retired (`archive-destination` capability) and that archives always land in a planning root — the source repo's or the store's. Adopt SHALL NOT write an `archive.destination` configuration value under any mode, and SHALL NOT move archived changes to the machine home.

In a store declaring layout version 2, moving the archive SHALL require an explicit `--target-line <id>` naming an existing target-line catalog, because archives are partitioned by stable target line and no legacy archive entry records one. Archived entries SHALL land under that project's stable target-line archive directory with their existing directory names and record files unchanged, and adopt SHALL NOT synthesize an archive outcome, reachability fact, or workspace-pair identity for them.

#### Scenario: Default moves the archive

- **WHEN** the user runs adopt with `--archive move` and an explicit target line
- **THEN** the repo's archived changes appear under that project's stable target-line archive directory in the store

#### Scenario: Archive move without a target line is refused

- **WHEN** the user adopts into a layout version 2 store with `--archive move` and no `--target-line`
- **THEN** adopt SHALL fail naming the missing selector
- **AND** no target line SHALL be derived from a branch name, a ref, or another change

#### Scenario: Relocated archive entries are unchanged

- **WHEN** archived changes are moved into the store
- **THEN** their directory names and record files SHALL be byte-identical to the originals
- **AND** no archive outcome, reachability fact, or workspace-pair identity SHALL be written for them

#### Scenario: External archive on adopt

- **WHEN** the user passes `--archive external`
- **THEN** the command exits with an error explaining that the external destination is retired
- **AND** no archived change is moved to the machine home and no `archive.destination` value is written to the config

### Requirement: Adopt is git-safe and previewable
Adopt SHALL never stage, commit, or otherwise write to any git index. It SHALL support `--dry-run` (print the full move plan, including any uncommitted files inside moved paths, and change nothing) and `--json`. On completion it SHALL print suggested, pathspec-scoped commit commands for each affected repository.

#### Scenario: Dry run shows the plan including uncommitted work
- **WHEN** the user runs adopt with `--dry-run` while some change files are uncommitted
- **THEN** the output lists every path that would move, flags the uncommitted ones, and no file or config is modified

#### Scenario: Completion prints per-repo commit suggestions
- **WHEN** adopt completes successfully
- **THEN** the output includes one suggested git commit command for the source repo (removals plus pointer config) and one for the store repo (additions), and neither has been executed

