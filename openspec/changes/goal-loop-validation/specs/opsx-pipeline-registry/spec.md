## ADDED Requirements

### Requirement: Goal-Loop Gate Metadata Rendered in Pipeline Show

The human-readable `openspec pipeline show <name>` output SHALL render a stage's loop metadata for both loop kinds. For a `review-cycle` loop the meta line SHALL remain `loop=review-cycle(max <N>)`. For a `goal` loop the meta line SHALL name the gate kind and both bounds: `loop=goal[<gate-kind>](max <N>, stall <L>)`, where `<gate-kind>` is `measure` or `evaluate`, `<N>` is the goal variant's `maxRounds`, and `<L>` is its `loopStallLimit`. This generalizes the review-cycle-only label that preceded the goal-loop addition.

#### Scenario: Measure gate rendered in show

- **WHEN** `openspec pipeline show goal-loop-measure` renders the `iterate` stage
- **THEN** the stage meta SHALL include `loop=goal[measure](max <maxRounds>, stall <loopStallLimit>)`

#### Scenario: Evaluate gate rendered in show

- **WHEN** `openspec pipeline show goal-loop-evaluate` (or `goal-loop-research`) renders the `iterate` stage
- **THEN** the stage meta SHALL include `loop=goal[evaluate](max <maxRounds>, stall <loopStallLimit>)`

#### Scenario: Review-cycle label unchanged

- **WHEN** `openspec pipeline show <pipeline>` renders a stage with a `review-cycle` loop
- **THEN** the stage meta SHALL include `loop=review-cycle(max <N>)` and SHALL NOT include the goal-loop bracket format
