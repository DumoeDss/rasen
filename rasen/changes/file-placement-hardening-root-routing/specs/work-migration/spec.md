## MODIFIED Requirements

### Requirement: Migration is preview-first and idempotent

The command SHALL create one complete per-file plan containing the frozen
planning root, execution root, legacy-home owner, path-identity flavor, source,
destination, file-type classification, conflicts, notes, and every destructive
precondition before moving anything. Interactive runs SHALL display that plan
and, after confirmation, apply that exact plan without rescanning candidates or
re-resolving any root or machine-home owner. `--dry-run` SHALL always stop after
the preview. `--json` runs SHALL be non-interactive and SHALL execute only with
an explicit `--yes`; with or without execution, each invocation SHALL plan
once. A re-run after a completed migration SHALL find nothing to move and say
so. Per-file move failures SHALL be reported without aborting the remainder of
the run. The plan SHALL NOT include tracked/untracked classification because
the inverted migrator scans legacy machine-home work directories, where Git
tracking is irrelevant.

#### Scenario: Dry run moves nothing

- **WHEN** `rasen work migrate --dry-run` executes
- **THEN** the full per-file plan SHALL be printed and no file SHALL move

#### Scenario: JSON without --yes is a preview

- **WHEN** `rasen work migrate --json` executes without `--yes`
- **THEN** the JSON plan SHALL be emitted and no file SHALL move

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

#### Scenario: Second run is a no-op

- **WHEN** the command runs again after a successful migration
- **THEN** it SHALL report nothing to migrate and exit successfully

#### Scenario: A preview never mints machine identity

- **WHEN** `rasen work migrate` previews (`--dry-run`, `--json` without
  `--yes`, or the interactive preview shown before confirmation) for a
  legacy-home owner with no registered machine identity
- **THEN** `rasen/config.yaml` and the machine-wide project registry SHALL
  remain byte-for-byte unchanged
- **AND** the command SHALL report machine-home-dependent destinations as
  pending rather than fabricate a path or replan after confirmation

## ADDED Requirements

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
