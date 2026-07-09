## ADDED Requirements

### Requirement: Verification Verdict Gate

Before archiving, the skill SHALL read `verification-report.md` from the change directory (resolved from status JSON) when it exists and honor its `VERIFY VERDICT:` line. A `BLOCKED` verdict SHALL be a hard gate: the skill SHALL refuse to archive by default and proceed only on an explicit, blocker-naming user override; in a non-interactive or dispatched context it SHALL refuse outright. This gate consumes the verdict defined by the `verify-ship-evidence` capability and introduces no new verdict vocabulary. The "don't block archive on warnings" guidance is scoped to soft warnings (incomplete non-task artifacts, unsynced delta specs, missing ship log, deferred delivery) and does NOT cover this hard gate or the incomplete-task hard gate.

#### Scenario: BLOCKED verdict refuses archive

- **WHEN** `verification-report.md` exists and its `VERIFY VERDICT:` line reads `BLOCKED`
- **THEN** the skill SHALL refuse to archive by default
- **AND** SHALL require an explicit override that names the blocking condition before proceeding
- **AND** SHALL refuse outright when running non-interactively

#### Scenario: CLEAN verdict does not gate

- **WHEN** `verification-report.md` exists and its `VERIFY VERDICT:` line reads `CLEAN`
- **THEN** the skill SHALL proceed without a verification-related gate

#### Scenario: No verification report

- **WHEN** no `verification-report.md` exists
- **THEN** the skill SHALL NOT hard-gate on verification absence
- **AND** MAY proceed, since verification absence is not itself a blocking condition

### Requirement: Delivery Precondition Check

Before archiving, the skill SHALL check for delivery evidence via `ship-log.md` in the change directory (resolved from status JSON) and surface a soft warning when delivery has not completed, with an explicit escape for changes that legitimately do not ship.

#### Scenario: No ship log

- **WHEN** no `ship-log.md` exists in the change directory
- **THEN** the skill SHALL warn "This change has no ship log — archive without delivering?" and prompt for confirmation
- **AND** SHALL offer an explicit escape for changes that legitimately do not ship (for example, spec-only changes)
- **AND** SHALL proceed if the user confirms

#### Scenario: Ship log marks portfolio-deferred delivery

- **WHEN** `ship-log.md` exists and its status indicates delivery was deferred to the portfolio/parent level
- **THEN** the skill SHALL note that parent-level portfolio delivery is still pending and that archiving the child now may lose track of it
- **AND** SHALL prompt for confirmation before proceeding

#### Scenario: Ship log shows completed delivery

- **WHEN** `ship-log.md` exists and indicates delivery completed (PR created or branch pushed)
- **THEN** the skill SHALL proceed without a delivery-related warning

## MODIFIED Requirements

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
