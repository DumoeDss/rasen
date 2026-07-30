# Rasen Archive Skill Spec

## Purpose

Define the expected behavior for the `/rasen-archive-change` skill, including readiness checks, spec sync prompting, archive execution, and user-facing output.
## Requirements
### Requirement: Rasen Archive Skill

The system SHALL provide an `/rasen-archive-change` skill that archives completed changes in the experimental workflow.

#### Scenario: Archive a change with all artifacts complete

- **WHEN** agent executes `/rasen-archive-change` with a change name
- **AND** all artifacts in the schema are complete
- **AND** all tasks are complete
- **THEN** the agent moves the change to `rasen/changes/archive/YYYY-MM-DD-<name>/`
- **AND** displays success message with archived location

#### Scenario: Change selection prompt

- **WHEN** agent executes `/rasen-archive-change` without specifying a change
- **THEN** the agent prompts user to select from available changes
- **AND** shows only active changes (excludes archive/)

### Requirement: Artifact Completion Check

The skill SHALL check artifact completion status using the artifact graph before archiving.

#### Scenario: Incomplete artifacts warning

- **WHEN** agent checks artifact status
- **AND** one or more artifacts have status other than `done`
- **THEN** display warning listing incomplete artifacts
- **AND** prompt user for confirmation to continue
- **AND** proceed if user confirms

#### Scenario: All artifacts complete

- **WHEN** agent checks artifact status
- **AND** all artifacts have status `done`
- **THEN** proceed without warning

### Requirement: Task Completion Check

The skill SHALL check task completion status from tasks.md before archiving. Incomplete tasks SHALL be a hard gate aligned with verify's "must fix before archive" verdict: the skill SHALL refuse to archive by default when incomplete tasks exist and proceed only on an explicit override that names the incomplete-task condition; in a non-interactive or dispatched context it SHALL refuse outright.

#### Scenario: Incomplete tasks found

- **WHEN** agent reads tasks.md
- **AND** incomplete tasks are found (marked with `- [ ]`)
- **THEN** display the count of incomplete tasks and refuse to archive by default
- **AND** proceed only on an explicit override that names the incomplete-task condition
- **AND** refuse outright when running non-interactively

#### Scenario: All tasks complete

- **WHEN** agent reads tasks.md
- **AND** all tasks are complete (marked with `- [x]`)
- **THEN** proceed without task-related warning

#### Scenario: No tasks file

- **WHEN** tasks.md does not exist
- **THEN** proceed without task-related warning

### Requirement: Verification Verdict Gate

Before archiving, the skill SHALL read `verification-report.md` from the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by status JSON per the `file-placement` capability), falling back to the legacy machine-home work directory and then the change directory (both resolved from status JSON), when it exists and honor its `VERIFY VERDICT:` line. A `BLOCKED` verdict SHALL be a hard gate: the skill SHALL refuse to archive by default and proceed only on an explicit, blocker-naming user override; in a non-interactive or dispatched context it SHALL refuse outright. This gate consumes the verdict defined by the `verify-ship-evidence` capability and introduces no new verdict vocabulary. The "don't block archive on warnings" guidance is scoped to soft warnings (incomplete non-task artifacts, unsynced delta specs, missing ship log, deferred delivery) and does NOT cover this hard gate or the incomplete-task hard gate.

#### Scenario: BLOCKED verdict refuses archive

- **WHEN** `verification-report.md` exists in the resolved location and its `VERIFY VERDICT:` line reads `BLOCKED`
- **THEN** the skill SHALL refuse to archive by default
- **AND** SHALL require an explicit override that names the blocking condition before proceeding
- **AND** SHALL refuse outright when running non-interactively

#### Scenario: CLEAN verdict does not gate

- **WHEN** `verification-report.md` exists in the resolved location and its `VERIFY VERDICT:` line reads `CLEAN`
- **THEN** the skill SHALL proceed without a verification-related gate

#### Scenario: No verification report

- **WHEN** no `verification-report.md` exists in the evidence directory, the legacy work directory, or the change directory
- **THEN** the skill SHALL NOT hard-gate on verification absence
- **AND** MAY proceed, since verification absence is not itself a blocking condition

### Requirement: Delivery Precondition Check

Before archiving, the skill SHALL check for delivery evidence via `ship-log.md` in the change's evidence directory (`<changeRoot>/evidence/`, per the `file-placement` capability), falling back to the legacy machine-home work directory and then the change directory (resolved from status JSON), and surface a soft warning when delivery has not completed, with an explicit escape for changes that legitimately do not ship.

#### Scenario: No ship log

- **WHEN** no `ship-log.md` exists in the evidence directory, the legacy work directory, or the change directory
- **THEN** the skill SHALL warn "This change has no ship log — archive without delivering?" and prompt for confirmation
- **AND** SHALL offer an explicit escape for changes that legitimately do not ship (for example, spec-only changes)
- **AND** SHALL proceed if the user confirms

#### Scenario: Ship log marks portfolio-deferred delivery

- **WHEN** `ship-log.md` exists in the resolved location and its status indicates delivery was deferred to the portfolio/parent level
- **THEN** the skill SHALL note that parent-level portfolio delivery is still pending and that archiving the child now may lose track of it
- **AND** SHALL prompt for confirmation before proceeding

#### Scenario: Ship log shows completed delivery

- **WHEN** `ship-log.md` exists in the resolved location and indicates delivery completed (PR created or branch pushed)
- **THEN** the skill SHALL proceed without a delivery-related warning

### Requirement: Spec Sync Prompt

The skill SHALL prompt to sync delta specs before archiving if specs exist.

#### Scenario: Delta specs exist

- **WHEN** agent checks for delta specs
- **AND** `specs/` directory exists in the change with spec files
- **THEN** prompt user: "This change has delta specs. Would you like to sync them to main specs before archiving?"
- **AND** if user confirms, execute `/rasen-sync-specs` logic
- **AND** proceed with archive regardless of sync choice

#### Scenario: No delta specs

- **WHEN** agent checks for delta specs
- **AND** no `specs/` directory or no spec files exist
- **THEN** proceed without sync prompt

### Requirement: Archive Process

The skill SHALL move the change to the archive folder with date prefix.

#### Scenario: Successful archive

- **WHEN** archiving a change
- **THEN** create `archive/` directory if it doesn't exist
- **AND** generate target name as `YYYY-MM-DD-<change-name>` using current date
- **AND** move entire change directory to archive location
- **AND** preserve `.openspec.yaml` file in archived change

#### Scenario: Archive already exists

- **WHEN** target archive directory already exists
- **THEN** fail with error message
- **AND** suggest renaming existing archive or using different date

### Requirement: Skill Output

The skill SHALL provide clear feedback about the archive operation.

#### Scenario: Archive complete with sync

- **WHEN** archive completes after syncing specs
- **THEN** display summary:
  - Specs synced (from `/rasen-sync-specs` output)
  - Change archived to location
  - Schema that was used

#### Scenario: Archive complete without sync

- **WHEN** archive completes without syncing specs
- **THEN** display summary:
  - Note that specs were not synced (if applicable)
  - Change archived to location
  - Schema that was used

#### Scenario: Archive complete with warnings

- **WHEN** archive completes with incomplete artifacts or tasks
- **THEN** include note about what was incomplete
- **AND** suggest reviewing if archive was intentional

### Requirement: Archive Resolves Artifact Paths From Status JSON

The archive skill SHALL resolve artifact paths from `rasen status --change <name> --json` rather than assuming repo-local literals, matching the resolution `bulk-archive-change` already uses, so archive operates correctly when specs/changes live in a registered store instead of under the cwd. Specifically, the task-completion check SHALL read the tasks file from `artifactPaths.tasks.existingOutputPaths`, and the delta-vs-main spec comparison SHALL locate main specs in the `specs/` directory resolved from the planning home (the sibling of `planningHome.changesDir`), not the literal `rasen/specs/<capability>/spec.md`.

#### Scenario: Task check uses resolved artifact path

- **WHEN** the archive skill checks task completion
- **THEN** it SHALL read the tasks file from `artifactPaths.tasks.existingOutputPaths` in the status JSON
- **AND** SHALL NOT assume the tasks artifact is literally `tasks.md`

#### Scenario: Main-spec comparison resolves from the planning home

- **WHEN** the archive skill compares a delta spec against its main spec
- **THEN** it SHALL locate the main spec under the `specs/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT read a literal repo-relative `rasen/specs/<capability>/spec.md`
- **AND** in a registered store the main spec SHALL resolve to the store's specs

#### Scenario: Single archive matches bulk archive resolution

- **WHEN** the same change is archived via single `/rasen-archive-change` versus `/rasen-bulk-archive-change`
- **THEN** both SHALL resolve the tasks and specs paths the same way (from status JSON), so neither reports a spurious "no tasks" for a non-`tasks.md` schema

### Requirement: Archive resolves the timing axis before its gates

The archive skill SHALL resolve the archive timing from the status JSON (`archive.timing`) and the delivery facts from the ship log before running its existing gates, and branch accordingly: a ship log recording an in-ship archive SHALL make the invocation an idempotent no-op reporting the already-archived location; an on-merge change with a `pr`-mode delivery SHALL pass the merge-confirmation gate (defined by the `archive-timing` capability, including its no-gh/offline degradation) before any sync or bookkeeping; an on-merge change with `push`/`local` delivery or no ship log SHALL proceed exactly as before this axis existed. Spec sync and directory bookkeeping SHALL remain the same two separable steps in the same order for every timing — the axis only decides when the skill may reach them.

#### Scenario: Merge gate runs before sync and move

- **WHEN** the generated archive skill is inspected
- **THEN** the timing resolution and merge-confirmation gate SHALL appear before the spec-sync prompt and the directory move
- **AND** an unmerged PR SHALL stop the skill before any sync or bookkeeping happens

#### Scenario: In-ship change reports already archived

- **WHEN** archive is invoked for a change whose ship log records an in-ship archive
- **THEN** the skill SHALL report the archived location and stop cleanly without gates, sync, or move

#### Scenario: Undelivered or push-delivered change behaves as today

- **WHEN** archive is invoked for an on-merge change with no ship log or with a `push`/`local` delivery
- **THEN** the skill SHALL run its existing gates and steps unchanged, with no merge-confirmation step

### Requirement: Already-archived detection covers every destination

The skill's pre-status already-archived detection SHALL extend beyond the in-repo scan: after the status payload is available, a change absent from the active directory SHALL also be looked for in the external archive location (payload `archiveDir` or the home archive) and, failing directory presence, in its recorded ship-log outcome (archived path or pruned state) — reporting the existing outcome and stopping cleanly rather than hard-failing. The pre-status in-repo scan remains first (it needs no CLI call and catches the common case).

#### Scenario: Externally archived change is recognized

- **WHEN** archive is invoked for a change already moved to the external archive
- **THEN** the skill SHALL report it archived at the external location and stop without re-gating or re-moving

#### Scenario: Pruned change is recognized by its record

- **WHEN** archive is invoked for a change whose ship-log records a prune
- **THEN** the skill SHALL report the pruned state and stop cleanly

### Requirement: Archive closes the delivery chain

After its bookkeeping step succeeds (any destination), the archive skill SHALL append the `sha-cross-stamping` chain record to the change's ship log — outcome, timestamp, ship commit SHA from the log's recorded facts, and the archive commit SHA (journaled immediately after the commit when the commit follows the append) — and SHALL include the ship short SHA in its post-bookkeeping commit-message guidance, omitting it when no ship commit is recorded. Bulk archive SHALL apply the same append and commit-message form per change. These additions SHALL key on recorded ship-log facts, never re-resolved config, and SHALL leave the ship-side log section untouched.

#### Scenario: Append happens after bookkeeping, before completion is reported

- **WHEN** the generated archive skill is inspected
- **THEN** the chain-record append SHALL follow the bookkeeping step and precede the completion summary
- **AND** the commit guidance SHALL carry the ship short SHA for shipped changes

#### Scenario: Bulk archive stamps each change

- **WHEN** the generated bulk-archive skill archives multiple changes
- **THEN** each change SHALL receive its own ship-log append and its own ship-referencing commit-message form

### Requirement: Bookkeeping step always moves in-repo

The archive skill's bookkeeping step SHALL move the change directory to the planning root's archive directory (the status payload's `archive.archiveDir`) unconditionally — no destination branching. The payload's `legacyArchiveDir` (when present) serves only already-archived detection and legacy discovery, never as a bookkeeping target.

#### Scenario: Bookkeeping ignores legacy destination config

- **WHEN** the generated archive skill runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** its bookkeeping SHALL move the change directory to the in-repo archive with the same date-prefix and collision rules as always
- **AND** SHALL neither move anything to the machine home nor delete the change directory without an archive copy

### Requirement: The archive skill performs handoff absorption before bookkeeping

Before the bookkeeping step moves the change directory to the archive, the archive skill SHALL guide the agent through the handoff absorption judgment (defined by the `file-placement` capability): for each file under `<changeRoot>/handoff/`, the agent SHALL determine whether its dead-ends and eliminated hypotheses are already absorbed by `design.md` or the change's evidence. Absorbed handoff documents SHALL be deleted; unabsorbed documents SHALL be moved to `<changeRoot>/evidence/handoff/`. The default SHALL be preservation when the agent cannot confidently determine absorption. The judgment results SHALL be recorded for inclusion in `archive.json`'s `handoffAbsorbed` array.

#### Scenario: Absorbed handoff documents are deleted

- **WHEN** the archive skill processes a handoff document whose dead-ends are already covered by `design.md`
- **THEN** the skill SHALL direct the agent to delete the document
- **AND** the deletion SHALL be recorded for `handoffAbsorbed`

#### Scenario: Unabsorbed handoff documents move to evidence

- **WHEN** the archive skill processes a handoff document whose content is not absorbed by `design.md` or evidence
- **THEN** the skill SHALL direct the agent to move it to `<changeRoot>/evidence/handoff/`
- **AND** the move SHALL be recorded for `handoffAbsorbed` with a `preserved` outcome

#### Scenario: Empty or absent handoff directory skips the judgment

- **WHEN** the change has no `handoff/` directory or the directory is empty
- **THEN** the absorption step SHALL be a no-op
- **AND** `handoffAbsorbed` SHALL be empty

### Requirement: The archive skill reports the ephemera cleaner outcome

The archive skill's bookkeeping step SHALL note that the CLI's ephemera cleaner (when not suppressed by `--keep-ephemera`) runs before the directory move, and SHALL include the cleaner's outcome in the archive summary: the count of files deleted, the count of files preserved-and-reported, and any source-manifest discovery that blocked cleaning for a change. The skill itself SHALL NOT execute file deletion — the cleaner is deterministic CLI logic.

#### Scenario: Cleaner outcome appears in the summary

- **WHEN** the archive skill completes after the CLI cleaner has run
- **THEN** the summary SHALL report how many ephemera files were deleted and how many were preserved
- **AND** SHALL report any source-manifest discovery

### Requirement: The archive skill ensures archive.json is written

After the bookkeeping step's directory move, the archive skill SHALL ensure `archive.json` is written to the archived directory by the CLI, carrying the fields defined by the `file-placement` capability. The skill SHALL NOT hand-write `archive.json` — the CLI writes it. The skill SHALL include `archive.json`'s key fields (codeCommit, planningBranch, probes, handoffAbsorbed, ephemeraDiscarded) in the completion summary.

#### Scenario: archive.json is mentioned in the completion summary

- **WHEN** the archive skill reports completion
- **THEN** the summary SHALL note that `archive.json` was written
- **AND** SHALL report the `codeCommit` and `planningBranch` values

### Requirement: The archive skill probes are recorded as 静置

The archive skill SHALL record probe directories left in the execution root (静置 disposition) for inclusion in `archive.json`'s `probes` array, with their execution-root-relative paths and the code commit they were tested against. The skill SHALL NOT move, copy, or delete probe directories.

#### Scenario: Probes are recorded, not moved

- **WHEN** the archived change has probe code at an execution-root path
- **THEN** the skill SHALL ensure the path and code commit appear in `archive.json`'s `probes` array
- **AND** SHALL NOT move or delete the probe directory

