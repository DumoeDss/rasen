## MODIFIED Requirements

### Requirement: Auto-Scaling Verification Depth

Verification depth SHALL auto-scale based on change scope: Full, Standard, or Light. All QA-bearing depths SHALL use the single `rasen-qa` expert with an explicit mode rather than a separate QA-only identity.

#### Scenario: Full verification for multi-file or UI changes

- **WHEN** the change involves multiple files or UI components
- **THEN** verification depth SHALL be classified as Full
- **AND** the system SHALL run artifact checks, `rasen-review`, conditional `rasen-cso`, `rasen-qa`, and conditional `rasen-design-review`

#### Scenario: Standard verification for small features

- **WHEN** the change is a small, single-purpose feature
- **THEN** verification depth SHALL be classified as Standard
- **AND** the system SHALL run artifact checks, `rasen-review`, conditional `rasen-cso`, and `rasen-qa` in report-only/non-UI mode

#### Scenario: Light verification for bug fixes

- **WHEN** the change is a bug fix with minimal scope
- **THEN** verification depth SHALL be classified as Light
- **AND** the system SHALL run artifact checks and `rasen-review` only

#### Scenario: Scope classification inputs

- **WHEN** determining verification depth
- **THEN** the system SHALL consider the number of files changed, presence of UI components, proposal scope description, and task count

### Requirement: Standard Verification Pipeline

Standard verification SHALL run artifact checks with code review, report-only QA, and conditional security review. Report-only QA SHALL be a mode of `rasen-qa`, preserve browser-based evidence and canonical severity tagging, write `qa-report.md`, and perform no fixes or commits.

#### Scenario: Standard pipeline execution

- **WHEN** standard verification runs
- **THEN** the system SHALL invoke artifact consistency checks
- **AND** SHALL invoke `rasen-review` for code review
- **AND** SHALL invoke `rasen-qa` in report-only/non-UI mode
- **AND** SHALL invoke `rasen-cso` only if the change is security-relevant
- **AND** SHALL NOT require or invoke `rasen-qa-only`
