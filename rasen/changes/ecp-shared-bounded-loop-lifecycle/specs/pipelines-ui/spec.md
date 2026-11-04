# pipelines-ui Specification Delta

## ADDED Requirements

### Requirement: Operations renders one shared bounded-loop lifecycle view

Operations SHALL render every `bounded-loop-lifecycle/1` section supplied by `ChangeRunView` without recomputing lifecycle mechanics. The view SHALL identify the loop and body kind and show current state, normal iteration and phase, used/max iteration/action/budget values, stall and same-blocker streaks, strategy attempts, active wait, and typed lifecycle outcome. Review and goal domain panels SHALL remain separate and SHALL compose with the shared lifecycle panel by loop path.

#### Scenario: Review lifecycle and finding detail remain separate

- **WHEN** a ReviewCycle is strategizing after unchanged open Major findings
- **THEN** Operations shows strategy count, limits, and stall state from the lifecycle section
- **AND** it shows finding and actor detail from the review section without merging their schemas

#### Scenario: Goal lifecycle and score detail remain separate

- **WHEN** a measure GoalLoop is waiting after a repeated blocker
- **THEN** Operations shows blocker, wait, limits, and strategy state from the lifecycle section
- **AND** it shows variant and last score from the goal section

### Requirement: Operations makes lifecycle stops and waits actionable and truthful

Operations SHALL distinguish domain completion from iteration-limit, action-limit, budget-limit, stalled, blocked, strategy-exhausted, failed, and cancelled lifecycle outcomes. For a `human-required` wait it SHALL display the projected reason and evidence and submit only currently offered retry, escalate, or cancel controls with the exact Run identity and WaitId. It SHALL refresh from the returned canonical view after a control instead of applying optimistic local counters.

#### Scenario: Human retry uses the projected WaitId

- **WHEN** an operator selects retry on a human-required bounded-loop wait
- **THEN** Operations submits the retry decision with the exact projected WaitId and supplied evidence
- **AND** it renders the next state from the refreshed `ChangeRunView`

#### Scenario: Non-success exit is not presented as goal satisfaction

- **WHEN** a research GoalLoop exits at its iteration limit so a report tail may run
- **THEN** Operations shows the lifecycle exit reason and disposition
- **AND** it does not label the goal domain outcome as satisfied

### Requirement: Lifecycle rendering is additive and version tolerant

Shared UI wire types and Operations rendering SHALL treat lifecycle sections as additive versioned data. A missing section on an older stored terminal Run or an unknown future version SHALL not crash the page, erase the raw section, or cause the UI to infer success. Existing Canvas authoring behavior SHALL remain unchanged by this capability.

#### Scenario: Older terminal Run has no lifecycle section

- **WHEN** Operations loads a readable terminal Run created before lifecycle projection existed
- **THEN** it presents the available domain and terminal data with a compatibility notice
- **AND** it does not invent limits, streaks, strategy state, or a lifecycle outcome

#### Scenario: Unknown lifecycle version degrades safely

- **WHEN** Operations receives a bounded-loop lifecycle section with an unsupported version
- **THEN** it preserves generic Run visibility and identifies the unsupported section
- **AND** it does not offer lifecycle controls based on an unrecognized contract
