## MODIFIED Requirements

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

## ADDED Requirements

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
