## ADDED Requirements

### Requirement: Goal-Loop Round Protocol in the Playbook

The orchestration playbook SHALL include a dedicated goal-loop step (Step L) that the LEAD executes when a stage's `loop.kind` is `goal`. The step SHALL define, per round: inject the effective gate config (read from `goal-plan.md`) into run-state once before round 1; dispatch the implementer (warm-reused across rounds); run the gate (`measure` = run the command and parse `{score, passed, detail}`; `evaluate` = dispatch a fresh reviewer worker returning `{satisfied, gaps}`); append the round record to `goal-run.json`; stop on satisfaction or at `maxRounds` (marking `maxRounds-exhausted`); and trigger LEAD strategy review after `loopStallLimit` consecutive non-progressing rounds. Resume SHALL read the authoritative last record in `goal-run.json` to decide tail vs. next-round vs. round-1.

#### Scenario: Playbook dispatches on loop kind

- **WHEN** the LEAD encounters a stage with a `loop` field
- **THEN** it SHALL narrow on `loop.kind`
- **AND** `review-cycle` SHALL run the existing review→fix protocol (Step E) unchanged
- **AND** `goal` SHALL run the goal-loop protocol (Step L)

#### Scenario: Gate config injected before round one

- **WHEN** a goal-loop stage begins and no round has run yet
- **THEN** the LEAD SHALL read `goal-plan.md`, merge the concrete gate config into the iterate stage's `loopConfig` in run-state
- **AND** SHALL assert that a measure gate has its `command` before dispatching round 1

#### Scenario: Round record recorded to goal-run.json

- **WHEN** a goal-loop round's gate completes
- **THEN** the LEAD SHALL append `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}` to `goal-run.json`

## MODIFIED Requirements

### Requirement: Gate, Loop, Parallel, and Condition Interpretation

The LEAD SHALL interpret stage metadata: pause at gates, run loop stages as bounded loops (dispatching on `loop.kind` — `review-cycle` runs the bounded review→fix loop, `goal` runs the bounded goal-loop), run parallel-group stages concurrently, and skip stages whose condition is unmet.

#### Scenario: Gate pauses for the human

- **WHEN** a stage declares a `gate`
- **THEN** the LEAD SHALL pause after that stage, summarize what was done and what is next, and wait for human confirmation to continue, stop, or switch to manual

#### Scenario: Loop kind is dispatched

- **WHEN** a stage declares a `loop`
- **THEN** the LEAD SHALL narrow on `loop.kind`
- **AND** for `review-cycle` it SHALL run the bounded review→fix loop (Step E)
- **AND** for `goal` it SHALL run the bounded goal-loop (Step L)

#### Scenario: Parallel group runs concurrently

- **WHEN** multiple stages share a `parallelGroup` and their conditions are met
- **THEN** the LEAD SHALL dispatch their workers concurrently and collect all results before proceeding

#### Scenario: Condition gates a stage

- **WHEN** a stage declares a `condition` that is not met for the current change
- **THEN** the LEAD SHALL skip that stage and record the skip
