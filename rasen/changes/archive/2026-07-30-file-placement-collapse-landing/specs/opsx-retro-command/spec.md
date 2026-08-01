## MODIFIED Requirements

### Requirement: Change-Scoped Artifact Reading

Change-scoped retro SHALL read all available change artifacts: review material (proposal, design, tasks, delta specs) from the change directory, reports and ship-log from the change's evidence directory (`<changeRoot>/evidence/`, per the `file-placement` capability), run-state from the execution root's ephemera directory — each with the sticky-legacy fallbacks (the legacy machine-home work directory, then the change directory) for artifacts that live there (legacy changes).

#### Scenario: Full artifact set available

- **WHEN** running a change-scoped retro
- **AND** the change directory contains proposal.md, design.md, and tasks.md, and the resolved evidence location contains review-report.md, qa-report.md, and ship-log.md
- **THEN** the retro SHALL read and analyze all of these artifacts
- **AND** SHALL correlate planning artifacts (proposal, design) with outcome artifacts (review, qa, ship-log)

#### Scenario: Partial artifact set

- **WHEN** running a change-scoped retro
- **AND** some artifacts are missing from the evidence directory, the legacy work directory, and the change directory alike
- **THEN** the retro SHALL analyze whatever artifacts are available
- **AND** SHALL note which artifacts were missing and what analysis was skipped

#### Scenario: Legacy change reads its change-dir ephemera

- **WHEN** running a change-scoped retro on a change whose reports predate the evidence directory
- **THEN** the retro SHALL find and analyze those reports in the legacy work directory or the change directory via the fallbacks

#### Scenario: Specs directory reading

- **WHEN** running a change-scoped retro
- **AND** `specs/` directory exists in the change
- **THEN** the retro SHALL read delta specs to understand what was specified vs what was delivered
