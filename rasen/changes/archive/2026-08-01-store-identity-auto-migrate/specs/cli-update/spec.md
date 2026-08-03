## ADDED Requirements

### Requirement: Update performs a store-identity migration pass

After completing the tool and version propagation and the multi-project update offer, `rasen update` SHALL perform a machine-wide store-identity migration pass that mints permanent identities for eligible registered Stores that lack one, backfills the uid into every affected project's `storeMemberships` hints, and re-keys the machine Store registry by permanent identity when every Store entry carries one.

The migration pass SHALL be best-effort: a failure at any stage SHALL emit a warning naming the problem and direct the user to `rasen store upgrade-identity --all --apply`, and SHALL NOT abort the update. A Store whose path is missing, whose metadata is unreadable, or that is locked SHALL be skipped with a reason; the batch SHALL continue with the remaining Stores.

The pass SHALL run once per top-level `rasen update` invocation. It SHALL NOT run when `--only-this` is supplied, consistent with the multi-project offer gate.

The migration SHALL respect rasen's git discipline: Store metadata and project configuration files SHALL be written to disk but never committed; the summary SHALL name the files to commit per repository.

#### Scenario: Update migrates identityless Stores

- **WHEN** a user runs `rasen update` and one or more registered Stores lack a permanent identity
- **AND** those Stores have reachable paths with readable metadata
- **THEN** the update command mints permanent identities for those Stores
- **AND** backfills the uid into every registered project whose `storeMemberships` names those Stores by alias
- **AND** reports the outcome in the update summary
- **AND** suggests the files to commit per repository

#### Scenario: Warning is silent after update

- **WHEN** `rasen update` has completed the store-identity migration
- **THEN** a subsequent command that parses a project configuration whose `storeMemberships` was backfilled SHALL NOT emit the `storeMembershipsWithoutIdentity` warning

#### Scenario: Unresolvable Store is reported, not fatal

- **WHEN** `rasen update` encounters a registered Store whose path does not exist
- **THEN** the Store is skipped with a reason in the migration summary
- **AND** the remaining Stores are still upgraded
- **AND** the machine registry re-key reports the unresolvable Store as blocking
- **AND** the update completes successfully

#### Scenario: `--only-this` skips the migration

- **WHEN** a user runs `rasen update --only-this`
- **THEN** the store-identity migration pass SHALL NOT run
- **AND** no Store metadata or project `storeMemberships` hints are modified by the migration

#### Scenario: All Stores already identified

- **WHEN** `rasen update` runs and every registered Store already carries a permanent identity
- **THEN** the migration pass reports that no migration was needed
- **AND** no Store metadata or project configuration is modified

#### Scenario: Migration failure does not abort update

- **WHEN** the store-identity migration throws an unrecoverable error
- **THEN** the update command emits a warning directing the user to `rasen store upgrade-identity --all --apply`
- **AND** the update command completes successfully (the skill files are already refreshed on disk)

#### Scenario: Suggested commits, never auto-commit

- **WHEN** the migration writes Store metadata and project configuration files
- **THEN** the update summary names each repository and the files to commit
- **AND** no `git add` or `git commit` is executed by the update command
