## ADDED Requirements

### Requirement: A backup-cleanup failure after successful publication never deletes the new record

When a learned-skill catalog mutation publishes a new record successfully and the subsequent backup cleanup fails (partial recursive delete, Windows file lock, antivirus interference, or I/O fault), the system SHALL retain the published new record intact. The system SHALL NOT delete the new record, SHALL NOT restore the partially-deleted backup, and SHALL NOT throw an error that prevents the mutation from being reported as successful. The system SHALL leave the backup debris in place and SHALL report a degraded condition naming the debris path.

#### Scenario: A partial-delete failure during backup cleanup leaves the new record intact

- **WHEN** a catalog rewrite publishes the new record and the backup cleanup throws after removing some backup files
- **THEN** the new record remains on disk and is readable
- **AND** the partially-deleted backup is NOT restored as the canonical record
- **AND** the mutation result includes a degraded warning naming the debris path

#### Scenario: A rename mutation's backup cleanup failure leaves the new record intact

- **WHEN** a catalog rename writes the new record and the old-record backup cleanup fails
- **THEN** the new record remains on disk and is readable
- **AND** the old record's backup debris is left in place rather than restored
- **AND** the mutation result includes a degraded warning

#### Scenario: Backup debris is cleaned on the next mutation

- **WHEN** backup debris from a prior cleanup failure exists in the catalog directory
- **THEN** the next mutation's debris sweep discovers and removes it before proceeding
- **AND** the debris does not interfere with catalog reads
