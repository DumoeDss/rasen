# work-migration Specification (delta)

## ADDED Requirements

### Requirement: A command migrates legacy in-repo ephemera to the machine home

The CLI SHALL provide `rasen work migrate` (a new `work` command group, distinct from the brand-migration `rasen migrate`) that scans the resolved root's active change directories and its `changes/archive/**` directories for legacy process ephemera and moves them into the project's machine-home work directories. The migrate set follows the `change-work-dir` capability's ephemera enumeration: run-state files (`auto-run.json`, `portfolio-run.json`, `goal-run.json`), the `handoff/` directory including relay prompts, `verification-report.md`, `ship-log.md`, and `*-report.md` files. Review material (proposal, design, tasks, delta specs, research), knowledge documents, `retro.md`, and `.openspec.yaml` SHALL never be moved. Report-like files outside the set and the possibility of custom run-artifact names SHALL be reported, not moved. The command SHALL support `--change <name>` scoping and construct all paths with the platform path module. Machine-home identity SHALL be minted (when needed) only at the point an actual move executes — never during a preview — erroring with init guidance when minting cannot succeed on an execute call.

#### Scenario: Untracked run-state noise disappears in one run

- **WHEN** `rasen work migrate` executes in a repo with untracked `auto-run.json`/`portfolio-run.json` files under active and archived change directories
- **THEN** those files SHALL be moved to the corresponding machine-home work directories
- **AND** `git status` SHALL no longer show them

#### Scenario: Review material is never a candidate

- **WHEN** the migration scans a change directory containing `proposal.md`, `design.md`, `tasks.md`, `specs/`, and `retro.md`
- **THEN** none of those SHALL appear in the migration plan

#### Scenario: Scoped migration

- **WHEN** `rasen work migrate --change <name>` runs
- **THEN** only that change's (or that archived directory's) ephemera SHALL be considered

### Requirement: Migration is preview-first and idempotent

The command SHALL present a per-file plan (source, destination, tracked/untracked classification, conflicts, notes) before moving anything. Interactive runs SHALL confirm after the preview; `--dry-run` SHALL always stop at the preview; `--json` runs SHALL be non-interactive and SHALL execute only with an explicit `--yes`, otherwise emitting the plan as JSON without moving files. A re-run after a completed migration SHALL find nothing to move and say so. Per-file move failures SHALL be reported without aborting the remainder of the run.

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

### Requirement: Git-tracked ephemera move only on explicit opt-in, with no git writes

The command SHALL classify candidates as tracked or untracked using a read-only git listing. Untracked files SHALL move by default. Tracked files SHALL be skipped and reported by default; with `--include-tracked` they SHALL be moved, leaving the resulting deletions uncommitted and printing pathspec-scoped commit guidance — the command SHALL NOT invoke any git write operation. In a root CONFIRMED not to be a git work tree, all candidates SHALL be treated as untracked with an explicit note. A root that IS a git work tree but whose tracked-files query fails for any reason (lock contention, corrupt index, transient I/O) SHALL NOT be treated as untracked — the command SHALL fail closed (refuse the run) rather than risk moving tracked content unclassified.

#### Scenario: Tracked files skipped by default

- **WHEN** the migration encounters ephemera committed to git (e.g. upstream-era archived reports)
- **THEN** those files SHALL be skipped and listed as tracked in the report
- **AND** the working tree SHALL be left unchanged for them

#### Scenario: Opt-in moves tracked files and leaves the commit to the user

- **WHEN** `rasen work migrate --include-tracked --yes` executes
- **THEN** tracked ephemera SHALL be moved, git SHALL show the deletions as uncommitted changes
- **AND** the output SHALL include pathspec commit guidance and the command SHALL NOT commit anything

#### Scenario: A git query failure on a confirmed repo fails closed

- **WHEN** the root is confirmed to be a git work tree but the tracked-files query itself fails (e.g. a corrupted index)
- **THEN** the command SHALL refuse the run rather than treat any candidate as untracked
- **AND** no file SHALL move

### Requirement: Destinations are collision-free and survive registry GC

Active changes' ephemera SHALL move to the change's standard work directory; archived changes' ephemera SHALL move to a dedicated archived-work area inside the machine home keyed by the DATE-PREFIXED archived directory name, so a migrated archive can never collide with a live same-name change's work directory. Both destinations SHALL reside inside the registered project home so registry garbage collection never treats them as orphaned. A destination file that already exists SHALL be skipped and reported as a conflict — the migration SHALL never overwrite in either direction.

#### Scenario: Archived change migrates to the date-keyed area

- **WHEN** ephemera under `changes/archive/2026-07-06-foo/` migrate while an active change `foo` also exists
- **THEN** the archived files SHALL land in the home's archived-work area for `2026-07-06-foo`
- **AND** the active change `foo`'s work directory SHALL be unaffected

#### Scenario: Conflict is reported, not resolved silently

- **WHEN** a candidate's destination file already exists in the work directory
- **THEN** the candidate SHALL be skipped and listed as a conflict for the human to resolve

#### Scenario: GC leaves migrated state alone

- **WHEN** `rasen doctor --gc` runs after a migration while the project remains registered
- **THEN** the migrated work directories SHALL NOT be deleted
