## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Bookkeeping step always moves in-repo

The archive skill's bookkeeping step SHALL move the change directory to the planning root's archive directory (the status payload's `archive.archiveDir`) unconditionally — no destination branching. The payload's `legacyArchiveDir` (when present) serves only already-archived detection and legacy discovery, never as a bookkeeping target.

#### Scenario: Bookkeeping ignores legacy destination config

- **WHEN** the generated archive skill runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** its bookkeeping SHALL move the change directory to the in-repo archive with the same date-prefix and collision rules as always
- **AND** SHALL neither move anything to the machine home nor delete the change directory without an archive copy

## REMOVED Requirements

### Requirement: Bookkeeping step is destination-aware

**Reason**: The destination axis is retired (`archive-destination` capability); bookkeeping always moves in-repo per the added requirement above.

**Migration**: Legacy external archives remain recognized by already-archived detection; child B migrates them into the planning root.

### Requirement: Skill enforces the destructive-destination preconditions

**Reason**: The destructive destinations (`external`, `prune`) are removed; archive bookkeeping never deletes or externalizes the repository's copy, so the preconditions have nothing left to guard.

**Migration**: None — the guarded operations no longer exist. Legacy `Pruned:` tombstones remain readable for already-archived detection.
