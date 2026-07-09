# opsx-orchestration Specification

## Purpose
Defines the shared LEAD orchestration playbook that interprets any pipeline DAG (`opsx-pipeline-registry`) by driving role-isolated subagents. It owns capability-tier detection, role isolation and the structural author≠verifier invariant, the change-directory blackboard plus run-state, and the interpretation of gates, loops, parallel groups, and conditions — including bounded loops with human escalation. It is consumed by `opsx-auto-command` and `review-cycle-workflow`.

## ADDED Requirements

### Requirement: LEAD Is the Sole Orchestrator

The orchestration SHALL run as a single LEAD agent that spawns leaf worker subagents; workers SHALL NOT themselves spawn subagents.

#### Scenario: Flat hierarchy

- **WHEN** a pipeline is executed under the playbook
- **THEN** all stage dispatch, loop control, triage, and routing SHALL be performed by the LEAD
- **AND** each worker SHALL perform a single unit of work and return its result to the LEAD
- **AND** no worker SHALL spawn a further subagent

#### Scenario: Workers invoke existing skills

- **WHEN** the LEAD dispatches a stage
- **THEN** the worker SHALL invoke the stage's existing OPSX skill rather than reimplementing the stage logic

### Requirement: Capability Tiers Are Auto-Detected

The playbook SHALL detect the host's capability tier and choose execution mechanics accordingly, while keeping the pipeline definition identical across tiers.

#### Scenario: Tier A — agent-teams

- **WHEN** running on Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **THEN** the LEAD SHALL spawn role-isolated workers AND MAY resume a specific worker via `SendMessage` for warm-context continuation
- **AND** only the LEAD SHALL originate `SendMessage`

#### Scenario: Tier B — spawn without warm resume

- **WHEN** subagent spawning is available but agent-teams is not
- **THEN** the LEAD SHALL spawn a fresh worker per stage or round
- **AND** SHALL reconstruct each worker's context from the change directory and run-state

#### Scenario: Tier C — degraded fallback

- **WHEN** no subagent capability is available
- **THEN** the LEAD SHALL execute the pipeline sequentially in a single context
- **AND** this tier SHALL be treated as the explicit fallback, not the primary path

### Requirement: Role Isolation Enforces Author ≠ Verifier

The LEAD SHALL assign distinct workers by role so that a fix is always confirmed by a non-author.

#### Scenario: Distinct actors per role

- **WHEN** stages of different roles execute
- **THEN** the reviewer worker SHALL NOT be the implementer worker
- **AND** the fixer of a design-level finding SHALL NOT be the original author
- **AND** the worker that re-reviews a fix SHALL NOT be the worker that authored the fix

#### Scenario: Tier C equivalent check

- **WHEN** running under the single-context fallback
- **THEN** the non-author confirmation SHALL degrade to an independent gate-run plus diff-read recorded in run-state, and this SHALL be marked as the fallback

### Requirement: Change Directory Blackboard and Run-State

Stages SHALL hand off through the change directory, and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory as an OpenSpec artifact and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

### Requirement: Gate, Loop, Parallel, and Condition Interpretation

The LEAD SHALL interpret stage metadata: pause at gates, run loop stages as bounded review→fix loops, run parallel-group stages concurrently, and skip stages whose condition is unmet.

#### Scenario: Gate pauses for the human

- **WHEN** a stage declares a `gate`
- **THEN** the LEAD SHALL pause after that stage, summarize what was done and what is next, and wait for human confirmation to continue, stop, or switch to manual

#### Scenario: Parallel group runs concurrently

- **WHEN** multiple stages share a `parallelGroup` and their conditions are met
- **THEN** the LEAD SHALL dispatch their workers concurrently and collect all results before proceeding

#### Scenario: Condition gates a stage

- **WHEN** a stage declares a `condition` that is not met for the current change
- **THEN** the LEAD SHALL skip that stage and record the skip

### Requirement: Bounded Loops Escalate, Never Silently Pass

Loop stages SHALL be bounded by a max-rounds cap and SHALL escalate to the human on the cap with unresolved Blocker/Major findings.

#### Scenario: Cap reached with open blockers

- **WHEN** a loop stage reaches its max-rounds cap with unresolved Blocker or Major findings
- **THEN** the LEAD SHALL stop and escalate to the human with the open findings and the round history
- **AND** SHALL NOT report the stage as clean
