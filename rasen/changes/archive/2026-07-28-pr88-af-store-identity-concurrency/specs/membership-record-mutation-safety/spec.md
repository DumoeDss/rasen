## ADDED Requirements

### Requirement: All membership record mutations acquire the shared lock and re-read inside it

Every operation that reads a project membership record, modifies it, and writes or deletes it — including `store eject`, `migrate-membership --apply`, and `store add-project` — SHALL acquire the same machine-local lock keyed by the project record's canonical path. The record SHALL be re-read inside the lock before the mutation is composed, so a concurrent write between the initial read and the overwrite is not silently dropped.

#### Scenario: A concurrent add-project is not dropped by a concurrent eject

- **WHEN** a `store eject` reads a project's membership record, and a concurrent `store add-project` writes a new role to the same record before the eject writes its modified version
- **THEN** the eject acquires the shared lock, re-reads the record inside it, and sees the newly-added role
- **AND** the newly-added role is not silently lost

#### Scenario: A concurrent add-project is not dropped by a concurrent migrate-membership apply

- **WHEN** a `migrate-membership --apply` writes a converted record, and a concurrent `store add-project` has already written a role to that record
- **THEN** the migration acquires the shared lock per record, re-reads the current record inside it, and merges rather than overwriting
- **AND** the concurrent add-project's role survives the migration
