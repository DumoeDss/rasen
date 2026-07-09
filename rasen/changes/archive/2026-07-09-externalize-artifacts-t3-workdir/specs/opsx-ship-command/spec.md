# opsx-ship-command Specification (delta)

## MODIFIED Requirements

### Requirement: Ship Log

`ship-log.md` SHALL be written to the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback) with shipping details, aware of the delivery mode. Ship's pre-flight evidence reads (verification reports, expert reports, cycle reports) SHALL look in the same resolved location, falling back to the change directory.

#### Scenario: Ship log written after delivery in any mode

- **WHEN** the ship phase completes delivery (PR created, branch pushed, or local commit recorded)
- **THEN** the system SHALL write `ship-log.md` to the work directory (or the legacy location per the fallback)
- **AND** the log SHALL include: the delivery mode, branch name, commit, the content tree fingerprint (`git rev-parse HEAD^{tree}`) of that commit, timestamp, the test decision (ran green, or skipped with the evidence source and the matched tree fingerprint), the PR URL in `pr` mode, and the deferral note in `local` mode

#### Scenario: Ship log updated after deployment

- **WHEN** the optional land-and-deploy phase completes
- **THEN** the system SHALL update `ship-log.md` in the same resolved location with deployment status and production verification results

#### Scenario: Evidence read from the work directory

- **WHEN** ship's pre-flight checks look for verification or test-skip evidence
- **THEN** they SHALL check the work directory first and the change directory as fallback for the evidence report files
