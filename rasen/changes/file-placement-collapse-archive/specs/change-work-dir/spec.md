# change-work-dir Specification Delta

## MODIFIED Requirements

### Requirement: Migration completes the sticky-legacy lifecycle

Migrating a legacy ephemeron moves it FROM the machine-home work location TO the terminal file-placement location defined by the `file-placement` capability (evidence files to `<changeRoot>/evidence/`, handoff to `<changeRoot>/handoff/`, run-state to `<executionRoot>/.rasen/changes/<c>/ephemera/`). After migration, the terminal-location copy is the ONLY copy: readers following the resolution chain (terminal location first, then the legacy work directory, then the change directory — per the `file-placement` capability's sticky-legacy chain) SHALL find migrated state exactly as they find born-terminal state, with no reader changes required. Migration SHALL never create a state where one file exists in two locations. For an archived change, run-state is discarded (it has no recovery semantics post-archive) and listed in the migration report rather than migrated.

#### Scenario: Resume reads migrated run-state from the terminal location

- **WHEN** a change's `auto-run.json` was migrated from its work directory to the execution-root ephemera directory and `rasen pipeline resume <change>` runs
- **THEN** resume SHALL read the migrated run-state from the ephemera directory (`hasRunState: true`)
- **AND** the work directory SHALL no longer contain the file

#### Scenario: Post-migration reads find the terminal copy

- **WHEN** a change's `review-report.md` was migrated from its work directory to `<changeRoot>/evidence/`
- **THEN** readers SHALL find it at the terminal location
- **AND** the work directory SHALL no longer contain a copy

#### Scenario: Archived change run-state is discarded

- **WHEN** migration encounters run-state for an archived change
- **THEN** the run-state SHALL be discarded rather than migrated
- **AND** the migration report SHALL list the discarded files
