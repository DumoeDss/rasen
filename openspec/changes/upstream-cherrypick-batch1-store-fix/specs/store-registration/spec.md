## ADDED Requirements

### Requirement: Empty Planning Directories Are Optional for Store Health

When inspecting an OpenSpec store root, the `openspec/specs/`, `openspec/changes/`, and `openspec/changes/archive/` directories SHALL be treated as optional. A store that has `openspec/config.yaml` but is missing some or all of these planning directories SHALL be considered healthy and registrable. Only a planning path that exists but is not a directory SHALL be a health diagnostic.

#### Scenario: Config-only store is healthy

- **WHEN** a store root has `openspec/config.yaml` and no `specs/`, `changes/`, or `changes/archive/` directories
- **THEN** inspection reports the root as healthy (`present && config.present && no diagnostics`)
- **AND** registering it as a store succeeds without first creating the empty planning directories

#### Scenario: Missing planning directory is not a diagnostic

- **WHEN** a planning directory (`specs/`, `changes/`, or `archive/`) is absent
- **THEN** it is recorded as `{ present: false }` without pushing an error diagnostic
- **AND** archive is only inspected when `changes/` is itself a directory

#### Scenario: A non-directory planning path is a diagnostic

- **WHEN** a planning path such as `openspec/changes/archive` exists but is a file rather than a directory
- **THEN** inspection pushes an `*_not_directory` diagnostic (e.g. `openspec_archive_not_directory`)
- **AND** the root is reported unhealthy

### Requirement: Reject a Config-Only Pointer Repo as a Store Root

Registering a store SHALL reject a repository whose `openspec/config.yaml` declares a `store:` pointer (its planning is externalized) because such a repo is not itself a store root. A malformed `store:` pointer SHALL also be rejected. A repo with real planning shape SHALL be unaffected.

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

### Requirement: Commands Tolerate a Missing Changes Directory

The `archive` and `list` commands SHALL treat a missing `openspec/changes/` directory as an empty change set rather than throwing an initialization error, so that commands run against a fresh/empty store do not crash.

#### Scenario: Archive against an empty store lists no changes instead of throwing

- **WHEN** `archive` runs and `openspec/changes/` does not exist
- **THEN** the missing-directory `ENOENT` is swallowed (non-ENOENT errors are rethrown) and the active-change list is empty
- **AND** the command reports that the requested change is not found because no active changes exist in this root, rather than a "no changes directory" init error

#### Scenario: List against an empty store shows the empty state

- **WHEN** `list` runs and `openspec/changes/` does not exist
- **THEN** directory reading returns an empty set (ENOENT swallowed, other errors rethrown)
- **AND** the command displays "No active changes found." and exits 0
