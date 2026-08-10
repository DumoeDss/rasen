# CLI Archive Command Specification

## Purpose
The archive command moves completed changes from the active changes directory to the archive folder with date-based naming, following Rasen conventions.

## Command Syntax
```bash
rasen archive [change-name] [--yes|-y]
```

Options:
- `--yes`, `-y`: Skip confirmation prompts (for automation)
## Requirements
### Requirement: Change Selection

The command SHALL support both interactive and direct change selection methods.

#### Scenario: Interactive selection

- **WHEN** no change-name is provided
- **THEN** display interactive list of available changes (excluding archive/)
- **AND** allow user to select one

#### Scenario: Direct selection

- **WHEN** change-name is provided
- **THEN** use that change directly
- **AND** validate it exists

### Requirement: Task Completion Check

The command SHALL verify task completion status before archiving to prevent premature archival.

#### Scenario: Incomplete tasks found

- **WHEN** incomplete tasks are found (marked with `- [ ]`)
- **THEN** display all incomplete tasks to the user
- **AND** prompt for confirmation to continue
- **AND** default to "No" for safety

#### Scenario: All tasks complete

- **WHEN** all tasks are complete OR no tasks.md exists
- **THEN** proceed with archiving without prompting

### Requirement: Archive Process

The archive command SHALL expose one authoritative plan/apply operation used by direct CLI, single archive, bulk archive, and in-ship consumers. Planning SHALL complete validation, spec-update preparation, sidecar/handoff and probe validation, cleaner disposition, quality/evidence discovery, target selection, and blockers without mutation. Apply SHALL consume that exact plan without reclassifying paths or changing planned actions.

In a Store v2 project scope that operation SHALL be the change-finalization plan/apply, which additionally carries the declared outcome, the successor or reason it requires, the landed reachability proof, and the Archive v2 record, and whose published address is the project partition's stable target-line entry rather than a flat date-prefixed name. Standalone projects and legacy flat Stores SHALL keep the existing operation, address, and record unchanged, dispatched from the resolved scope rather than from a path shape.

A successful apply SHALL stage and verify the archive, publish it without clobbering, finalize cleaner outcomes and `archive.json`, and remove the active change last. A failed apply SHALL preserve the active source or leave a transaction journal that reports the recoverable state. Generated consumers SHALL invoke this operation and SHALL NOT move a change directory directly.

#### Scenario: Performing archive

- **WHEN** archiving a change
- **THEN** the command SHALL derive a complete archive plan before mutation
- **AND** SHALL apply the confirmed plan through the authoritative archive engine
- **AND** SHALL publish without overwrite to `YYYY-MM-DD-<change-name>` in the planning root, or, in a Store v2 project scope, to `YYYY-MM-DD-<change-name>--<instance-short>` below that project's stable target-line archive directory

#### Scenario: Archive already exists

- **WHEN** an unrelated target archive already exists
- **THEN** apply SHALL fail with a target-conflict error
- **AND** SHALL preserve the active change, ephemera, and existing target

#### Scenario: Successful archive

- **WHEN** staged payload verification, publication, cleaner disposition, and accounting all complete
- **THEN** the command SHALL display the archived name, updated specs, disposition totals, and recovery status
- **AND** the archived evidence hashes SHALL verify
- **AND** the active change SHALL be removed last

#### Scenario: Every entry point calls the engine

- **WHEN** generated single, bulk, and in-ship archive workflows are inspected
- **THEN** each SHALL invoke the authoritative archive command for bookkeeping
- **AND** none SHALL issue a direct archive `mv`, recursive source removal, or hand-written `archive.json`

#### Scenario: Interrupted apply resumes only its own transaction

- **WHEN** a retry encounters a stage or published archive with an incomplete journal
- **THEN** it SHALL resume only if the transaction id and plan hash match the newly supplied plan
- **AND** otherwise SHALL report both paths for recovery without deleting either copy

### Requirement: Spec Update Process

Before moving the change to archive, the command SHALL apply delta changes to main specs to reflect the deployed reality. In a Store v2 project scope that application SHALL be conditional on the declared outcome: only `landed` SHALL apply deltas, and `superseded`, `cancelled`, and `abandoned` SHALL apply none. Standalone projects and legacy flat Stores SHALL continue to apply deltas unconditionally as they do today.

#### Scenario: Applying delta changes

- **WHEN** archiving a change with delta-based specs
- **THEN** parse and apply delta changes as defined in openspec-conventions
- **AND** validate all operations before applying

#### Scenario: Validating delta changes

- **WHEN** processing delta changes
- **THEN** perform validations as specified in openspec-conventions
- **AND** if validation fails, show specific errors and abort

#### Scenario: Conflict detection

- **WHEN** applying deltas would create duplicate requirement headers
- **THEN** abort with error message showing the conflict
- **AND** suggest manual resolution

#### Scenario: Zero-requirements spec deletion

- **WHEN** applying a change's deltas leaves an existing spec with zero requirements (every requirement REMOVED, none remaining)
- **THEN** the command SHALL delete that spec's directory from the main specs instead of writing an empty spec
- **AND** SHALL log a clear message naming the deleted capability
- **AND** SHALL treat this as a supported outcome, not a validation failure (no abort)
- **AND** `rasen validate --strict` SHALL pass afterward because the spec no longer exists rather than being left empty
- **AND** SHALL NOT delete a spec that still has any surviving requirement, nor a spec that did not already exist before this change

#### Scenario: Stale MODIFIED block dropping current scenarios is rejected

- **WHEN** a MODIFIED requirement block in a change delta omits one or more scenarios that the current main spec still contains for that requirement (scenario drift, e.g. two changes each MODIFY the same requirement and the second was authored before the first archived)
- **THEN** the command SHALL abort the spec rebuild with an error naming the requirement and the missing scenario(s), instructing the author to refresh the change spec before archiving
- **AND** SHALL NOT overwrite the main spec (no scenarios are silently dropped)
- **AND** the change SHALL remain unarchived

#### Scenario: A non-landed Store v2 outcome applies no delta

- **WHEN** a Store v2 project change carrying delta specs is archived with outcome `superseded`, `cancelled`, or `abandoned`
- **THEN** no delta SHALL be parsed for application and no main spec SHALL be created, updated, or deleted
- **AND** every file under that project's canonical specs SHALL remain byte-identical

### Requirement: Confirmation Behavior

The spec update confirmation SHALL provide clear visibility into changes before they are applied.

#### Scenario: Displaying confirmation

- **WHEN** prompting for confirmation
- **THEN** display a clear summary showing:
  - Which specs will be created (new capabilities)
  - Which specs will be updated (existing capabilities)
  - The source path for each spec
- **AND** format the confirmation prompt as:
  ```
  The following specs will be updated:
  
  NEW specs to be created:
    - cli-archive (from changes/add-archive-command/specs/cli-archive/spec.md)
  
  EXISTING specs to be updated:
    - cli-init (from changes/update-init-command/specs/cli-init/spec.md)
  
  Update 2 specs and archive 'add-archive-command'? [y/N]:
  ```
#### Scenario: Handling confirmation response

- **WHEN** waiting for user confirmation
- **THEN** default to "No" for safety (require explicit "y" or "yes")
- **AND** skip confirmation when `--yes` or `-y` flag is provided

#### Scenario: User declines confirmation

- **WHEN** user declines the confirmation
- **THEN** abort the entire archive operation
- **AND** display message: "Archive cancelled. No changes were made."
- **AND** exit with non-zero status code

### Requirement: Error Conditions

The command SHALL handle various error conditions gracefully.

#### Scenario: Handling errors

- **WHEN** errors occur
- **THEN** handle the following conditions:
  - Missing rasen/changes/ directory
  - Change not found
  - Archive target already exists
  - File system permissions issues

### Requirement: Skip Specs Option

The archive command SHALL support a `--skip-specs` flag that skips all spec update operations and proceeds directly to archiving.

#### Scenario: Skipping spec updates with flag

- **WHEN** executing `rasen archive <change> --skip-specs`
- **THEN** skip spec discovery and update confirmation
- **AND** proceed directly to moving the change to archive
- **AND** display a message indicating specs were skipped

### Requirement: Non-blocking confirmation

The archive operation SHALL proceed when the user declines spec updates instead of cancelling the entire operation.

#### Scenario: User declines spec update confirmation

- **WHEN** the user declines spec update confirmation
- **THEN** skip spec updates
- **AND** continue with the archive operation
- **AND** display a success message indicating specs were not updated

### Requirement: Display Output

The command SHALL provide clear feedback about delta operations.

#### Scenario: Showing delta application

- **WHEN** applying delta changes
- **THEN** display for each spec:
  - Number of requirements added
  - Number of requirements modified
  - Number of requirements removed
  - Number of requirements renamed
- **AND** use standard output symbols (+ ~ - →) as defined in openspec-conventions:
  ```
  Applying changes to specs/user-auth/spec.md:
    + 2 added
    ~ 3 modified
    - 1 removed
    → 1 renamed
  ```

### Requirement: Archive Validation

The archive command SHALL validate changes before applying them to ensure data integrity. When validation blocks the archive in human (non-`--json`) mode, the command SHALL set a non-zero process exit code so scripts and CI can distinguish a blocked archive from a successful one, matching the existing `--json`-mode behavior.

#### Scenario: Pre-archive validation

- **WHEN** executing `rasen archive change-name`
- **THEN** validate the change structure first
- **AND** only proceed if validation passes
- **AND** show validation errors if it fails

#### Scenario: Force archive without validation

- **WHEN** executing `rasen archive change-name --no-validate`
- **THEN** skip validation (unsafe mode)
- **AND** show warning about skipping validation

#### Scenario: Blocked archive sets a non-zero exit code in human mode

- **WHEN** a non-`--json` archive is blocked at any human-mode abort point — delta-spec validation failure, spec-rebuild failure, or rebuilt-spec validation failure — and nothing is archived
- **THEN** the command sets `process.exitCode = 1` before returning
- **AND** the failure is still printed to the console
- **AND** a legitimate user cancellation (declining a confirmation prompt, selecting no change) leaves the exit code at 0

### Requirement: Quality Artifact Scanning
The archive command SHALL scan the change directory for quality artifact files before archiving.

#### Scenario: Quality artifacts found
- **WHEN** change directory contains files matching `*-review.md`, `*-report.md`, or `*-audit.md`
- **THEN** archive extracts quality metrics from these files

#### Scenario: No quality artifacts
- **WHEN** change directory contains no quality artifact files
- **THEN** archive proceeds normally without quality capture

### Requirement: Quality Summary in Archive Metadata
The archive command SHALL write a quality summary to the archived change's `.openspec.yaml` file.

#### Scenario: Writing quality summary
- **WHEN** quality artifacts are found and metrics extracted
- **THEN** `.openspec.yaml` in the archived directory includes a `quality` key with extracted metrics

#### Scenario: Display quality summary
- **WHEN** archive completes with quality data captured
- **THEN** archive summary output includes the number of findings and test results

### Requirement: Quality Rules Auto-Generation
The archive command SHALL extract reusable rules from quality artifacts and append them to project config.

#### Scenario: Rules extracted from review
- **WHEN** quality artifact contains lines prefixed with `[RULE]`
- **THEN** the text after `[RULE]` is appended to `config.yaml`'s `quality-rules` array

#### Scenario: Duplicate rule prevention
- **WHEN** an extracted rule already exists in `quality-rules`
- **THEN** the duplicate is not added

#### Scenario: Display extracted rules count
- **WHEN** archive completes with rules extracted
- **THEN** archive summary output shows "Extracted N quality rules"

### Requirement: Archive command respects on-merge timing for PR deliveries

Because the CLI never invokes `gh`, and uses git only for local read-only status checks (never to make a workflow decision like a merge determination), `rasen archive` cannot verify a merge itself; when the resolved archive timing is `on-merge` and the change's recorded ship log shows a `pr`-mode delivery, the command SHALL refuse to archive without an explicit override (`--yes`), directing the user to the archive skill (which performs the merge check) or to confirm the merge themselves. This closes the path by which the CLI could bypass the merge-confirmation gate of the `archive-timing` capability.

#### Scenario: CLI blocks the merge-gate bypass

- **WHEN** `rasen archive <change>` runs for a change whose ship log records a `pr` delivery under `on-merge` timing, without `--yes`
- **THEN** the command SHALL refuse, explain that merge confirmation is required, and point to `/rasen-archive-change` or an explicit `--yes` after the user confirms the merge

#### Scenario: Explicit override archives anyway

- **WHEN** the same command runs with `--yes`
- **THEN** the archive SHALL proceed, treating the override as the user's merge confirmation

### Requirement: Archive incomplete-task gate SHALL use the tracked-tasks artifact glob

`rasen archive`'s incomplete-task gate — the check that prevents archiving a change whose tasks are not all complete — SHALL read task progress through the change's tracked-tasks artifact glob, the same file-resolution `rasen status` and `rasen view` use, rather than a fixed `changes/<name>/tasks.md` path. The tracked-tasks artifact SHALL be identified as the artifact whose `generates` equals the schema's `apply.tracks` value, falling back to the artifact with id `tasks` when no `apply` block is present; checkbox counts SHALL be aggregated across every file matched by that artifact's `generates` glob, scoped to the change directory. When the schema cannot be resolved or no tracked-tasks artifact is found, the gate SHALL fall back to a single top-level `tasks.md` exactly as today and SHALL NOT crash. This closes the data-safety gap where a change whose tasks live in nested/glob `tasks.md` files is read as having zero tasks, no incomplete work, and is allowed to archive while unfinished.

#### Scenario: Glob-tasks change with unfinished work cannot archive

- **GIVEN** a schema whose tasks artifact `generates` is `**/tasks.md`
- **AND** a change with `backend/tasks.md` containing unchecked tasks and no top-level `tasks.md`
- **WHEN** running `rasen archive` on that change
- **THEN** the incomplete-task gate SHALL detect the unfinished tasks and block (or require explicit override of) the archive
- **AND** SHALL NOT treat the change as having zero tasks

#### Scenario: Archive gate resolves the same tracked files as view

- **GIVEN** any change with a tracked-tasks glob
- **WHEN** the `archive` incomplete-task gate and `rasen view` each compute task progress for that change
- **THEN** they SHALL resolve the same set of `tasks.md` files and count the same checkboxes

#### Scenario: Unresolvable schema falls back without error

- **GIVEN** a change whose configured schema cannot be resolved
- **WHEN** running `rasen archive` on that change
- **THEN** the incomplete-task gate SHALL fall back to a single top-level `tasks.md`
- **AND** SHALL NOT crash

#### Scenario: Single top-level tasks file archiving is unchanged

- **GIVEN** a change with a single top-level `changes/<name>/tasks.md`, or a project with no resolvable schema
- **WHEN** running `rasen archive`
- **THEN** the incomplete-task gate SHALL behave exactly as today

### Requirement: Archive command always lands in the planning root

`rasen archive <change>` SHALL plan, stage, verify, and publish the change to the planning root's archive directory unconditionally — no configuration is consulted and no destination is resolved (`archive-destination` capability). In a Store v2 project scope the entry's address within that planning root SHALL be computed from the change's frozen stable target line and verified change instance through the layout contract; that is an address derivation from frozen scope facts, not a configurable destination, and no configuration participates in it. A project whose config still carries `archive.destination: external` or `prune` SHALL archive in-repo exactly as a project with no such key; the deprecated value produces only a parse-time warning (`config-loading` capability). The engine SHALL neither publish to the machine home nor remove the active source before the archive and recovery/accounting state are durable, and its JSON output SHALL report the archived name and absolute archived path.

#### Scenario: Legacy destination config does not redirect the CLI

- **WHEN** `rasen archive <change> --yes --json` runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** the engine SHALL publish the verified archive to the planning root's archive directory
- **AND** the JSON result SHALL report the archived name and the absolute archived path
- **AND** nothing SHALL be written under the machine home and no change directory SHALL be deleted

### Requirement: Ephemera cleaning at archive time

Archive planning SHALL consume the `file-placement` cleaner's complete immutable classification, including candidate fingerprints, effective preserved paths, `sourceSignals`, typed `blockers`, and `complete`. Apply SHALL never invoke cleaner deletion for an aborted or incomplete classification.

When the classification is complete and applicable, the engine SHALL dispose only the planned candidates, journal actual per-candidate progress, and record only actual outcomes in `archive.json`. A complete plan aborted by source signals SHALL preserve and report every effective path while the fully accounted archive may proceed. An incomplete classification or non-absence inspection blocker SHALL block all archive apply.

#### Scenario: Complete cleaner plan is applied and accounted

- **WHEN** `rasen archive <change>` consumes a complete, non-aborted cleaner plan containing schema-valid `auto-run.json`
- **THEN** apply SHALL use that exact candidate and fingerprint without reclassification
- **AND** a successful deletion SHALL appear in `archive.json`'s `ephemeraDiscarded`

#### Scenario: No ephemera directory is a no-op

- **WHEN** cleaner discovery confirms the execution-root ephemera directory is absent with `ENOENT`
- **THEN** the plan SHALL be complete with empty delete and preserve dispositions
- **AND** archive may proceed with an empty `ephemeraDiscarded`

#### Scenario: Source signal preserves the effective tree

- **WHEN** a complete cleaner plan reports a source manifest or source-tree signal
- **THEN** archive apply SHALL NOT call cleaner deletion
- **AND** every candidate and preserved path SHALL appear in the effective preserve disposition
- **AND** the archive result SHALL report all source signals

#### Scenario: Incomplete cleaner plan blocks archive

- **WHEN** cleaner classification reports `complete: false` or an `EACCES`, `EPERM`, or `EIO` blocker
- **THEN** the archive plan SHALL report the blocker with operation and path
- **AND** apply SHALL perform no spec write, handoff action, ephemera deletion, stage publication, or active-source removal

### Requirement: The --keep-ephemera flag preserves all ephemera

`rasen archive` SHALL accept `--keep-ephemera` and represent it in the archive plan. Planning SHALL still inspect and classify the ephemera tree so the preview can report every path and detect incomplete inspection. The effective delete disposition SHALL be empty and every cleaner candidate plus every already-preserved entry SHALL appear in the effective preserve disposition.

#### Scenario: --keep-ephemera projects complete preservation

- **WHEN** `rasen archive <change> --keep-ephemera` plans or applies
- **THEN** the plan SHALL show an empty delete list and the complete effective preserved-path list
- **AND** no ephemera file SHALL be deleted
- **AND** `archive.json` SHALL record no `ephemeraDiscarded` entries

#### Scenario: --keep-ephemera does not hide inspection failure

- **WHEN** ephemera inspection under `--keep-ephemera` fails with a non-`ENOENT` error
- **THEN** the plan SHALL report the blocker
- **AND** archive apply SHALL remain blocked

### Requirement: The --dry-run flag previews all planned actions without executing

`rasen archive --dry-run` SHALL emit the same immutable archive plan that apply consumes. Human and JSON output SHALL include the final target; spec-sync actions; archive-level blocking conditions; sidecar presence/schema status; handoff and probe decisions; cleaner completeness, source signals, and blockers; `keepEphemera`; exact effective delete and preserve lists; quality/evidence inputs; staging/publication intent; and recovery identity. Dry-run SHALL create, move, delete, or write nothing.

#### Scenario: Dry-run reports complete disposition

- **WHEN** dry-run sees deletable, unknown, malformed, nested, or source-signal ephemera
- **THEN** output SHALL list every effective delete or preserve path with its reason
- **AND** SHALL include cleaner completeness, source signals, and typed blockers
- **AND** no ephemera byte SHALL change

#### Scenario: Dry-run reports sidecar and handoff decisions

- **WHEN** a valid archive-input sidecar is present
- **THEN** dry-run SHALL show its schema/change binding, every handoff outcome, every validated probe path/commit, and any blocker
- **AND** SHALL NOT delete or move handoff files or remove the sidecar

#### Scenario: Dry-run reports the spec sync plan

- **WHEN** a change has delta specs
- **THEN** dry-run SHALL list each prepared create, update, or delete action
- **AND** no main spec file SHALL be written

#### Scenario: Dry-run reports target blockers in JSON and human modes

- **WHEN** the final target is occupied or another archive precondition is unsatisfied
- **THEN** both output modes SHALL report the same blocker codes, paths, and messages
- **AND** JSON SHALL NOT omit blockers shown in human output

#### Scenario: Dry-run moves nothing

- **WHEN** dry-run completes
- **THEN** the active change and all execution-root state SHALL remain byte-identical
- **AND** no stage, journal, archive target, spec write, quality metadata, or `archive.json` SHALL be created

#### Scenario: Apply consumes the displayed plan

- **WHEN** a displayed dry-run plan is subsequently confirmed for apply
- **THEN** apply SHALL consume byte-equivalent planned actions
- **AND** source drift or a newly appearing target SHALL change only runtime outcomes, never introduce undisclosed actions

### Requirement: archive.json is written to the archived directory

The archive engine SHALL finalize `archive.json` from confirmed Git facts, the finalized recursive evidence inventory, validated sidecar intent, and actual cleaner outcomes. It SHALL write and verify the file atomically before removing the active change. A confirmed non-Git root may use its defined null/clean representation; Git ambiguity, sidecar failure, evidence read/hash failure, or accounting write failure SHALL block completion and remain recoverable through the transaction journal.

#### Scenario: archive.json is finalized before active-source removal

- **WHEN** archive completes successfully
- **THEN** the published directory SHALL contain a parsed and verified `archive.json`
- **AND** its evidence digests SHALL match the final evidence tree
- **AND** only then may the active change be removed

#### Scenario: Store-selected run records the code project's commit

- **WHEN** a store-selected change is archived with a confirmed Git execution project
- **THEN** `codeCommit` SHALL be that code project's HEAD SHA, not the store's HEAD SHA

#### Scenario: Confirmed non-git planning root records null branch

- **WHEN** Git confirms the planning root is not a work tree
- **THEN** `planningBranch` SHALL be `null` and `planningTreeState` SHALL be `clean`

#### Scenario: Ambiguous Git state blocks accounting

- **WHEN** Git is unavailable, metadata is corrupt, or a branch/status/HEAD query fails unexpectedly
- **THEN** the engine SHALL report a Git blocker
- **AND** SHALL NOT guess `null`, `clean`, or a commit value

#### Scenario: Accounting write failure keeps recovery evidence

- **WHEN** atomic `archive.json` write or verification fails after publication
- **THEN** the active change SHALL remain
- **AND** the archive-local journal SHALL identify the failed phase and planned accounting
- **AND** completion SHALL NOT be reported

### Requirement: Store v2 archiving declares its outcome on the command line

`rasen archive` SHALL accept `--outcome <landed|superseded|cancelled|abandoned>`, `--reason <text>`, `--by <changeInstanceId>`, `--by-target-line <id>`, and `--commit <oid>`. In a Store v2 project scope `--outcome` SHALL be required; its absence SHALL fail with `finalization_outcome_required` before any mutation, naming all four outcomes and their reason and successor requirements. `--reason` SHALL be required by every non-landed outcome and refused for `landed`; `--by` SHALL be required by `superseded` and refused otherwise; `--by-target-line` SHALL only narrow the successor search and SHALL never substitute for successor verification; `--commit` SHALL only supply the candidate commit for a landed proof and SHALL never bypass it. There SHALL be no flag that declares a change planning-only at archive time. Outside a Store v2 project scope these options SHALL be rejected as inapplicable rather than silently ignored.

#### Scenario: Missing outcome refuses before mutation

- **WHEN** `rasen archive <change> --yes --json` runs in a Store v2 project scope with no `--outcome`
- **THEN** the command SHALL exit non-zero with `finalization_outcome_required` and name the four outcomes
- **AND** no spec, change directory, or archive entry SHALL be written

#### Scenario: Outcome options outside Store v2 are rejected, not ignored

- **WHEN** `--outcome` is supplied in a standalone project or a legacy flat Store
- **THEN** the command SHALL reject the option explaining where it applies
- **AND** it SHALL NOT archive while discarding the option

#### Scenario: A supplied commit still has to prove reachability

- **WHEN** `--outcome landed --commit <oid>` names a commit that is not an ancestor of the target line's code ref
- **THEN** the command SHALL refuse naming the commit and the ref
- **AND** the change SHALL remain active

### Requirement: Store v2 archive output reports the finalization record

In a Store v2 project scope, `rasen archive --json` SHALL report the declared outcome, the change instance, the workspace pair, the stable target line, the absolute published entry path, whether spec synchronization was applied and how many actions it carried, and, for a code-backed landed archive, the proven commit and the target code ref with its commit identifier at proof time. `--dry-run` SHALL emit the same immutable finalization plan that apply consumes, including the record draft and every blocker, and SHALL write nothing. The human output SHALL state the same facts.

#### Scenario: A landed JSON result is auditable

- **WHEN** a Store v2 change is archived with `--outcome landed --json`
- **THEN** the payload SHALL name the outcome, the change instance, the workspace pair, the target line, the published entry path, the applied spec-sync action count, the proven commit, and the target code ref
- **AND** the human form SHALL state the same facts

#### Scenario: Dry-run previews the finalization plan and writes nothing

- **WHEN** `rasen archive <change> --outcome abandoned --reason <text> --dry-run --json` runs in a Store v2 project scope
- **THEN** the output SHALL contain the immutable finalization plan including the record draft and every blocker
- **AND** no archive entry, spec write, journal, or record file SHALL be created

### Requirement: Canonical publication makes a stored archive transaction non-abortable
The archive command SHALL refuse stored-plan abort after any canonical spec target has been published, including when a crash occurs before the action progress or aggregate transaction phase records that publication. It SHALL preserve the transaction evidence and offer exact-token replay whenever replay can still advance safely.

#### Scenario: Publication-to-progress crash refuses abort
- **WHEN** apply publishes a canonical spec target and crashes before recording the corresponding progress or phase advancement
- **THEN** stored abort fails with `archive_abort_phase_unsafe`
- **AND** the canonical target, active source, stage, journal, and stored plan token remain byte-for-byte unchanged by the abort attempt

#### Scenario: Exact-token replay completes after refused abort
- **WHEN** a stored abort was refused in the publication-to-progress crash window and the owned recovery carriers remain intact
- **THEN** applying the exact stored token resumes the same transaction and completes it

### Requirement: Stored archive abort uses platform-correct path ownership
The archive command SHALL evaluate every destructive abort binding with one platform path-identity policy. Equivalent owned path spellings SHALL authorize cleanup only of paths derived from the stored plan, while a path that resolves outside the owned target SHALL refuse abort without modifying that outside path.

#### Scenario: Equivalent Windows spellings authorize only owned cleanup
- **WHEN** an early stored transaction on Windows records an owned binding using different drive-letter case, mixed separators, or equivalent dot segments
- **THEN** abort recognizes the binding as the same owned target
- **AND** cleanup removes only the canonical transaction targets derived from the stored plan

#### Scenario: Windows sibling or traversal spelling is refused
- **WHEN** an abort carrier on Windows spells a sibling target or resolves through traversal to a path outside the plan-owned target
- **THEN** abort reports an ownership or plan-mismatch blocker
- **AND** the outside target and its sentinel content remain unchanged

