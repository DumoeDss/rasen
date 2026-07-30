# work-migration Specification Delta

## MODIFIED Purpose

Define `rasen work migrate`: a preview-first, git-boundary-safe command that consolidates legacy machine-home state into the terminal file-placement locations established by the `file-placement` capability — moving old `workDir` reports to `<changeRoot>/evidence/`, old `workDir` handoff to `<changeRoot>/handoff/`, old `workDir` run-state to the execution root's ephemera area (or discarding it for archived changes with a list), reclassifying machine-root historical probe directories one-by-one per the classification order, and moving `machineHome/design-docs/` to `<planningRoot>/rasen/design-docs/`. The command never overwrites on conflict (keeps both copies and hands the authority call to the user), never moves review material, and never writes to git on the caller's behalf.

## MODIFIED Requirements

### Requirement: A command migrates legacy machine-home state to terminal locations

The CLI SHALL provide `rasen work migrate` (the `work` command group) that scans the resolved project's machine-home work directories (for both active and archived changes) and moves their legacy contents into the terminal file-placement locations. The migration set and routing follow the file class:

- **Reports** (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, and other `*-report.md` files) SHALL move to `<changeRoot>/evidence/` for active changes, or the corresponding Archive's `evidence/` for archived changes.
- **Handoff documents** SHALL move to `<changeRoot>/handoff/` (active) or the Archive's `handoff/` (archived). The terminal `handoff/` directory IS a migration target in this direction — it was a non-target only in the old direction.
- **Run-state** (`auto-run.json`, `portfolio-run.json`, `goal-run.json`) SHALL move to `<executionRoot>/.rasen/changes/<c>/ephemera/` for active changes. For archived changes, run-state SHALL be discarded and listed in the migration report (an archived change's run-state has no recovery semantics).
- **Machine-root historical probe directories** SHALL be reclassified one-by-one per the classification order (`file-placement` capability): driver and harness code moves to the execution root as probes; sampling output (raw JSON, logs, captures) moves to ephemera; conclusions (markdown-only or unrecognized directories) SHALL be PRESERVED by default — the migrator cannot verify absorption, so only an explicit `--discard-absorbed-conclusions` flag (confirming the user/skill has verified absorption) MAY delete them. The migration report SHALL list each directory's classification result.
- **design-docs** at `machineHome/design-docs/` SHALL move to `<planningRoot>/rasen/design-docs/`.

Review material (proposal, design, tasks, delta specs, `planning-context.md`), `.openspec.yaml`, and `retro.md` SHALL never be moved. Report-like files outside the known set and custom run-artifact names SHALL be reported, not moved. The command SHALL support `--change <name>` scoping and construct all paths with the platform path module. The command SHALL NOT write to git on the caller's behalf.

#### Scenario: Old workDir reports move to evidence

- **WHEN** `rasen work migrate` executes for a change whose machine-home work directory contains `review-report.md` and `ship-log.md`
- **THEN** those files SHALL move to `<changeRoot>/evidence/`
- **AND** the work directory SHALL no longer contain them

#### Scenario: Old workDir handoff moves to the terminal handoff directory

- **WHEN** the work directory contains `handoff/implementer-1.md`
- **THEN** it SHALL move to `<changeRoot>/handoff/implementer-1.md`
- **AND** the work directory's `handoff/` SHALL no longer contain it

#### Scenario: Old workDir run-state moves to ephemera

- **WHEN** the work directory contains `auto-run.json`
- **THEN** it SHALL move to `<executionRoot>/.rasen/changes/<c>/ephemera/auto-run.json`

#### Scenario: Archived change run-state is discarded and listed

- **WHEN** `rasen work migrate` encounters run-state for an archived change
- **THEN** the run-state SHALL be discarded
- **AND** the migration report SHALL list the discarded files

#### Scenario: Machine-root probe directories are reclassified one-by-one

- **WHEN** the machine root contains historical probe directories (e.g., from session-cache probes)
- **THEN** each directory SHALL be classified per the classification order
- **AND** the migration report SHALL list each directory's classification and resulting action

#### Scenario: design-docs move to the planning root

- **WHEN** `machineHome/design-docs/` contains design documents
- **THEN** they SHALL move to `<planningRoot>/rasen/design-docs/`

#### Scenario: Review material is never a candidate

- **WHEN** the migration scans a change directory containing `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `retro.md`
- **THEN** none of those SHALL appear in the migration plan

#### Scenario: Scoped migration

- **WHEN** `rasen work migrate --change <name>` runs
- **THEN** only that change's legacy state SHALL be considered

### Requirement: Migration conflicts never overwrite — both copies are kept

A destination file that already exists SHALL never be overwritten. The migration SHALL keep both copies (the legacy source and the existing terminal-location destination) and report the conflict for the human to judge which is authoritative. This applies in every direction: evidence conflicts, handoff conflicts, ephemera conflicts, and design-docs conflicts. The migration report SHALL list every conflict with both file paths.

#### Scenario: Evidence destination already exists

- **WHEN** a report's destination `<changeRoot>/evidence/review-report.md` already exists
- **THEN** the legacy file SHALL be left in place
- **AND** the conflict SHALL be reported with both paths

#### Scenario: design-docs destination already exists

- **WHEN** a design doc's destination `<planningRoot>/rasen/design-docs/foo.md` already exists
- **THEN** the legacy copy SHALL be left in place
- **AND** the conflict SHALL be reported with both paths

### Requirement: Destinations are collision-free and survive registry GC

Active changes' migrated state SHALL land inside the change directory (evidence, handoff) or the execution root (ephemera), so it travels with the repository and does not depend on the machine-home registration. Archived changes' migrated reports and handoff SHALL land inside the archived directory. Both the change directory and the archive directory reside inside the planning root, so migrated state survives registry garbage collection by construction — it is in the repo, not in the machine home.

#### Scenario: Migrated evidence survives registry GC

- **WHEN** `rasen doctor --gc` runs after a migration while the project remains registered
- **THEN** migrated files inside the change directory SHALL NOT be deleted (they are in the repo)

#### Scenario: Archived change migrates inside the archive

- **WHEN** reports under `changes/archive/2026-07-06-foo/work/` migrate
- **THEN** they SHALL land in `changes/archive/2026-07-06-foo/evidence/`
- **AND** the active change `foo`'s evidence directory SHALL be unaffected

### Requirement: Migration is preview-first and idempotent

The command SHALL present a per-file plan (source, destination, file-type classification, conflicts, notes) before moving anything. Interactive runs SHALL confirm after the preview; `--dry-run` SHALL always stop at the preview; `--json` runs SHALL be non-interactive and SHALL execute only with an explicit `--yes`, otherwise emitting the plan as JSON without moving files. A re-run after a completed migration SHALL find nothing to move and say so. Per-file move failures SHALL be reported without aborting the remainder of the run. The plan SHALL NOT include tracked/untracked classification — the inverted migrator scans machine-home work directories (not in-repo change directories), so git-tracked status is irrelevant to migration candidates.

#### Scenario: Dry run moves nothing

- **WHEN** `rasen work migrate --dry-run` executes
- **THEN** the full per-file plan SHALL be printed and no file SHALL move

#### Scenario: JSON without --yes is a preview

- **WHEN** `rasen work migrate --json` executes without `--yes`
- **THEN** the JSON plan SHALL be emitted and no file SHALL move

#### Scenario: Second run is a no-op

- **WHEN** the command runs again after a successful migration
- **THEN** it SHALL report nothing to migrate and exit successfully

#### Scenario: A preview never mints machine identity

- **WHEN** `rasen work migrate` previews (`--dry-run`, or `--json` without `--yes`, or the interactive preview shown before the confirmation prompt) in a project with no machine identity registered yet
- **THEN** `rasen/config.yaml` and the machine-wide project registry SHALL remain byte-for-byte unchanged
- **AND** the command SHALL report that destinations are pending (not fail, and not fabricate a real path) — identity SHALL be minted only by a subsequent call that actually executes

## REMOVED Requirements

### Requirement: Git-tracked ephemera move only on explicit opt-in, with no git writes

The inverted migrator scans machine-home work directories, not in-repo change directories, so git-tracked classification of migration candidates no longer applies. The `--include-tracked` flag is retired. The command still SHALL NOT invoke any git write operation.
