# opsx-auto-command Specification

## Purpose
Defines the `/opsx:auto` autopilot command — a dispatch agent that drives the full OPSX workflow end-to-end based on task complexity classification.

## ADDED Requirements

### Requirement: Auto Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for auto in `src/core/templates/workflows/auto.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getAutoCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxAutoCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

#### Scenario: Dispatch agent logic embedded

- **WHEN** the auto skill template is generated
- **THEN** the skill instructions SHALL include the dispatch agent logic (task analysis, expert selection, pipeline orchestration)
- **AND** this logic SHALL be inlined from `fusion/agents/dispatch.md` content

### Requirement: Task Complexity Classification

The command SHALL classify task complexity as Full Feature, Small Feature, or Bug Fix based on description keywords and scope.

#### Scenario: Full Feature classification

- **WHEN** the task description indicates a new feature, multi-component work, or significant scope
- **THEN** the system SHALL classify it as Full Feature
- **AND** SHALL select the full feature pipeline

#### Scenario: Small Feature classification

- **WHEN** the task description indicates a single-purpose addition, enhancement, or minor feature
- **THEN** the system SHALL classify it as Small Feature
- **AND** SHALL select the small feature pipeline

#### Scenario: Bug Fix classification

- **WHEN** the task description indicates a bug fix, error correction, or regression fix
- **THEN** the system SHALL classify it as Bug Fix
- **AND** SHALL select the bug fix pipeline

#### Scenario: Classification display

- **WHEN** classification is determined
- **THEN** the system SHALL display the classification to the user
- **AND** SHALL allow the user to override the classification before proceeding

### Requirement: Full Feature Pipeline

Full feature pipeline SHALL execute: office-hours, propose, autoplan/expert reviews, apply, verify, ship, archive, retro.

#### Scenario: Full feature pipeline stages

- **WHEN** the full feature pipeline runs
- **THEN** the system SHALL execute stages in order: office-hours → propose → [autoplan/expert reviews] → apply → verify → ship → archive → retro
- **AND** each stage SHALL wait for the previous stage to complete before starting

#### Scenario: Expert selection for full features

- **WHEN** executing the expert review stage of a full feature pipeline
- **THEN** the system SHALL invoke /autoplan for planning and task generation
- **AND** SHALL invoke /cso if the change is security-relevant
- **AND** SHALL invoke /benchmark if the change is performance-sensitive

### Requirement: Small Feature Pipeline

Small feature pipeline SHALL execute: propose, apply, verify, ship, archive.

#### Scenario: Small feature pipeline stages

- **WHEN** the small feature pipeline runs
- **THEN** the system SHALL execute stages in order: propose → apply → verify → ship → archive
- **AND** office-hours and retro stages SHALL be skipped

### Requirement: Bug Fix Pipeline

Bug fix pipeline SHALL execute: propose (simplified), apply, verify, ship, archive.

#### Scenario: Bug fix pipeline stages

- **WHEN** the bug fix pipeline runs
- **THEN** the system SHALL execute stages in order: propose (simplified) → apply → verify → ship → archive
- **AND** the propose stage SHALL use a simplified template focused on bug description and fix approach

### Requirement: Pause Points for User Confirmation

The command SHALL provide 3 pause points for user confirmation during pipeline execution.

#### Scenario: Pause at Planning to Implementation transition

- **WHEN** the pipeline completes the planning phase (propose/office-hours/autoplan)
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

### Requirement: DAG State Resume

The command SHALL read DAG state via `openspec status --json` to resume from the current stage.

#### Scenario: Resume from existing progress

- **WHEN** `/opsx:auto` is invoked for a change that already has artifacts
- **THEN** the system SHALL read `openspec status --json` to determine which stages are complete
- **AND** SHALL resume the pipeline from the next incomplete stage

#### Scenario: Fresh start

- **WHEN** `/opsx:auto` is invoked for a change with no existing artifacts
- **THEN** the system SHALL start the pipeline from the first stage

#### Scenario: Status determination

- **WHEN** reading DAG state
- **THEN** the system SHALL map artifact presence to pipeline stage completion:
  - `office-hours-design.md` exists → office-hours complete
  - `proposal.md` exists → propose complete
  - `tasks.md` exists with all tasks checked → apply complete
  - `review-report.md` exists → verify complete
  - `ship-log.md` exists → ship complete

### Requirement: Expert Selection

Expert selection SHALL be context-aware based on change characteristics.

#### Scenario: Autoplan for full features

- **WHEN** the pipeline is classified as Full Feature
- **THEN** the system SHALL invoke /autoplan for comprehensive planning and task generation

#### Scenario: CSO for security-relevant changes

- **WHEN** the change touches authentication, authorization, input validation, cryptography, or data handling
- **THEN** the system SHALL invoke /cso for security review during the appropriate pipeline stage

#### Scenario: Benchmark for performance-sensitive changes

- **WHEN** the change involves database queries, API endpoints, rendering logic, or computational algorithms
- **THEN** the system SHALL invoke /benchmark for performance analysis during the appropriate pipeline stage
