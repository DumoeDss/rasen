## MODIFIED Requirements

### Requirement: Migration is preview-first and idempotent

The command SHALL derive a complete per-entry plan before moving or deleting anything. Each planned entry SHALL include source, destination when applicable, file-type classification, action, preconditions, conflicts visible during planning, and notes. Interactive runs SHALL confirm that plan; `--dry-run` SHALL always stop after displaying it; `--json` runs SHALL be non-interactive and SHALL apply only with an explicit `--yes`, otherwise emitting the plan as JSON without changing files.

Apply SHALL consume the planned actions without reclassifying them or changing an action based on execution mode. Apply outcomes such as moved, discarded, conflict, already absent, or failed SHALL be recorded separately from the immutable actions. A destination that appears after planning SHALL therefore change only the apply outcome to conflict, never the confirmed action or either copy's contents.

A re-run after a completed migration SHALL find nothing to move or discard and SHALL exit successfully. Per-entry mutation failures SHALL be reported without falsely marking the entry complete, and failures that leave both copies SHALL identify both paths. The plan SHALL NOT include tracked/untracked classification because the inverted migrator scans machine-home work directories rather than in-repo change directories.

#### Scenario: Dry run moves nothing

- **WHEN** `rasen work migrate --dry-run` executes
- **THEN** the complete per-entry plan SHALL be printed
- **AND** no file or directory SHALL move, be deleted, or be created

#### Scenario: JSON without --yes is a preview

- **WHEN** `rasen work migrate --json` executes without `--yes`
- **THEN** the JSON plan SHALL be emitted
- **AND** no file or directory SHALL move, be deleted, or be created

#### Scenario: Preview and apply actions are identical

- **WHEN** a migration is previewed and that plan is subsequently applied
- **THEN** the ordered action records used by apply SHALL be byte-equivalent to those displayed in preview
- **AND** runtime conflicts and failures SHALL appear only in the separate outcome records

#### Scenario: Confirmed conclusion deletion is visible in preview

- **WHEN** `--discard-absorbed-conclusions` is selected for a historical conclusion directory
- **THEN** the preview action SHALL be `discard`
- **AND** apply SHALL not replace a previewed `leave` action with `discard`

#### Scenario: Second run is a no-op

- **WHEN** the command runs again after a successful migration
- **THEN** it SHALL report nothing to migrate or discard and exit successfully

#### Scenario: A preview never mints machine identity

- **WHEN** `rasen work migrate` previews (`--dry-run`, `--json` without `--yes`, or the interactive preview) in a project with no machine identity registered yet
- **THEN** `rasen/config.yaml` and the machine-wide project registry SHALL remain byte-for-byte unchanged
- **AND** the command SHALL report that destinations are pending rather than fabricate a path

### Requirement: A command migrates legacy machine-home state to terminal locations

The CLI SHALL provide `rasen work migrate` (the `work` command group) that scans the resolved project's machine-home work directories for both active and archived changes and moves their legacy contents into terminal file-placement locations. The migration set and routing follow the file class:

- **Reports** (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, and other `*-report.md` files) SHALL move to `<changeRoot>/evidence/` for active changes, or the corresponding Archive's `evidence/` for archived changes.
- **Handoff documents** SHALL move to `<changeRoot>/handoff/` for active changes or the Archive's `handoff/` for archived changes.
- **Run-state** (`auto-run.json`, `portfolio-run.json`, `goal-run.json`) SHALL move to `<executionRoot>/.rasen/changes/<c>/ephemera/` for active changes. For archived changes, apply SHALL remove run-state and list it as discarded only after removal succeeds.
- **Machine-root historical probe directories** SHALL be reclassified one-by-one per the `file-placement` classification order: driver and harness code moves to execution-root probes; sampling output moves to ephemera; conclusions remain preserved unless `--discard-absorbed-conclusions` explicitly confirms deletion. The migration report SHALL list each directory's classification and action.
- **design-docs** at `machineHome/design-docs/` SHALL move to `<planningRoot>/rasen/design-docs/`.

Review material (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `planning-context.md`, `.openspec.yaml`, and `retro.md`) SHALL never move. Report-like files outside the known set and custom run-artifact names SHALL be reported rather than moved. All paths SHALL use platform-native path semantics, and the command SHALL NOT write to git on the caller's behalf.

When `--change <name>` is present, the entire plan SHALL contain only legacy work-directory state whose ownership is proven to be that active change or its matching date-prefixed archive. Global probes, global design-docs, and any other machine-home entry not provably owned by the named change SHALL be excluded rather than inferred into scope.

#### Scenario: Old workDir reports move to evidence

- **WHEN** migration applies for a change whose machine-home work directory contains `review-report.md` and `ship-log.md`
- **THEN** those files SHALL move to `<changeRoot>/evidence/`
- **AND** the work directory SHALL no longer contain them

#### Scenario: Old workDir handoff moves to the terminal handoff directory

- **WHEN** the work directory contains `handoff/implementer-1.md`
- **THEN** it SHALL move to `<changeRoot>/handoff/implementer-1.md`
- **AND** the work directory's `handoff/` SHALL no longer contain it

#### Scenario: Old workDir run-state moves to ephemera

- **WHEN** the work directory contains `auto-run.json` for an active change
- **THEN** it SHALL move to `<executionRoot>/.rasen/changes/<c>/ephemera/auto-run.json`

#### Scenario: Archived change run-state is actually discarded

- **WHEN** apply encounters run-state for an archived change
- **THEN** it SHALL remove that source file before recording a discarded outcome
- **AND** a removal failure SHALL be reported as failed rather than discarded
- **AND** a successful second run SHALL not rediscover the run-state

#### Scenario: Machine-root probe directories are reclassified one-by-one

- **WHEN** an unscoped migration encounters historical machine-root probe directories
- **THEN** each directory SHALL be classified per the classification order
- **AND** the plan SHALL list each directory's classification and action

#### Scenario: design-docs move to the planning root

- **WHEN** an unscoped migration encounters documents under `machineHome/design-docs/`
- **THEN** they SHALL move to `<planningRoot>/rasen/design-docs/`

#### Scenario: Review material is never a candidate

- **WHEN** migration scans legacy state containing `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `retro.md`
- **THEN** none of those entries SHALL appear as move or discard actions

#### Scenario: Scoped migration excludes unrelated globals

- **WHEN** `rasen work migrate --change foo` plans or applies while machine home also contains global probes, global design-docs, and legacy work for `bar`
- **THEN** only legacy work provably owned by `foo` or a matching archived `foo` directory SHALL appear in the plan
- **AND** the unrelated global and `bar` entries SHALL remain byte-for-byte unchanged

#### Scenario: Windows and POSIX paths route to the same classes

- **WHEN** equivalent legacy trees are migrated on Windows, macOS, and Linux
- **THEN** platform-native absolute paths SHALL route each entry to the same semantic terminal class
- **AND** archive-name matching, containment, and relative-path reporting SHALL not depend on one platform's separator or case behavior

### Requirement: Migration conflicts never overwrite — both copies are kept

A migration SHALL never overwrite a destination file or directory. The plan SHALL state that absence of the destination is an apply precondition, and apply SHALL publish each destination with an exclusive no-clobber operation rather than relying on a prior existence check. If a destination exists during planning or appears at any point before publication, apply SHALL preserve the complete legacy source and existing destination and report a conflict with both paths. This rule applies to evidence, handoff, ephemera, probe directories, and design-docs on Windows, macOS, and Linux.

For a directory move, every destination directory and file created during publication SHALL be exclusive. If a collision or copy failure leaves a partial destination owned by this migration, the source SHALL remain intact and the result SHALL identify the partial destination for recovery; no pre-existing entry may be removed during cleanup.

#### Scenario: Evidence destination already exists

- **WHEN** a report's destination `<changeRoot>/evidence/review-report.md` already exists
- **THEN** the legacy file SHALL be left in place
- **AND** the conflict SHALL be reported with both paths

#### Scenario: File destination appears after planning

- **WHEN** a migration plans a file move and another process creates the destination before publication
- **THEN** exclusive publication SHALL fail as a conflict without changing either file
- **AND** the migration SHALL report both paths

#### Scenario: Directory destination appears after planning

- **WHEN** a migration plans a probe-directory move and another process creates the destination before publication
- **THEN** the migration SHALL not replace, merge into, or delete the concurrent directory
- **AND** the complete source directory SHALL remain available

#### Scenario: Concurrent child entry appears during directory copy

- **WHEN** a migration-owned destination directory is being populated and another process creates a child entry at a planned destination path
- **THEN** the migration SHALL not overwrite that entry
- **AND** the source directory SHALL remain intact while the collision and partial destination are reported

#### Scenario: design-docs destination already exists

- **WHEN** a design doc's destination `<planningRoot>/rasen/design-docs/foo.md` already exists
- **THEN** the legacy copy SHALL be left in place
- **AND** the conflict SHALL be reported with both paths

## ADDED Requirements

### Requirement: Migration filesystem failures are explicit and fail closed

Filesystem absence SHALL be recognized only from `ENOENT`. Planning failures such as `EACCES`, `EPERM`, and `EIO` SHALL be reported with the affected path and SHALL block apply because the plan is incomplete. During apply, those errors SHALL be reported on the affected action and SHALL never be treated as a conflict, absence, successful move, or successful discard.

A file move MAY use a copy-based fallback only for the explicit cross-device condition supported by the implementation. Permission and I/O errors SHALL NOT enter that fallback. Fallback publication SHALL create the destination exclusively, verify the published copy before source removal, and report source-removal failure without claiming the action moved. Cleanup SHALL remove only temporary or partial paths proven to have been created by the current action.

#### Scenario: Scan permission failure blocks apply

- **WHEN** planning a relevant work, probe, or design-doc directory fails with `EACCES`, `EPERM`, or `EIO`
- **THEN** the plan SHALL report the failed path and error
- **AND** apply SHALL perform no migration action from that incomplete plan

#### Scenario: Permission error does not trigger fallback

- **WHEN** destination publication fails with `EPERM`
- **THEN** the action SHALL be reported failed
- **AND** no copy fallback SHALL run
- **AND** the source SHALL remain intact

#### Scenario: Cross-device file move uses exclusive fallback

- **WHEN** a file cannot use its primary no-clobber publication because source and destination are on different devices
- **THEN** fallback SHALL create the destination exclusively and verify its contents
- **AND** a concurrently created destination SHALL remain unchanged and produce a conflict

#### Scenario: Copy succeeds but source removal fails

- **WHEN** fallback publishes and verifies a destination but removal of the source fails
- **THEN** the action SHALL be reported failed or incomplete rather than moved
- **AND** the report SHALL identify both surviving paths for recovery

#### Scenario: Archived-state I/O failure is not a discard

- **WHEN** archived run-state removal fails with `EACCES`, `EPERM`, or `EIO`
- **THEN** the source SHALL remain
- **AND** the outcome SHALL be failed with the original error
- **AND** the discarded counter SHALL not increase
