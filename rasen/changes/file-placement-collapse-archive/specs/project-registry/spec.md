# project-registry Specification Delta

## MODIFIED Requirements

### Requirement: Doctor surfaces pending legacy ephemera with the migration hint

`rasen doctor`'s machine-home section SHALL report, for a registered project, whether legacy machine-home work-directory contents eligible for migration to terminal locations exist and suggest `rasen work migrate`, in both human and `--json` output. The report SHALL count files by type (reports, handoff documents, run-state) so the suggested command's likely effect is visible — a project whose work directories hold only run-state for archived changes (which will be discarded, not migrated) sees a different hint than one holding unread reports. The detection SHALL scan the machine-home work directories (the legacy `workDir` locations resolved via the `change-work-dir` capability) rather than in-repo change directories, matching the inverted migrator's scan surface. When the machine home cannot be resolved (unregistered project), the hint SHALL be omitted. The detection SHALL remain read-only and SHALL NEVER mint the machine home — doctor never moves files and never mints identity.

#### Scenario: Doctor hints at migratable legacy state

- **WHEN** `rasen doctor` runs in a registered project whose machine-home work directories contain legacy reports and run-state
- **THEN** the machine-home section SHALL report the file counts by type and suggest `rasen work migrate`
- **AND** no file SHALL be moved by doctor

#### Scenario: Clean project shows no hint

- **WHEN** `rasen doctor` runs in a project whose machine-home work directories are empty or contain no legacy state
- **THEN** the machine-home section SHALL omit the migration hint

#### Scenario: Unregistered project omits the hint

- **WHEN** `rasen doctor` runs in a project with no machine-home registration
- **THEN** the machine-home section SHALL omit the migration hint
- **AND** SHALL NOT mint identity to check
