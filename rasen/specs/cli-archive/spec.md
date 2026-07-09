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

### Requirement: Archive command honors the destination axis

`rasen archive <change>` SHALL resolve the archive destination (per the `archive-destination` capability) and route its bookkeeping accordingly: `in-repo` moves to the root's archive directory exactly as before; `external` registers the project's machine home when needed and moves the change there, with the move safe across filesystems; `prune` deletes the change directory after the command's confirmations plus its own dedicated prune-naming confirmation (a separate flag from `--yes`; see "Timing-guard override and prune confirmation are separate consents" below), skipping quality capture visibly. The destructive-destination preconditions (delivery-complete facts, and the change directory being both clean and tracked in git history — per the `archive-destination` capability) SHALL be enforced before any external move or prune delete. JSON output SHALL report the destination and the archived path (or the pruned state).

#### Scenario: External archive via the CLI

- **WHEN** `rasen archive <change> --yes` runs with destination `external`
- **THEN** the change SHALL land under the project's machine-home archive
- **AND** the JSON result SHALL name the destination and the absolute archived path

#### Scenario: Prune via the CLI requires its own dedicated override

- **WHEN** `rasen archive <change> --json` runs with destination `prune` without the dedicated prune override
- **THEN** the command SHALL refuse with a blocked error naming the prune confirmation requirement, regardless of whether `--yes` was passed

#### Scenario: Uncommitted change directory blocks destructive CLI bookkeeping

- **WHEN** `rasen archive <change>` runs with destination `external` or `prune` and the change directory has uncommitted content
- **THEN** the command SHALL refuse and direct committing the change directory first

### Requirement: Archive command respects on-merge timing for PR deliveries

Because the CLI never invokes `gh`, and uses git only for local read-only status checks (never to make a workflow decision like a merge determination), `rasen archive` cannot verify a merge itself; when the resolved archive timing is `on-merge` and the change's recorded ship log shows a `pr`-mode delivery, the command SHALL refuse to archive without an explicit override (`--yes`), directing the user to the archive skill (which performs the merge check) or to confirm the merge themselves. This closes the path by which the CLI could bypass the merge-confirmation gate of the `archive-timing` capability.

#### Scenario: CLI blocks the merge-gate bypass

- **WHEN** `rasen archive <change>` runs for a change whose ship log records a `pr` delivery under `on-merge` timing, without `--yes`
- **THEN** the command SHALL refuse, explain that merge confirmation is required, and point to `/rasen:archive` or an explicit `--yes` after the user confirms the merge

#### Scenario: Explicit override archives anyway

- **WHEN** the same command runs with `--yes`
- **THEN** the archive SHALL proceed, treating the override as the user's merge confirmation

### Requirement: Timing-guard override and prune confirmation are separate consents

The `--yes` override that satisfies the on-merge timing guard (merge confirmation) and the confirmation that authorizes a `prune` deletion SHALL be separate consents that neither substitutes for the other. `rasen archive` SHALL expose a dedicated flag (distinct from `--yes`) for the prune confirmation, so that passing `--yes` alone — even when it successfully satisfies the timing guard — SHALL NEVER also authorize a `prune` destination's deletion. When both gates apply to the same invocation (on-merge timing with a recorded `pr` delivery, destination `prune`), the timing guard's refusal message SHALL make clear that its own override does not also authorize the deletion, so a user acting on that message is not misled into believing one flag covers both.

#### Scenario: --yes alone never authorizes a prune deletion

- **WHEN** `rasen archive <change> --yes` runs with destination `prune` and no dedicated prune confirmation was given
- **THEN** the command SHALL refuse the deletion with a blocked error naming the prune confirmation requirement, exactly as it would without `--yes`

#### Scenario: The timing-guard refusal for a prune destination does not imply --yes alone suffices

- **WHEN** the merge-confirmation timing guard refuses a change whose destination is `prune`
- **THEN** its refusal message SHALL state that the prune deletion requires its own separate confirmation, not `--yes` alone

#### Scenario: Both consents together allow the archive to proceed

- **WHEN** `rasen archive <change>` runs with destination `prune` under on-merge timing for a recorded `pr` delivery, with BOTH `--yes` (merge confirmation) and the dedicated prune confirmation supplied
- **THEN** the archive SHALL proceed

## Why These Decisions

**Interactive selection**: Reduces typing and helps users see available changes
**Task checking**: Prevents accidental archiving of incomplete work
**Date prefixing**: Maintains chronological order and prevents naming conflicts
**No overwrite**: Preserves historical archives and prevents data loss
**Spec updates before archiving**: Specs in the main directory represent current reality; when a change is deployed and archived, its future state specs become the new reality and must replace the main specs
**Confirmation for spec updates**: Provides visibility into what will change, prevents accidental overwrites, and ensures users understand the impact before specs are modified
**--yes flag for automation**: Allows CI/CD pipelines to archive without interactive prompts while maintaining safety by default for manual use