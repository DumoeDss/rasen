## MODIFIED Requirements

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback: a ship log that already exists in the legacy machine-home work directory or the change directory is updated in place. Ship's pre-flight evidence reads (verification reports, expert reports, cycle reports) SHALL look in the evidence directory first, then the legacy work directory, then the change directory.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `ship-log.md` to the evidence directory (or the legacy location per the fallback)
- **AND** the log SHALL include: the delivery mode, branch name, commit, the content tree fingerprint (`git rev-parse HEAD^{tree}`) of that commit, timestamp, the required verification scope and rationale, exact checks and result (or skip with evidence source and matched tree), the PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes
- **THEN** the system SHALL update `ship-log.md` in the same resolved location with deployment status and production verification results

#### Scenario: Evidence read from the work directory

- **WHEN** ship's pre-flight checks look for verification or test-skip evidence
- **THEN** they SHALL check the evidence directory first, then the legacy work directory, then the change directory for the evidence report files

## REMOVED Requirements

### Requirement: In-ship bookkeeping honors the destination axis

**Reason**: The destination axis is retired (`archive-destination` capability). In-ship bookkeeping always moves the change to the in-repo archive; the `external` and `prune` in-ship branches no longer exist.

**Migration**: A config still carrying `archive.destination` triggers the deprecation warning at parse time and does not affect in-ship bookkeeping; legacy outcomes recorded in ship logs remain readable.
