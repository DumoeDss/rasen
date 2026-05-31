# opsx-auto-command Specification

## Purpose
Upgrades `/opsx:auto` from a single-context linear recipe into a LEAD that selects a pipeline from `opsx-pipeline-registry` and executes it via the `opsx-orchestration` playbook with role-isolated subagents — adding an optional propose direction-review gate and an adaptive Bug-Fix verify policy.

## MODIFIED Requirements

### Requirement: Task Complexity Classification

The auto command SHALL classify the task and select a pipeline from the pipeline registry rather than from a hard-coded set of prose pipelines. The classification result SHALL be overridable by the user before execution.

#### Scenario: Classification selects a registry pipeline

- **WHEN** the user invokes `/opsx:auto` with a task description
- **THEN** auto SHALL classify the task (e.g. via `openspec pipeline classify "<task>" --json`) to a pipeline name resolved from the registry (`full-feature`, `small-feature`, `bug-fix`, or any user/project-defined pipeline)
- **AND** SHALL display the classification and allow the user to override it before proceeding

#### Scenario: New task types need no auto changes

- **WHEN** a new pipeline definition is added to the registry
- **THEN** auto SHALL be able to classify to and execute it without any change to the auto template or other source

### Requirement: DAG State Resume

On invocation, auto SHALL determine where to resume from the change's artifacts and the LEAD run-state, via the registry's resume surface.

#### Scenario: Resume from run-state

- **WHEN** `/opsx:auto` is invoked for an existing change
- **THEN** auto SHALL determine the next incomplete stage (e.g. via `openspec pipeline resume <change> --json`) using artifact presence plus the run-state record
- **AND** SHALL resume from that stage rather than restarting

### Requirement: Bug Fix Pipeline

The Bug-Fix pipeline SHALL use an adaptive verify policy: a green unit-test gate suffices for simple fixes, while complex fixes additionally engage a dedicated test/verification worker.

#### Scenario: Simple fix passes on the unit-test gate

- **WHEN** a bug fix is simple (e.g. single file, non-core path, sufficient tests) and the unit-test gate is green
- **THEN** verify SHALL pass without entering the review loop
- **AND** the simple/complex determination SHALL be recorded in run-state

#### Scenario: Complex fix gets deeper verification

- **WHEN** a bug fix is complex (e.g. multiple files, core paths, insufficient coverage)
- **THEN** the LEAD SHALL spawn a dedicated test/verification worker and enter the review-cycle loop

## ADDED Requirements

### Requirement: Orchestrated Execution via the Pipeline Playbook

Auto SHALL execute the selected pipeline by interpreting its DAG through the `opsx-orchestration` playbook, dispatching each stage to a role-isolated worker, rather than performing the stages itself in a single context.

#### Scenario: Stages dispatched to workers

- **WHEN** auto executes a selected pipeline
- **THEN** the LEAD SHALL dispatch each stage (including `office-hours`, `propose`, and `apply`) to a worker of the stage's role, honoring gates, loops, parallel groups, and conditions per `opsx-orchestration`
- **AND** the LEAD SHALL itself not author stage outputs, but coordinate and record them

### Requirement: Optional Propose Direction-Review Gate

Auto SHALL support an optional gate by which the LEAD reviews the propose output for direction drift before implementation, controlled by a parameter.

#### Scenario: Lead reviews the plan for drift

- **WHEN** the propose direction-review gate is enabled (e.g. via `--review-plan` or a pipeline `leadReview` flag)
- **THEN** after the propose worker returns and before `apply`, the LEAD SHALL review `proposal/design/specs/tasks` against the original user intent
- **AND** on detecting drift the LEAD SHALL bounce the work back to a fresh planner worker or surface it to the user
- **AND** because the LEAD did not author the proposal, this review SHALL count as a non-author check

#### Scenario: Gate disabled by default leaves flow unchanged

- **WHEN** the gate is not enabled
- **THEN** auto SHALL proceed from propose to the next stage without the extra LEAD review
