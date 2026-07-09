# project-registry Specification (delta)

## ADDED Requirements

### Requirement: Doctor surfaces pending legacy ephemera with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy in-repo ephemera eligible for migration exist and suggest `rasen work migrate`, in both human and `--json` output. The count SHALL be split into tracked and untracked (using the same read-only git classification `rasen work migrate` uses) so the suggested command's likely effect is honest — a project whose pending ephemera are mostly tracked would move 0 files on a default run, and the hint SHALL say so rather than imply otherwise. When the split itself cannot be determined (non-git root, or the git query fails), the hint SHALL report the total count with the split marked unavailable rather than guessing. The detection SHALL remain read-only and SHALL NEVER resolve or mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable ephemera with the tracked/untracked split

- **WHEN** `rasen doctor` runs in a registered project whose change directories contain a mix of tracked and untracked legacy ephemera
- **THEN** the machine-home section SHALL show both counts (e.g. "N untracked (+M tracked, needs --include-tracked)") and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project with no legacy ephemera
- **THEN** the machine-home section SHALL omit the migration hint
