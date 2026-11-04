# executable-goal-loop Specification Delta

## MODIFIED Requirements

### Requirement: Reconciler executes goal-cycle bounded-loop nodes

The deterministic reconciler SHALL recognize `bounded-loop` plan nodes with a `goal-cycle` body, project goal domain progress from the frozen plan and committed Record, and pass that snapshot to the shared bounded-loop lifecycle reducer. GoalLoop SHALL continue to own work, judge, variant-specific result validation, score/gap meaning, and `satisfied` domain semantics; it SHALL NOT own lifecycle counters or mechanical terminal policy. The reconciler SHALL emit only the typed candidate selected by the lifecycle decision. A satisfied domain result SHALL make the bounded-loop node succeed, while a lifecycle exit, escalation, failure, wait, or strategy SHALL follow the sealed policy without claiming satisfaction. The reconciler SHALL guard `finishCandidate` while the lifecycle has remaining work.

#### Scenario: First work phase admitted on start

- **WHEN** a Run with one goal-cycle bounded-loop node and no root atomic dependencies is started
- **THEN** the lifecycle reducer selects exactly one admit candidate for the round-1 work phase nodeId
- **AND** the admit carries the work phase's admissionKind and workspace access
- **AND** the finish candidate does not fire

#### Scenario: Satisfied exit contributes to succeeded set

- **WHEN** the goal judge returns satisfied or passed
- **THEN** the reconciler adds the bounded-loop nodeId to the succeeded set
- **AND** no new loop action is admitted
- **AND** the configured downstream tail becomes eligible

#### Scenario: Mechanical trigger follows sealed lifecycle policy

- **WHEN** GoalLoop reaches an iteration, action, budget, stall, blocked, or strategy-exhausted trigger
- **THEN** the reconciler emits the ready, strategy, wait, exit, escalate, or fail candidate declared by the frozen lifecycle policy
- **AND** it does not hard-code the trigger to an exhausted escalation

#### Scenario: Judge phase admitted after work completes

- **WHEN** a round-1 work action completes with a valid domain result
- **THEN** the lifecycle decision admits the round-1 judge phase nodeId
- **AND** the admit carries the judge phase's admissionKind and workspace access

#### Scenario: Next round admitted after unsatisfied judge

- **WHEN** a judge action completes unsatisfied, the progress policy allows continuation, and normal iterations remain
- **THEN** the lifecycle decision admits the next round's work phase
- **AND** the normal iteration number increments by one

### Requirement: Round cap produces explicit exhausted outcome

When GoalLoop reaches its max-iterations limit without the judge returning satisfied or passed, the shared lifecycle reducer SHALL produce an explicit iteration-limit decision using the sealed `iterationLimit` disposition. The Run SHALL NOT silently loop, stall, or finish as satisfied. A strategy disposition SHALL use the separate strategy budget; an exit, escalation, or failure SHALL preserve the declared typed outcome in the canonical lifecycle projection.

#### Scenario: Max rounds can request a bounded strategy

- **WHEN** the final normal judge result is unsatisfied and `iterationLimit` maps to `strategy`
- **THEN** the goal loop does not enter the satisfied succeeded set
- **AND** the next candidate is the next bounded strategy attempt when one remains

#### Scenario: Research max rounds can continue to a report tail

- **WHEN** a research GoalLoop reaches the final normal judge and `iterationLimit` maps to `exit` with `max-rounds-exhausted`
- **THEN** the loop node becomes complete so the report-only tail is eligible
- **AND** the lifecycle and goal projections preserve that the goal was not satisfied

### Requirement: Goal projection section

The projector SHALL emit a `goal/1` view section when the plan contains a goal-cycle bounded-loop and a separate `bounded-loop-lifecycle/1` section for its shared mechanics. The goal section SHALL own variant, round, phase, domain outcome, last score for measure, and last gaps for evaluate or research. The lifecycle section SHALL own used/max iteration, action, and budget values, stall and blocker streaks, strategy state, wait, and lifecycle outcome. CLI, Management API, and Operations SHALL consume the same `ChangeRunView` sections; compatibility mirrors SHALL have parity assertions and SHALL NOT become writable state.

#### Scenario: Goal and lifecycle sections compose current state

- **WHEN** a measure GoalLoop is in round 2 at judge with last score 0.72 after one unchanged iteration
- **THEN** the goal section reports variant, round, phase, and last score
- **AND** the lifecycle section reports the authored loop limits, actual used values, and stall streak

#### Scenario: Terminal goal section distinguishes satisfaction from lifecycle exit

- **WHEN** a GoalLoop reaches either domain satisfaction or a non-success lifecycle exit
- **THEN** the goal section truthfully reports whether the domain was satisfied
- **AND** the lifecycle section reports the exact completion trigger and disposition

## ADDED Requirements

### Requirement: GoalLoop supplies variant-specific facts without owning shared mechanics

The GoalLoop adapter SHALL expose a deterministic domain snapshot containing current normal iteration and phase, satisfied or continue intent, the next domain invocation, and structured progress material. Measure progress SHALL use normalized direction and score. Evaluate and research progress SHALL use stable de-duplicated gaps plus satisfaction. GoalLoop code SHALL NOT count stalls, repeated blockers, strategy attempts, action use, or budget use after the shared lifecycle is installed.

#### Scenario: Measure score determines material progress

- **WHEN** consecutive measure judge results have the same normalized direction and score but different prose or actors
- **THEN** the adapter supplies equivalent progress material
- **AND** the shared lifecycle increments the stall streak

#### Scenario: Evaluate gap change resets stall

- **WHEN** a later evaluate judge result changes the stable normalized gap set
- **THEN** the shared lifecycle computes a different progress fingerprint
- **AND** the stall streak resets without changing GoalLoop's result schema

### Requirement: Goal blocked recovery always reads the latest attempt

GoalLoop phase lookup SHALL select the latest attempt by committed attempt ordinal with ActionId as a stable tie-breaker. A blocked completion SHALL use the typed bounded-loop blocked envelope. Resuming its wait SHALL admit a fresh phase attempt, and a later successful completion SHALL supersede the obsolete blocked attempt for reconciliation and projection.

#### Scenario: Goal retry escapes an earlier blocked attempt

- **WHEN** a goal work phase blocks, its wait is resumed, and a later attempt succeeds
- **THEN** GoalLoop advances to judge from the successful attempt
- **AND** restart projects the same judge phase without recreating the old wait

#### Scenario: Repeated goal blocker enters declared lifecycle branch

- **WHEN** successive latest attempts report the same semantic goal blocker until the configured threshold
- **THEN** the shared lifecycle applies the declared blocked strategy, human-required, or terminal disposition
- **AND** GoalLoop does not invent its own escalation rule

### Requirement: Goal compatibility projection never back-drives lifecycle state

`goal-run.json`, reports, and launcher output SHALL derive lifecycle counters, waits, strategy attempts, and terminal reasons from the canonical Record through `ChangeRunView`. They SHALL NOT determine resume, reset a streak, consume a strategy attempt, or change the declared disposition.

#### Scenario: Edited compatibility file cannot change resume

- **WHEN** a compatibility `goal-run.json` disagrees with the canonical Record about budget, stall, or outcome
- **THEN** resume follows the frozen plan and Record
- **AND** a new compatibility projection overwrites the disagreement rather than accepting it as state
