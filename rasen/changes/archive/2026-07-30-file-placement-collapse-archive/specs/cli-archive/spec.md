# cli-archive Specification Delta

## ADDED Requirements

### Requirement: Ephemera cleaning at archive time

`rasen archive` SHALL run the ephemera cleaner (defined by the `file-placement` capability) against the change's ephemera directory before moving the change directory to the archive. The cleaner deletes only whitelisted filenames and preserves every unknown entry with its exact path reported. The deleted filenames SHALL be recorded in `archive.json`'s `ephemeraDiscarded` array. When the ephemera directory does not exist (the change produced no ephemera), the cleaner SHALL be a no-op.

#### Scenario: Ephemera is cleaned before the move

- **WHEN** `rasen archive <change>` runs and the change's ephemera directory contains `auto-run.json`
- **THEN** the cleaner SHALL delete `auto-run.json` before the change directory moves
- **AND** `auto-run.json` SHALL appear in `archive.json`'s `ephemeraDiscarded`

#### Scenario: No ephemera directory is a no-op

- **WHEN** the change has no ephemera directory at the execution root
- **THEN** the cleaner SHALL complete without error
- **AND** `ephemeraDiscarded` SHALL be empty or absent

#### Scenario: Source-manifest discovery blocks the cleaner for that change

- **WHEN** the ephemera directory contains a `package.json` or `Cargo.toml`
- **THEN** the cleaner SHALL abort for that change (delete nothing)
- **AND** archive SHALL proceed with the move
- **AND** the archive output SHALL report the discovered manifest path and that cleaning was skipped

### Requirement: The --keep-ephemera flag preserves all ephemera

`rasen archive` SHALL accept a `--keep-ephemera` flag that skips the ephemera cleaner entirely. When the flag is present, no ephemera file SHALL be deleted, `ephemeraDiscarded` SHALL be empty or absent, and the archive SHALL proceed normally in all other respects.

#### Scenario: --keep-ephemera skips the cleaner

- **WHEN** `rasen archive <change> --keep-ephemera` runs
- **THEN** no ephemera file SHALL be deleted
- **AND** `archive.json` SHALL NOT list any `ephemeraDiscarded` entries
- **AND** the change directory SHALL still move to the archive

### Requirement: The --dry-run flag previews all planned actions without executing

`rasen archive` SHALL accept a `--dry-run` flag that reports every action the archive would take without executing any of them. The dry-run output SHALL include: the spec sync plan (which specs would be created/updated), the pending ephemera delete list (exact filenames), the handoff absorption status (if the skill is not involved, a note that handoff travels unchanged), the planned archive directory name, and any blocking conditions. No file SHALL be moved, deleted, or written.

This closes the validate blind spot: `rasen validate` does not apply deltas to main specs, but `rasen archive --dry-run` previews the full spec rebuild and disposition logic without committing.

#### Scenario: Dry-run reports the pending-delete list

- **WHEN** `rasen archive <change> --dry-run` runs and the ephemera directory contains `auto-run.json` and `custom.json`
- **THEN** the output SHALL list `auto-run.json` as pending-delete (whitelisted)
- **AND** SHALL list `custom.json` as preserved (unknown)
- **AND** neither file SHALL be deleted

#### Scenario: Dry-run reports the spec sync plan

- **WHEN** `rasen archive <change> --dry-run` runs and the change has delta specs
- **THEN** the output SHALL list each spec that would be created or updated
- **AND** no main spec file SHALL be written

#### Scenario: Dry-run moves nothing

- **WHEN** `rasen archive <change> --dry-run` completes
- **THEN** the change directory SHALL remain in its original location
- **AND** no archive directory SHALL be created
- **AND** no `archive.json` SHALL be written

### Requirement: archive.json is written to the archived directory

After the change directory moves to the archive, `rasen archive` SHALL write `archive.json` inside the archived directory with the fields defined by the `file-placement` capability (change name, timestamp, `codeCommit`, `planningBranch`, `planningTreeState`, evidence hashes, probes, `handoffAbsorbed`, `ephemeraDiscarded`, `missing`). The `codeCommit` SHALL be resolved from the execution root (for a store-selected run, the code project's HEAD; otherwise the planning root's HEAD). The `planningBranch` and `planningTreeState` SHALL be resolved from the planning root's git status at archive time. When the planning root is not a git work tree, `planningBranch` SHALL be `null` and `planningTreeState` SHALL be `clean`.

#### Scenario: archive.json is written after the move

- **WHEN** `rasen archive <change>` completes successfully
- **THEN** the archived directory SHALL contain `archive.json`
- **AND** the file SHALL carry `codeCommit`, `planningBranch`, and `planningTreeState`

#### Scenario: Store-selected run records the code project's commit

- **WHEN** a store-selected change is archived
- **THEN** `codeCommit` SHALL be the code project's HEAD SHA, not the store's HEAD SHA

#### Scenario: Non-git planning root records null branch

- **WHEN** the planning root is not a git work tree
- **THEN** `planningBranch` SHALL be `null` and `planningTreeState` SHALL be `clean`
