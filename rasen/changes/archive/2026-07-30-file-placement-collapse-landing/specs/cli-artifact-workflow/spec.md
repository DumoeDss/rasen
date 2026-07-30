## MODIFIED Requirements

### Requirement: New Change Command
The system SHALL create new change directories with validation.

#### Scenario: Create valid change
- **WHEN** user runs `rasen new change add-feature`
- **THEN** the system creates `rasen/changes/add-feature/` directory

#### Scenario: Invalid change name
- **WHEN** user runs `rasen new change "Add Feature"` with invalid name
- **THEN** the system displays validation error with guidance

#### Scenario: Duplicate change name
- **WHEN** user runs `rasen new change existing-change` for an existing change
- **THEN** the system displays an error indicating the change already exists

#### Scenario: Create with description
- **WHEN** user runs `rasen new change add-feature --description "Add new feature"`
- **THEN** the system creates the change directory with description in README.md

#### Scenario: Pipeline run-state initializes in the execution root

- **WHEN** user runs `rasen new change add-feature --pipeline small-feature`
- **THEN** the change's initial run-state SHALL be created in the execution root's ephemera directory (`<executionRoot>/.rasen/changes/add-feature/ephemera/`), never in the machine-home work directory
- **AND** creating a change with the same name in a different worktree of the same project SHALL succeed (per-worktree run-state)

## ADDED Requirements

### Requirement: Change-scoped workflow payloads carry the per-class landing directories

The change-scoped workflow surfaces (`rasen status --change <n> --json`, `rasen instructions <artifact> --change <n> --json`, and the apply-instructions payload) SHALL expose the change's per-class landing directories as absolute paths: `evidenceDir` (`<changeRoot>/evidence`), `handoffDir` (`<changeRoot>/handoff`), and `ephemeraDir` (`<executionRoot>/.rasen/changes/<n>/ephemera`). These fields SHALL always be present (they derive from the planning and execution roots, needing no machine identity). The legacy `workDir` field SHALL additionally be present, probe-only, when the project already has a machine identity — absent otherwise — so sticky-legacy readers can check the legacy location. No surface SHALL mint machine identity or create directories to produce these fields.

#### Scenario: Payloads include the landing directories

- **WHEN** `rasen status --change <n> --json` or an instructions payload is produced
- **THEN** the JSON SHALL include absolute `evidenceDir`, `handoffDir`, and `ephemeraDir` paths
- **AND** the paths SHALL be correct on Windows and POSIX platforms

#### Scenario: Landing directories resolve without machine identity

- **WHEN** the project has no machine identity
- **THEN** the payload SHALL still include `evidenceDir`, `handoffDir`, and `ephemeraDir`
- **AND** SHALL omit `workDir` entirely
- **AND** the command SHALL perform no writes

### Requirement: Status payload reports the fixed archive location and legacy archives

`rasen status --change <n> --json`'s `archive` object SHALL carry `archiveDir` — the absolute in-repo archive directory (`<planningRoot>/rasen/changes/archive`), always present — and, when a machine home resolves by read-only probe and its archive area exists, `legacyArchiveDir` naming the machine-home archive for legacy discovery. The object SHALL NOT carry a `destination` axis. Resolving these fields SHALL NOT write anywhere and SHALL NOT invoke git or `gh`.

#### Scenario: Status exposes the fixed archive location

- **WHEN** `rasen status --change <n> --json` runs
- **THEN** the payload's `archive` object SHALL include the absolute in-repo `archiveDir`
- **AND** SHALL NOT include a `destination` field

#### Scenario: Legacy archives surfaced read-only

- **WHEN** the project's machine home holds archives from the retired external destination
- **THEN** the payload SHALL include `legacyArchiveDir`
- **AND** the command SHALL perform no writes to produce it

## REMOVED Requirements

### Requirement: Change-scoped workflow payloads carry the work directory

**Reason**: Superseded by the per-class landing directories requirement above — payloads now carry `evidenceDir`/`handoffDir`/`ephemeraDir` always, with `workDir` demoted to a probe-only legacy field, and the instructions surfaces no longer establish machine identity.

**Migration**: Consumers read the per-class fields for new writes and `workDir` (when present) for sticky-legacy reads.

### Requirement: Status payload carries the resolved archive destination and location

**Reason**: The destination axis is retired (`archive-destination` capability); the archive location is fixed to the planning root, with legacy machine-home archives surfaced read-only for discovery.

**Migration**: Templates read `archive.archiveDir` (always in-repo) and `archive.legacyArchiveDir` (when legacy archives exist) instead of branching on `archive.destination`.
