# store-registration Specification

## Purpose
Govern how a Rasen store root is inspected and registered, so a fresh or empty store (no `changes/`, `specs/`, or `archive/` yet) registers cleanly, a repository whose planning is externalized via a `store:` pointer is rejected as a root, and commands run against such a store report a friendly empty state instead of an initialization error.
## Requirements
### Requirement: Empty Planning Directories Are Optional for Store Health

When inspecting a rasen store root, the `rasen/specs/`, `rasen/changes/`, and `rasen/changes/archive/` directories SHALL be treated as optional. A store that has `rasen/config.yaml` but is missing some or all of these planning directories SHALL be considered healthy and registrable. Only a planning path that exists but is not a directory SHALL be a health diagnostic.

#### Scenario: Config-only store is healthy

- **WHEN** a store root has `rasen/config.yaml` and no `specs/`, `changes/`, or `changes/archive/` directories
- **THEN** inspection reports the root as healthy (`present && config.present && no diagnostics`)
- **AND** registering it as a store succeeds without first creating the empty planning directories

#### Scenario: Missing planning directory is not a diagnostic

- **WHEN** a planning directory (`specs/`, `changes/`, or `archive/`) is absent
- **THEN** it is recorded as `{ present: false }` without pushing an error diagnostic
- **AND** archive is only inspected when `changes/` is itself a directory

#### Scenario: A non-directory planning path is a diagnostic

- **WHEN** a planning path such as `rasen/changes/archive` exists but is a file rather than a directory
- **THEN** inspection pushes a `*_not_directory` diagnostic for that path
- **AND** the root is reported unhealthy

### Requirement: Store metadata directory uses the rasen name with legacy read compatibility

Store metadata SHALL live in a `.rasen-store/` directory at the store root. When resolving an existing store, a root that has only the legacy `.openspec-store/` directory SHALL still be recognized; on the next registration or metadata write for that root, the metadata SHALL be written under `.rasen-store/` by copy (the legacy directory is not deleted or modified).

#### Scenario: New registration writes the rasen metadata directory

- **WHEN** a store is registered at a root with no existing metadata
- **THEN** `.rasen-store/store.yaml` is created
- **AND** no `.openspec-store/` directory is created

#### Scenario: Legacy metadata still recognized

- **WHEN** a store root contains `.openspec-store/store.yaml` and no `.rasen-store/`
- **THEN** the store resolves and its commands work
- **AND** the next registration or metadata write creates `.rasen-store/` as a copy, leaving `.openspec-store/` untouched

### Requirement: Default store location uses the rasen directory

When registering a store without an explicit path, the default checkout location SHALL be `~/rasen/<store-id>`. Absolute paths already recorded in the registry (including legacy `~/openspec/<store-id>` locations) SHALL continue to resolve unchanged.

#### Scenario: New store defaults to the rasen home directory

- **WHEN** a user registers a store without specifying a path
- **THEN** the checkout is placed at `~/rasen/<store-id>` (platform-appropriate home resolution)

#### Scenario: Previously registered paths keep working

- **WHEN** the registry contains a store whose `local_path` points at `~/openspec/<store-id>`
- **THEN** commands against that store resolve the existing path without rewriting it

### Requirement: Reject a Config-Only Pointer Repo as a Store Root

Registering a store SHALL reject a repository whose `rasen/config.yaml` declares a `store:` pointer (its planning is externalized) because such a repo is not itself a store root. A malformed `store:` pointer SHALL also be rejected. A repo with real planning shape SHALL be unaffected.

#### Scenario: Declared pointer is rejected

- **WHEN** registration targets a repo whose config declares `store: <other>` and it has no local planning shape
- **THEN** registration throws a `store_root_pointer_declared` error explaining the planning is externalized to the named store
- **AND** advises registering the checkout for the declared store, or removing the `store:` line to convert the repo into a local store root

#### Scenario: Malformed pointer is rejected

- **WHEN** the config's `store:` value is malformed (e.g. not a string)
- **THEN** registration throws an `invalid_store_pointer` error naming the config file and the problem

#### Scenario: A real store root is unaffected

- **WHEN** the target has planning shape (specs/changes present) or no `store:` pointer at all
- **THEN** the pointer guard does not throw and registration proceeds to the normal health check

### Requirement: Doctor detects migration drift states

`rasen store doctor` SHALL additionally diagnose three drift states and name the repairing command for each: a repo whose `store:` pointer references an unregistered store id (error — work is unaddressable); a repo with both planning shape and a `store:` pointer (warning — mode derivation resolves to in-repo, which may surprise after an interrupted adopt); and adoption-manifest entries referencing specs or changes absent from the store (warning, with the missing names listed).

Both `rasen doctor` and `rasen store doctor` SHALL also diagnose planning-layout drift for the store itself, with identical codes and identical repair commands in human and JSON output: local refs that still carry flat planning content, a store declaring layout version 2 that still holds flat planning content, an unfinished or failed layout migration recorded for that store and ref, a project partition with no project catalog, and a project catalog declaring a bound planning binding with no partition. Each finding SHALL name the affected ref, path, or project and carry the copy-pasteable command that migrates, resumes, or recovers it. A store whose planning layout cannot be diagnosed SHALL be reported as such rather than reported as a store with no layout findings. These findings SHALL be read-only: reporting them SHALL modify nothing in the store, in any project repository, or in the machine data directory, and SHALL rewrite no Git history even when a layout inconsistency was produced by a manual merge.

A store that declares layout version 2, still holds flat planning content, and records a completed retirement SHALL be diagnosed as a re-introduced flat tree rather than as a retirement that has not run: the finding SHALL NOT offer the retirement command, and every planning mutation SHALL refuse while that state persists.

#### Scenario: Pointer to unregistered store

- **WHEN** a repo's config declares `store: ghost` and no store with id `ghost` is registered
- **THEN** doctor reports an error naming the id and suggests `rasen store register` or correcting the pointer

#### Scenario: Ambiguous shape plus pointer

- **WHEN** a repo has a `specs/` directory and a `store:` pointer at the same time
- **THEN** doctor warns that the project resolves as in-repo and suggests resuming `store adopt` or removing the pointer

#### Scenario: Manifest references missing content

- **WHEN** the store's adoption manifest lists a change that no longer exists in the store
- **THEN** doctor warns with the missing name and suggests inspecting the store's git history or running `store eject --force`

#### Scenario: Flat refs are reported with their migration command

- **WHEN** a store has local refs that still carry flat planning content
- **THEN** doctor reports each such ref and the command that migrates it
- **AND** it states that migrating one ref does not migrate the others

#### Scenario: Half-migrated store is distinguished

- **WHEN** a store declares layout version 2 and still holds flat planning content
- **THEN** doctor reports the residue and any recorded unfinished migration run distinctly from an unmigrated flat store
- **AND** it names the recovery command rather than repairing anything

#### Scenario: Partition and catalog disagree

- **WHEN** a project partition exists with no project catalog, or a catalog declares a bound planning binding with no partition
- **THEN** doctor reports the affected project and path with its repair command

#### Scenario: Layout diagnosis writes nothing

- **WHEN** any planning-layout drift finding is reported
- **THEN** the store, every project repository, and the machine data directory are left byte-identical

#### Scenario: Both doctors report the same layout findings

- **WHEN** a store carries planning-layout drift and both `rasen doctor` and `rasen store doctor` are run against it
- **THEN** both report the same codes with the same repair commands
- **AND** the human rendering carries each code, not only its prose

#### Scenario: A flat tree re-introduced after retirement is not pending retirement

- **WHEN** a store's flat planning tree was retired and flat planning content is present again
- **THEN** doctor reports it as a re-introduced flat tree and does not offer the retirement command
- **AND** adopt, eject, archive relocation, and membership record writes all refuse while it persists

### Requirement: Commands Tolerate a Missing Changes Directory

The `archive` and `list` commands SHALL treat a missing `rasen/changes/` directory as an empty change set rather than throwing an initialization error, so that commands run against a fresh/empty store do not crash.

#### Scenario: Archive against an empty store lists no changes instead of throwing

- **WHEN** `archive` runs and `rasen/changes/` does not exist
- **THEN** the missing-directory `ENOENT` is swallowed (non-ENOENT errors are rethrown) and the active-change list is empty
- **AND** the command reports that the requested change is not found because no active changes exist in this root, rather than a "no changes directory" init error

#### Scenario: List against an empty store shows the empty state

- **WHEN** `list` runs and `rasen/changes/` does not exist
- **THEN** directory reading returns an empty set (ENOENT swallowed, other errors rethrown)
- **AND** the command displays "No active changes found." and exits 0

