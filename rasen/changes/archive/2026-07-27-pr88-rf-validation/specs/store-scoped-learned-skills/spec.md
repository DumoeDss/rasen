## MODIFIED Requirements

### Requirement: Mutating a Store's catalog preserves ownership and never leaves a half-written result

A command that changes a Store's catalog SHALL only modify records the catalog declares it owns, SHALL write each record so that no partially written record is ever visible, and SHALL NOT create a commit or stage anything in the Store's repository. A mutation that fails SHALL leave the catalog exactly as it was and report what stopped it. A mutation killed outright cannot be undone by the process that died, so the previous record SHALL be preserved rather than lost, and the next mutation SHALL restore it and remove the leftovers before it reads the catalog — the guarantee is that no content is destroyed and no half-written record is ever read, not that a killed process leaves no trace at all. Files the user authored themselves SHALL never be modified or deleted by a catalog mutation. A read that encounters recoverable debris left by a killed mutation — a backup directory the process renamed the previous record into before it died — SHALL report the catalog as degraded rather than as empty, so that resolution and materialization defer cleanup rather than treating the catalog as one with nothing in it. The next mutation SHALL still restore the backup and clear the leftovers, as before.

#### Scenario: Only owned records are modified

- **WHEN** a catalog mutation runs against a Store containing both managed records and user-authored files
- **THEN** only the records the catalog declares it owns are changed
- **AND** user-authored files are left exactly as they were

#### Scenario: An interrupted mutation leaves no partial record

- **WHEN** a catalog mutation is interrupted mid-write
- **THEN** no partially written record exists
- **AND** a mutation that fails leaves the catalog reading exactly as it did before it started
- **AND** when the process was killed outright, the record it was replacing is still on disk and the next mutation restores it and clears the leftovers

#### Scenario: A read between the kill and the next mutation reports the catalog as degraded

- **WHEN** a killed mutation left a backup directory in the Store's catalog and no subsequent mutation has run yet to restore it
- **THEN** reading the catalog reports the recoverable backup rather than treating the catalog as empty
- **AND** resolution and materialization treat the Store's catalog as unavailable rather than as one with nothing in it
- **AND** no generated file the backed-up record owned is removed or modified on the strength of the catalog appearing empty

#### Scenario: A mutation never commits

- **WHEN** a catalog mutation completes
- **THEN** it prints the files the user needs to commit
- **AND** it has staged, committed, and pushed nothing

#### Scenario: Cross-platform record paths

- **WHEN** a Store's catalog is written and read back on Windows
- **THEN** every record resolves under the Store's catalog directory using platform path resolution
