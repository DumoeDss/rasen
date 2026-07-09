# opsx-verify-enhanced-command Specification (delta)

## MODIFIED Requirements

### Requirement: Report Output

Reports SHALL be saved to the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback).

#### Scenario: Report files written after verification

- **WHEN** verification completes
- **THEN** the review report SHALL be saved as `review-report.md` in the resolved work directory (or the legacy location per the fallback)
- **AND** the CSO report SHALL be saved as `cso-report.md` there (if /cso was invoked)
- **AND** the QA report SHALL be saved as `qa-report.md` there (if /qa was invoked)

#### Scenario: Consolidated summary

- **WHEN** all verification stages complete
- **THEN** the agent SHALL display a consolidated summary with pass/fail status for each stage
- **AND** SHALL list critical issues requiring resolution before shipping
