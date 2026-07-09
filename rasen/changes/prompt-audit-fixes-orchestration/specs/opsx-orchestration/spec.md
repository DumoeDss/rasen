## ADDED Requirements

### Requirement: LEAD May Apply Trivial Inline Fixes

The playbook's "you do NOT author stage outputs yourself" rule SHALL carry an explicit exception: the LEAD does not author WHOLE stage artifacts, but MAY apply trivial inline fixes per Step E.2 (which are then re-reviewed by a non-author). A one-character or otherwise trivial finding SHALL NOT require spawning a separate fixer worker.

#### Scenario: trivial inline fix is permitted

- **WHEN** the generated playbook opener (sole-orchestrator rule) is inspected
- **THEN** it SHALL state that the LEAD does not author whole stage artifacts but MAY apply trivial inline fixes per Step E.2
- **AND** SHALL state those inline fixes are re-reviewed by a non-author

### Requirement: Child Pipeline Gate Semantics Under Portfolio Orchestration

Step G SHALL define how a `childPipeline`'s internal `gate: true` stages resolve under portfolio orchestration. "Proceeds automatically (no human gate)" SHALL be stated to govern the decompose decision only, not the children's own gates. Child gates SHALL resolve per the parent run's gate directive: an autonomously-launched parent run treats child gates as auto-continue checkpoints (recorded, not paused per child), unless the user requested gating, in which case they collapse into one per-child checkpoint. The precedence SHALL be stated: parent directive > child pipeline `gate`.

#### Scenario: child gates resolve by parent directive

- **WHEN** the generated Step G is inspected
- **THEN** it SHALL state that "proceeds automatically" governs the decompose decision only
- **AND** SHALL state that child pipeline gates resolve per the parent run's directive (auto-continue by default, or one collapsed per-child checkpoint if the user requested gating)
- **AND** SHALL state the precedence parent-directive over child-pipeline-gate

### Requirement: Loop-Stage Per-Role Threshold Resolution

The playbook SHALL state that inside a loop stage (which carries a single nominal `role` but dispatches reviewers, implementers, and fixers) the LEAD resolves each dispatched worker's handoff threshold by that worker's ACTUAL role (`handoff.roles[<dispatched role>]`), not by the loop stage's nominal `role`.

#### Scenario: reviewer inside a review-loop uses the reviewer threshold

- **WHEN** the generated Step E / Step H is inspected
- **THEN** it SHALL state that a worker dispatched inside a loop stage resolves its handoff threshold by its own role, not the loop stage's nominal role
- **AND** SHALL give the reviewer-in-review-loop case (reviewer threshold, not the stage's fixer threshold)

### Requirement: parallelGroup Tier-C Degradation

Step D's `parallelGroup` interpretation SHALL state that under Tier C (no subagent capability) the group's members run sequentially in the single context, collecting all results before proceeding — the collect-all-before-proceeding invariant holding across tiers.

#### Scenario: parallelGroup runs sequentially under Tier C

- **WHEN** the generated Step D parallelGroup rule is inspected
- **THEN** it SHALL state that under Tier C members run sequentially in one context and all results are collected before proceeding

### Requirement: Run-State Records Session Relay Generation

The canonical run-state example in Step F SHALL include `sessionHandoff.n` (the relay generation), so the session-relay generation cap (Step H.7, `maxRelays`) can trip. The example SHALL not omit `n`, since a `sessionHandoff` record without `n` reads as generation 1 and never advances.

#### Scenario: sessionHandoff carries a generation field

- **WHEN** the generated Step F run-state example is inspected
- **THEN** the `sessionHandoff` object SHALL include an `n` field
- **AND** SHALL note it is the relay generation capped by Step H.7 at `maxRelays`
