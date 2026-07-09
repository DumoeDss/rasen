# change-work-dir Specification (delta)

## ADDED Requirements

### Requirement: The home layout includes an archived-change work area

The machine-home layout SHALL include a work area for archived changes at `changes/archive/<archived-dir-name>/work` inside the project home, keyed by the archived directory's date-prefixed name, provided by the home layout owner (the project-home resolver) rather than derived by consumers. This area holds ephemera migrated from archived change directories and is distinct from live changes' work directories, so an archived change and a live change sharing a base name never share state.

#### Scenario: Archived work area is distinct from the live work directory

- **WHEN** the home layout resolves the archived-work location for `2026-07-06-foo` and the work directory for a live change `foo`
- **THEN** the two SHALL be different directories under the same project home

### Requirement: Migration completes the sticky-legacy lifecycle

Migrating a legacy ephemeron moves it from the change directory to the resolved work location, after which the work-directory copy is the ONLY copy: workDir-first readers (run-state resolution, ship's evidence pre-flight, archive gates, retro) SHALL find migrated state exactly as they find born-external state, with no reader changes required, and sticky-legacy writers SHALL treat the change as born-external from then on (no legacy file remains to stick to). Migration SHALL never create the both-copies-exist state the sticky-legacy policy guards against.

#### Scenario: Resume reads migrated run-state

- **WHEN** a change's `auto-run.json` is migrated to its work directory and `rasen pipeline resume <change>` runs
- **THEN** resume SHALL read the migrated run-state (`hasRunState: true`) and report the work directory as its source

#### Scenario: Post-migration writes go external

- **WHEN** a workflow appends to a migrated change's run-state or reports after migration
- **THEN** the writes SHALL target the work directory (no change-directory copy exists to stick to)
