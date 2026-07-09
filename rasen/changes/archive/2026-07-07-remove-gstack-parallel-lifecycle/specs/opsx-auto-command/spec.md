## MODIFIED Requirements

### Requirement: Full Feature Pipeline

Full feature pipeline SHALL execute: office-hours, propose, parallel expert reviews, apply, verify, ship, archive, retro. Planning and task generation are produced by the propose stage; review depth comes from the pipeline registry's expert-review stages and the review-loop, not from a standalone planning skill.

#### Scenario: Full feature pipeline stages

- **WHEN** the full feature pipeline runs
- **THEN** the system SHALL execute stages in order: office-hours → propose → [parallel expert reviews + review-loop] → apply → verify → ship → archive → retro
- **AND** each stage SHALL wait for the previous stage to complete before starting

#### Scenario: Expert selection for full features

- **WHEN** executing the expert review stage of a full feature pipeline
- **THEN** the system SHALL run the pipeline registry's expert-review stages against the propose output (the `review` expert, plus `cso`/`benchmark`/`qa`/`design-review` as the change warrants), iterating through the review-loop
- **AND** SHALL invoke /cso if the change is security-relevant
- **AND** SHALL invoke /benchmark if the change is performance-sensitive

### Requirement: Pause Points for User Confirmation

The command SHALL provide 3 pause points for user confirmation during pipeline execution.

#### Scenario: Pause at Planning to Implementation transition

- **WHEN** the pipeline completes the planning phase (office-hours/propose)
- **AND** is about to begin implementation (apply)
- **THEN** the system SHALL pause and display a summary of the plan
- **AND** SHALL prompt the user to confirm before proceeding to implementation

#### Scenario: Pause at Implementation to Verification transition

- **WHEN** the pipeline completes implementation (apply)
- **AND** is about to begin verification (verify)
- **THEN** the system SHALL pause and display what was implemented
- **AND** SHALL prompt the user to confirm before proceeding to verification

#### Scenario: Pause at Verification to Release transition

- **WHEN** the pipeline completes verification (verify)
- **AND** is about to begin release (ship)
- **THEN** the system SHALL pause and display the verification results
- **AND** SHALL prompt the user to confirm before proceeding to release
- **AND** if verification found critical issues, SHALL recommend resolving them first

#### Scenario: User declines at pause point

- **WHEN** the user declines to proceed at any pause point
- **THEN** the system SHALL stop the pipeline at that stage
- **AND** SHALL save current progress so the pipeline can be resumed later

### Requirement: Expert Selection

Expert selection SHALL be context-aware based on change characteristics.

#### Scenario: Planning for full features

- **WHEN** the pipeline is classified as Full Feature
- **THEN** the system SHALL produce comprehensive planning and task generation through the propose stage and the pipeline registry's expert-review stages
- **AND** SHALL NOT invoke a standalone /autoplan skill

#### Scenario: CSO for security-relevant changes

- **WHEN** the change touches authentication, authorization, input validation, cryptography, or data handling
- **THEN** the system SHALL invoke /cso for security review during the appropriate pipeline stage

#### Scenario: Benchmark for performance-sensitive changes

- **WHEN** the change involves database queries, API endpoints, rendering logic, or computational algorithms
- **THEN** the system SHALL invoke /benchmark for performance analysis during the appropriate pipeline stage
