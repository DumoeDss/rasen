# project-registry Specification Delta

## REMOVED Requirements

### Requirement: Doctor surfaces pending legacy ephemera with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy in-repo ephemera eligible for migration exist and suggest `rasen work migrate`, in both human and `--json` output. The count SHALL be split into tracked and untracked (using the same read-only git classification `rasen work migrate` uses) so the suggested command's likely effect is honest — a project whose pending ephemera are mostly tracked would move 0 files on a default run, and the hint SHALL say so rather than imply otherwise. When the split itself cannot be determined (non-git root, or the git query fails), the hint SHALL report the total count with the split marked unavailable rather than guessing. The detection SHALL remain read-only and SHALL NEVER resolve or mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable ephemera with the tracked/untracked split

- **WHEN** `rasen doctor` runs in a registered project whose change directories contain a mix of tracked and untracked legacy ephemera
- **THEN** the machine-home section SHALL show both counts (e.g. "N untracked (+M tracked, needs --include-tracked)") and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project with no legacy ephemera
- **THEN** the machine-home section SHALL omit the migration hint

## ADDED Requirements

### Requirement: Doctor surfaces pending legacy work-directory state with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy machine-home work-directory contents eligible for migration to terminal locations exist and suggest `rasen work migrate`, in both human and `--json` output. The report SHALL count files by type (reports, handoff documents, run-state) so the suggested command's likely effect is visible — a project whose work directories hold only run-state for archived changes (which will be discarded, not migrated) sees a different hint than one holding unread reports. The detection SHALL scan the machine-home work directories (the legacy `workDir` locations resolved via the `change-work-dir` capability) rather than in-repo change directories, matching the inverted migrator's scan surface. When the machine home cannot be resolved (unregistered project), the hint SHALL be omitted. The detection SHALL remain read-only and SHALL NEVER mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable ephemera with the tracked/untracked split

- **WHEN** `rasen doctor` runs in a registered project whose machine-home work directories contain legacy reports and run-state
- **THEN** the machine-home section SHALL report the file counts by type (reports, handoff, run-state) and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor
- **AND** the hint SHALL NOT include a tracked/untracked git classification (the inverted migrator scans machine-home, not in-repo change directories — git status is irrelevant)

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project whose machine-home work directories are empty or contain no legacy state
- **THEN** the machine-home section SHALL omit the migration hint

#### Scenario: Unregistered project omits the hint

- **WHEN** `rasen doctor` runs in a project with no machine-home registration
- **THEN** the machine-home section SHALL omit the migration hint
- **AND** SHALL NOT mint identity to check
