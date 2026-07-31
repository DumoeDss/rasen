# work-migration Specification

## Purpose
Define `rasen work migrate`: a preview-first, fail-closed command that moves legacy machine-home work state into its final planning-root or execution-root location for active and archived changes, while preserving review material, applying the exact displayed plan, never overwriting either copy, and never writing to Git on the caller's behalf.
## Requirements
### Requirement: Migration is preview-first and idempotent

The command SHALL create one complete per-file plan containing the frozen planning root, execution root, legacy-home owner, path-identity flavor, source, destination, explicit action (including every destructive delete), file-type classification, conflicts, notes, and every destructive precondition before moving anything. Planning SHALL be pure and independent of execution intent. Interactive runs SHALL display that plan and, after confirmation, apply that exact plan object without rescanning candidates or re-resolving any root, Store membership, current working directory, or machine-home owner. `--dry-run` SHALL always stop after the preview. `--json` runs SHALL be non-interactive and SHALL execute only with an explicit `--yes`; with or without execution, each invocation SHALL plan once. A re-run after a completed migration SHALL find nothing to move and say so. Per-file move failures SHALL be reported without aborting the remainder of the run. The plan SHALL NOT include tracked/untracked classification because the inverted migrator scans legacy machine-home work directories, where Git tracking is irrelevant.

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

#### Scenario: Interactive confirmation applies the displayed plan

- **WHEN** an interactive migration displays a preview and the user confirms it
- **THEN** the command SHALL pass the exact displayed plan to the migration
  apply operation
- **AND** SHALL NOT perform a second planning pass

#### Scenario: Drift after preview fails closed

- **WHEN** a displayed plan's source or destination preconditions change before
  confirmed apply
- **THEN** apply SHALL report the affected action as conflict, incomplete, or
  failed according to the immutable-plan contract
- **AND** SHALL NOT replace that action with a newly discovered action

### Requirement: Destinations are collision-free and survive registry GC

Active changes' migrated state SHALL land inside the change directory (evidence, handoff) or the execution root (ephemera), so it travels with the repository and does not depend on the machine-home registration. Archived changes' migrated reports and handoff SHALL land inside the archived directory. Both the change directory and the archive directory reside inside the planning root, so migrated state survives registry garbage collection by construction — it is in the repo, not in the machine home.

#### Scenario: Archived change migrates to the date-keyed area

- **WHEN** reports under a machine-home work directory for archived change `2026-07-06-foo` migrate while an active change `foo` also exists
- **THEN** the archived reports SHALL land in `changes/archive/2026-07-06-foo/evidence/` in the planning root
- **AND** the active change `foo`'s evidence directory SHALL be unaffected

#### Scenario: Conflict is reported, not resolved silently

- **WHEN** a candidate's destination file already exists in the terminal location (evidence, handoff, ephemera, or design-docs)
- **THEN** the candidate SHALL be left in place and listed as a conflict for the human to resolve
- **AND** the migration SHALL never overwrite in either direction

#### Scenario: GC leaves migrated state alone

- **WHEN** `rasen doctor --gc` runs after a migration while the project remains registered
- **THEN** migrated files inside the change directory or archive directory SHALL NOT be deleted (they are in the repo, not in the machine home)

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

### Requirement: Work migration freezes planning, execution, and legacy-home ownership

`rasen work migrate` SHALL use the shared mutually exclusive `--store <id>` and
`--project <id>` selectors. At command entry it SHALL resolve one immutable
routing context containing the selected planning root and changes directory,
the execution checkout or worktree, the root that owns legacy machine-home
lookup, and an explicit Windows or POSIX path-identity flavor. Every migration
source and destination SHALL derive only from that context. For an in-repo or
project-selected run, the selected project root SHALL own planning, execution,
and legacy-home lookup. For a Store-selected run, the Store SHALL own planning
files and design docs while the current selected member checkout/worktree SHALL
own ephemera, probes, and legacy-home lookup.

#### Scenario: Store planning and member execution stay separated

- **WHEN** `rasen work migrate --store team` runs from a member project
  worktree
- **THEN** reports, handoff, and design docs SHALL route under the Store
  planning root
- **AND** active run-state, probe code, sampling output, and legacy-home lookup
  SHALL route through that member worktree's frozen execution context
- **AND** no migration destination SHALL be placed under another Store member

#### Scenario: Two worktrees with the same change remain isolated

- **WHEN** two worktrees of one Store member contain the same-named change and
  migration is invoked from the second worktree
- **THEN** the Store change remains the planning source of truth
- **AND** terminal run-state and probes SHALL route only to the second
  worktree's execution directories

#### Scenario: Project selection keeps one root

- **WHEN** `rasen work migrate --project member-a` selects an in-repo project
- **THEN** that resolved project root SHALL be frozen as the planning,
  execution, and legacy-home owner root

#### Scenario: Selectors are mutually exclusive

- **WHEN** a user passes both `--store` and `--project`
- **THEN** migration SHALL reject the invocation through the shared
  root-selection diagnostic before planning or moving files

#### Scenario: Windows path identity is explicit

- **WHEN** planning runs with the Windows path-identity flavor and scoped change
  names or roots differ only by case or separator spelling
- **THEN** matching and duplicate protection SHALL follow Windows identity
  rules while destinations are constructed with the platform path module

#### Scenario: POSIX path identity remains case-sensitive

- **WHEN** planning runs with the POSIX path-identity flavor and two change
  names differ only by case
- **THEN** they SHALL remain distinct and only the exactly scoped change SHALL
  be considered

### Requirement: Migration compatibility surfaces remain stable

Root-context threading SHALL preserve the established `rasen work migrate`
human and JSON projections, exit behavior, no-op reporting, `--change`,
`--dry-run`, `--json`, `--yes`, and
`--discard-absorbed-conclusions` semantics. Any surfaced routing data SHALL be
additive. The immutable plan SHALL retain the migration-safety foundation's
scope filtering, action fingerprints, complete-plan blocker, no-clobber moves,
and fail-closed filesystem handling.

#### Scenario: Existing JSON consumer remains compatible

- **WHEN** a consumer reads the JSON fields that existed before root-context
  routing
- **THEN** those fields SHALL retain their names and meanings for preview and
  apply results
- **AND** any root-context fields SHALL be additive

#### Scenario: Scoped Store migration does not widen

- **WHEN** `rasen work migrate --store team --change target` runs
- **THEN** scope filtering SHALL occur before filesystem inspection
- **AND** no same-named or unrelated change outside `target` SHALL be inspected
  or mutated

#### Scenario: Root routing does not weaken no-clobber apply

- **WHEN** a Store or worktree destination appears or changes after planning
- **THEN** apply SHALL preserve both copies and report the conflict or
  incomplete action
- **AND** SHALL NOT overwrite, delete, or reclassify either path
