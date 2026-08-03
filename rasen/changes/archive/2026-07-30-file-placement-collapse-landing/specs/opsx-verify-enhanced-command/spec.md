## MODIFIED Requirements

### Requirement: Report Output

Reports SHALL be saved to the change's evidence directory (`<changeRoot>/evidence/`, the `evidenceDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback: a report that already exists in the legacy machine-home work directory or the change directory is updated in place.

#### Scenario: Report files written after verification

- **WHEN** verification completes
- **THEN** the review report SHALL be saved as `review-report.md` in the resolved evidence directory (or the legacy location per the fallback)
- **AND** the CSO report SHALL be saved as `cso-report.md` there (if /cso was invoked)
- **AND** the QA report SHALL be saved as `qa-report.md` there (if /qa was invoked)

#### Scenario: Consolidated summary

- **WHEN** all verification stages complete
- **THEN** the agent SHALL display a consolidated summary with pass/fail status for each stage
- **AND** SHALL list critical issues requiring resolution before shipping
