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

The archive operation SHALL follow a structured process to safely move changes to the archive.

#### Scenario: Performing archive

- **WHEN** archiving a change
- **THEN** execute these steps:
  1. Create archive/ directory if it doesn't exist
  2. Generate target name as `YYYY-MM-DD-[change-name]` using current date
  3. Check if target directory already exists
  4. Update main specs from the change's future state specs (see Spec Update Process below)
  5. Move the entire change directory to the archive location

#### Scenario: Archive already exists

- **WHEN** target archive already exists
- **THEN** fail with error message
- **AND** do not overwrite existing archive

#### Scenario: Successful archive

- **WHEN** move succeeds
- **THEN** display success message with archived name and list of updated specs

### Requirement: Spec Update Process

Before moving the change to archive, the command SHALL apply delta changes to main specs to reflect the deployed reality.

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

`rasen archive <change>` SHALL move the change directory to the planning root's archive directory unconditionally — no configuration is consulted and no destination is resolved (`archive-destination` capability). A project whose config still carries `archive.destination: external` or `prune` SHALL archive in-repo exactly as a project with no such key; the deprecated value produces only a parse-time warning (`config-loading` capability). The command SHALL neither move a change to the machine home nor delete a change directory without an archive copy, and its JSON output SHALL report the archived name and absolute archived path.

#### Scenario: Legacy destination config does not redirect the CLI

- **WHEN** `rasen archive <change> --yes --json` runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** the change SHALL be moved to the planning root's archive directory
- **AND** the JSON result SHALL report the archived name and the absolute archived path
- **AND** nothing SHALL be written under the machine home and no change directory SHALL be deleted

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

## Why These Decisions

**Interactive selection**: Reduces typing and helps users see available changes
**Task checking**: Prevents accidental archiving of incomplete work
**Date prefixing**: Maintains chronological order and prevents naming conflicts
**No overwrite**: Preserves historical archives and prevents data loss
**Spec updates before archiving**: Specs in the main directory represent current reality; when a change is deployed and archived, its future state specs become the new reality and must replace the main specs
**Confirmation for spec updates**: Provides visibility into what will change, prevents accidental overwrites, and ensures users understand the impact before specs are modified
**--yes flag for automation**: Allows CI/CD pipelines to archive without interactive prompts while maintaining safety by default for manual use
