# bundle-import-crash-consistency Specification

## Purpose
Multi-record bundle import is atomic for catchable failures (rollback) but is honestly not crash-safe across process kill or power loss: a crash may leave a subset published. A transaction marker detects the partial state on the next import and reports it as degraded rather than falsely complete.
## Requirements
### Requirement: Multi-record import is atomic for catchable failures but not crash-safe across process kill

A multi-record knowledge bundle import SHALL publish records atomically for catchable exceptions: if an error is thrown during publication, all records published in that transaction SHALL be rolled back so the catalog is left as it was before the import began. This atomicity guarantee SHALL NOT extend to process kill (SIGKILL) or power loss: a crash during a multi-record import MAY leave a subset of records published. The spec and CLI documentation SHALL state this boundary honestly, without claiming unconditional all-or-nothing import.

#### Scenario: A catchable exception rolls back all published records

- **WHEN** a multi-record import throws an error after publishing some records
- **THEN** all records published in that transaction are removed
- **AND** the catalog is restored to its pre-import state

#### Scenario: Process kill during multi-record import leaves a partial set

- **WHEN** a multi-record import is interrupted by SIGKILL or power loss after publishing some records
- **THEN** the published records remain in the catalog
- **AND** the import is not falsely reported as complete or all-or-nothing

### Requirement: A partial import is detected and reported on the next run

After a multi-record import is interrupted by process kill or power loss, the next import or catalog operation on the same project SHALL detect that a previous import was interrupted and SHALL report which records from the expected set were published and which were not. The detection SHALL be best-effort: it reports degraded consistency rather than silently treating the catalog as complete or inconsistent without explanation.

#### Scenario: A stale transaction marker is detected on the next import

- **WHEN** a previous multi-record import was interrupted and the next import runs against the same project catalog
- **THEN** the import detects the stale transaction marker
- **AND** it reports which expected records are published and which are missing
- **AND** the marker is cleaned up after reporting so the user can proceed

#### Scenario: No marker means no degraded report

- **WHEN** no transaction marker exists from a previous import
- **THEN** no degraded consistency diagnostic is produced
- **AND** the import proceeds normally

