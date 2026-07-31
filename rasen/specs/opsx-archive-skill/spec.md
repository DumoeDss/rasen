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

When delta specs exist, the skill SHALL ask whether the archive engine should apply their prepared main-spec actions. The choice SHALL be encoded in the immutable saved plan (`--skip-specs` when declined). The skill SHALL NOT invoke an external spec-sync workflow or mutate main specs before engine apply.

#### Scenario: Delta specs exist

- **WHEN** agent checks for delta specs
- **AND** `specs/` directory exists in the change with spec files
- **THEN** prompt whether the archive engine should include prepared spec actions
- **AND** encode the answer in the saved plan before preview and confirmation
- **AND** perform no spec mutation outside the engine transaction

#### Scenario: No delta specs

- **WHEN** agent checks for delta specs
- **AND** no `specs/` directory or no spec files exist
- **THEN** proceed without sync prompt

### Requirement: Archive Process

The single archive skill and bulk archive skill SHALL use `rasen archive` as the only bookkeeping engine. They may perform their semantic gates, spec-conflict assessment, and handoff/probe judgment, but they SHALL pass that intent to the engine and SHALL NOT create the archive directory, move the change, delete active handoff or ephemera, capture quality independently, or hand-write accounting.

#### Scenario: Successful archive

- **WHEN** a single archive skill archives a change
- **THEN** it SHALL inspect the engine's complete plan, invoke engine apply, and report the returned archive path and disposition
- **AND** `.openspec.yaml`, finalized evidence, and `archive.json` SHALL come from the same engine transaction

#### Scenario: Archive already exists

- **WHEN** the engine plan reports an unrelated target at the final archive path
- **THEN** the skill SHALL surface that blocker
- **AND** SHALL NOT rename, merge, overwrite, or delete either directory

#### Scenario: Bulk archive uses one engine per selected change

- **WHEN** bulk archive processes multiple confirmed changes
- **THEN** it SHALL invoke the same archive engine separately for each change in resolved spec-conflict order
- **AND** SHALL derive success, failure, and recovery status from each engine result
- **AND** one change's failure SHALL NOT cause a direct-move fallback for that or another change

### Requirement: Skill Output

The skill SHALL provide clear feedback about the archive operation.

#### Scenario: Archive complete with sync

- **WHEN** archive completes after the engine applies prepared spec actions
- **THEN** display summary:
  - Specs updated (from the engine result)
  - Change archived to location
  - Schema that was used

#### Scenario: Archive complete without sync

- **WHEN** archive completes with spec actions disabled in the saved plan
- **THEN** display summary:
  - Note that spec actions were skipped (if applicable)
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

The archive skill SHALL resolve the archive timing from status JSON (`archive.timing`) and delivery facts from the ship log before running its gates. A ship log recording an in-ship archive SHALL make the invocation an idempotent no-op reporting the already-archived location. An on-merge change with a `pr`-mode delivery SHALL pass the merge-confirmation gate (including no-gh/offline degradation) before any archive plan is saved or applied. An on-merge change with `push`/`local` delivery or no ship log SHALL proceed to the same authoritative engine flow. Timing changes when the engine may run, not who owns spec mutation or archive publication.

#### Scenario: Merge gate runs before engine planning and apply

- **WHEN** the generated archive skill is inspected
- **THEN** timing resolution and merge confirmation SHALL appear before saved-plan creation and apply
- **AND** an unmerged PR SHALL stop the skill before any spec mutation, staging, or publication

#### Scenario: In-ship change reports already archived

- **WHEN** archive is invoked for a change whose ship log records an in-ship archive
- **THEN** the skill SHALL report the archived location and stop cleanly without gates, planning, or apply

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

Before invoking archive apply, the archive skill SHALL ensure the ship-side evidence facts are final. The archive engine SHALL add the archive section inside the staged ship log before evidence hashing, copying any ship commit from the log's recorded facts and recording timestamp, outcome/path, and transaction identity. The skill SHALL leave the ship-side section untouched and SHALL perform no ship-log append after accounting.

Post-bookkeeping commit guidance SHALL include the recorded ship short SHA when present and omit it when absent. Git history and that commit message provide the stable archive-side link; the skill SHALL NOT append the containing archive commit SHA into already-hashed evidence. Bulk archive SHALL apply the same finalization and commit-message form per change.

#### Scenario: Chain record is finalized before hashing

- **WHEN** the generated single archive skill is inspected
- **THEN** engine invocation SHALL replace direct bookkeeping and post-bookkeeping ship-log append
- **AND** completion SHALL be reported only after the engine verifies the finalized ship-log hash

#### Scenario: Bulk archive finalizes each change independently

- **WHEN** the generated bulk archive skill archives multiple changes
- **THEN** each engine transaction SHALL finalize and hash that change's own ship log
- **AND** each post-bookkeeping commit-message form SHALL use that change's recorded ship commit

#### Scenario: No later append invalidates accounting

- **WHEN** archive apply returns success
- **THEN** the skill SHALL NOT append an archive commit or any other content to evidence
- **AND** every `archive.json` evidence digest SHALL remain valid at summary time

### Requirement: Bookkeeping step always publishes in the planning root

The archive skill's bookkeeping step SHALL invoke the authoritative engine with the status payload's planning-root archive directory. The engine SHALL stage, verify, and publish the archive there with date-prefix and collision rules, regardless of a legacy `archive.destination` value. The skill SHALL not use `legacyArchiveDir` as a target and SHALL not issue a direct move.

#### Scenario: Bookkeeping ignores legacy destination config

- **WHEN** the generated archive skill runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** it SHALL pass the planning-root archive target to the engine
- **AND** the engine SHALL publish an archive copy before source removal
- **AND** nothing SHALL be written to the machine-home archive

#### Scenario: Generated templates contain no direct archive move

- **WHEN** single and bulk generated templates are inspected
- **THEN** no step SHALL instruct `mkdir` plus `mv` or recursive source removal for archive bookkeeping
- **AND** the only mutation entry SHALL be the authoritative archive command

### Requirement: The archive skill performs handoff absorption before bookkeeping

Before engine invocation, the archive skill SHALL read each handoff document and judge whether its dead-ends and eliminated hypotheses are absorbed by `design.md` or evidence. It SHALL encode a complete, versioned, change-bound decision sidecar using only `absorbed` or `preserved`, defaulting uncertain cases to `preserved`. The skill SHALL NOT apply those decisions to active files; the engine validates and applies them in the stage.

#### Scenario: Absorbed handoff is expressed as intent

- **WHEN** a handoff document's knowledge is already covered by design or evidence
- **THEN** the skill SHALL record an `absorbed` decision for its contained relative path
- **AND** SHALL leave the active document unchanged until engine success

#### Scenario: Unabsorbed handoff is expressed as preservation intent

- **WHEN** a handoff document contains unabsorbed knowledge
- **THEN** the skill SHALL record a `preserved` decision for placement under staged `evidence/handoff/`
- **AND** SHALL leave the active document unchanged until engine success

#### Scenario: Empty handoff inventory is explicit

- **WHEN** the handoff directory is absent or empty and the skill supplies a judgment
- **THEN** the sidecar SHALL record a complete empty handoff decision set
- **AND** the engine SHALL distinguish it from no sidecar/no judgment

#### Scenario: Sidecar validation failure stops before mutation

- **WHEN** the engine rejects the sidecar schema, change binding, outcome, path containment, inventory completeness, or probe commit
- **THEN** the skill SHALL report the blocker and remediation
- **AND** SHALL NOT perform a direct handoff or archive fallback

### Requirement: The archive skill reports the ephemera cleaner outcome

The archive skill SHALL report the engine plan/result's cleaner completeness, effective `keepEphemera` semantics, source signals, typed blockers, exact deleted paths, and exact preserved paths. The skill SHALL NOT execute deletion and SHALL NOT describe an aborted or incomplete cleaner plan as an empty ephemera directory.

#### Scenario: Cleaner outcome appears in the summary

- **WHEN** archive completes after an applicable cleaner plan
- **THEN** the summary SHALL report exact deleted and preserved counts and paths
- **AND** SHALL report any source signal that caused complete preservation

#### Scenario: Incomplete cleaner plan is reported as blocked

- **WHEN** cleaner inspection is incomplete
- **THEN** the skill SHALL report the blocker operation, path, and code
- **AND** SHALL NOT claim archive completion

### Requirement: The archive skill ensures archive.json is written

The archive skill SHALL require the authoritative engine's success result to confirm that `archive.json` was atomically written and verified against the finalized evidence tree. The skill SHALL not hand-write or repair accounting and SHALL report a journaled incomplete transaction as recoverable, not successful.

#### Scenario: archive.json is mentioned in the completion summary

- **WHEN** the engine reports successful archive completion
- **THEN** the summary SHALL report `codeCommit`, `planningBranch`, disposition totals, and evidence verification
- **AND** SHALL confirm that no later evidence mutation occurred

#### Scenario: Journaled failure is not summarized as success

- **WHEN** the engine reports a staged or published incomplete transaction
- **THEN** the summary SHALL identify the active/archive paths, transaction id, and retry guidance
- **AND** SHALL NOT say that `archive.json` or archive completion succeeded

### Requirement: The archive skill probes are recorded as 静置

The archive skill SHALL record probe intent only as execution-root-relative paths and full code commit ids. The archive engine SHALL validate lexical and resolved containment, directory identity, commit syntax, and commit existence in the execution repository before recording probes in `archive.json`. Neither skill nor engine SHALL move, copy, or delete probes.

#### Scenario: Valid probes are recorded, not moved

- **WHEN** a probe path is contained by the execution root and its commit resolves in that repository
- **THEN** the engine SHALL record the path and commit in `archive.json`
- **AND** the probe directory SHALL remain byte-for-byte in place

#### Scenario: Escaping path or invalid commit blocks archive

- **WHEN** a probe path is absolute, escapes through `..` or symlink resolution, or its commit is malformed or absent
- **THEN** the engine SHALL report a sidecar blocker
- **AND** SHALL NOT publish the archive or mutate the probe
