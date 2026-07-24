## ADDED Requirements

### Requirement: Retention Mode Dispatch

The full-feature pipeline's retain stage SHALL invoke `rasen-retain` after ship and before archive. On the first entry to the stage, the retain router SHALL read the active profile's `retention` value, record the selected mode in run-state, and execute exactly one of `off`, `report`, or `codify`. `off` SHALL complete as a successful no-op, `report` SHALL run retrospective reporting, and `codify` SHALL run change-scoped learned-skill codification. Archive SHALL NOT begin until the selected retention operation has completed successfully.

#### Scenario: Retention is off

- **WHEN** the full-feature pipeline reaches retain with active profile retention `off`
- **THEN** retain SHALL record a successful no-op in run-state
- **AND** SHALL invoke neither retrospective reporting nor learned-skill codification
- **AND** archive SHALL become eligible to run

#### Scenario: Retention reports

- **WHEN** the full-feature pipeline reaches retain with active profile retention `report`
- **THEN** retain SHALL run the retrospective report branch for the current change
- **AND** SHALL NOT run learned-skill codification
- **AND** archive SHALL become eligible only after reporting succeeds

#### Scenario: Retention codifies

- **WHEN** the full-feature pipeline reaches retain with active profile retention `codify`
- **THEN** retain SHALL run learned-skill codification scoped to the current change
- **AND** SHALL NOT run retrospective reporting
- **AND** archive SHALL become eligible only after codification succeeds

#### Scenario: Interrupted codification is rerun idempotently

- **WHEN** run-state records `codify` as the selected retention mode but does not record a completed retain stage
- **AND** the full-feature pipeline is resumed
- **THEN** retain SHALL resume or rerun codification for the same change identity
- **AND** reconciliation against the existing managed result SHALL prevent duplicate learned skills or duplicate provenance for the same accepted lesson
- **AND** run-state SHALL contain one authoritative completion result for the retain stage

#### Scenario: Legacy retro run-state maps to retain

- **WHEN** an in-flight full-feature run was recorded against the legacy post-archive `retro` stage
- **THEN** an incomplete legacy retro SHALL map to retain in forced report mode
- **AND** a completed legacy retro SHALL remain completed rather than running retain again
- **AND** the migration SHALL preserve the run's authoritative completion history

## MODIFIED Requirements

### Requirement: Full Feature Pipeline

Full feature pipeline SHALL execute: office-hours, propose, parallel expert reviews, apply, verify, ship, retain, archive. Planning and task generation are produced by the propose stage; review depth comes from the pipeline registry's expert-review stages and the review-loop, not from a standalone planning skill. Retention replaces the former post-archive retro tail and SHALL complete before archive preserves the change.

#### Scenario: Full feature pipeline stages

- **WHEN** the full feature pipeline runs
- **THEN** the system SHALL execute stages in order: office-hours → propose → [parallel expert reviews + review-loop] → apply → verify → ship → retain → archive
- **AND** each stage SHALL wait for the previous stage to complete before starting
- **AND** no standalone retro stage SHALL run after archive

#### Scenario: Expert selection for full features

- **WHEN** executing the expert review stage of a full feature pipeline
- **THEN** the system SHALL run the pipeline registry's expert-review stages against the propose output (the `review` expert, plus `cso`/`benchmark`/`qa`/`design-review` as the change warrants), iterating through the review-loop
- **AND** SHALL invoke /cso if the change is security-relevant
- **AND** SHALL invoke /benchmark if the change is performance-sensitive

### Requirement: DAG State Resume

On invocation, auto SHALL determine where to resume from the change's artifacts and the LEAD run-state, via the registry's resume surface. Run-state SHALL be authoritative for whether retain has started or completed and, once retention dispatch has selected a mode, for which retention branch resumes; a later profile change SHALL NOT silently replace the recorded branch within the same pipeline run.

#### Scenario: Resume from run-state

- **WHEN** `/rasen-auto` is invoked for an existing change
- **THEN** auto SHALL determine the next incomplete stage (e.g. via `rasen pipeline resume <change> --json`) using artifact presence plus the run-state record
- **AND** SHALL resume from that stage rather than restarting

#### Scenario: Resume retains the recorded mode

- **WHEN** a run has recorded retain mode `report` or `codify`
- **AND** the active profile's retention value changes before the run resumes
- **THEN** auto SHALL resume the branch recorded in run-state
- **AND** SHALL NOT dispatch the newly configured branch for that existing run

#### Scenario: Completed retain is not repeated

- **WHEN** run-state records the retain stage as successfully completed
- **AND** `/rasen-auto` resumes the change
- **THEN** auto SHALL continue with archive or the next incomplete stage
- **AND** SHALL NOT rerun the completed retention operation
