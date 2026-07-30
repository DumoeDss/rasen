# full-feature-workflow Specification

## Purpose
Hold the end-to-end guarantee for the `full-feature` built-in: it executes as ONE canonical
reconciler Run across its Choice, FanOut/Join and review-loop shape, with member failure
semantics (optional suppressed, required fail-closed) and restart idempotency demonstrated
on the real pipeline rather than on a fixture.

This capability is deliberately thin — the mechanics live in
`executable-parallel-pipelines` and `executable-review-cycle`; what lives here is the
claim that the composed built-in itself runs.

## Requirements
### Requirement: full-feature pipeline executes via the reconciler

The `full-feature` built-in pipeline SHALL normalize from v1 to a v2 definition containing FanOut, Join, and BoundedLoop nodes. The reconciler SHALL execute the full pipeline as a real Run: office-hours → propose → apply → FanOut(expert reviews) → Join → review-loop(BoundedLoop) → ship → retain → archive.

#### Scenario: full-feature normalizes to v2 with FanOut and Join

- **WHEN** the `full-feature` v1 pipeline YAML is prepared for the reconciler
- **THEN** the normalized v2 definition SHALL contain a `FanOut` root node with 6 expert-review members
- **AND** a `Join` root node
- **AND** a `BoundedLoop` root node for the review-loop
- **AND** the `review` member SHALL be required (`condition: always`)
- **AND** all other expert members SHALL be optional

#### Scenario: full-feature Run completes end-to-end

- **WHEN** a real CLI Run of `full-feature` is started
- **THEN** the Run SHALL progress through office-hours, propose, apply
- **AND** the FanOut condition evaluator SHALL determine which expert reviews are active
- **AND** active members SHALL be admitted under the concurrency cap
- **AND** the Join SHALL proceed once all active members are terminal
- **AND** the review-loop SHALL execute through its phases
- **AND** the Run SHALL reach ship → retain → archive → completed

#### Scenario: Parallel frontier visible from CLI status

- **WHEN** `pipeline status` is run during the FanOut phase
- **THEN** the output SHALL show the `parallel/1` section with member statuses
- **AND** SHALL show the join state, concurrency cap, and budget usage
- **AND** SHALL show key blockers (e.g., waiting for required member)

#### Scenario: full-feature analyzeReconcilerSupport

- **WHEN** `pipeline show full-feature --json` is run
- **THEN** the result SHALL report `availableEngines` including `'reconciler'`
- **AND** SHALL report `executionMode: 'reconciler'` when capability bindings are complete

