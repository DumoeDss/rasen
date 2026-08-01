## MODIFIED Requirements

### Requirement: full-feature pipeline executes via the reconciler

The `full-feature` built-in pipeline SHALL normalize from v1 to a v2 definition containing FanOut, Join, and BoundedLoop nodes. The reconciler SHALL execute the full pipeline as a real Run: office-hours → propose → apply → FanOut(expert reviews) → Join → review-loop(BoundedLoop) → ship → retain → archive. The expert FanOut SHALL retain six members, with mutually exclusive UI and non-UI QA members both dispatching the single `rasen-qa` expert; the non-UI member SHALL explicitly request report-only mode.

#### Scenario: full-feature normalizes to v2 with FanOut and Join

- **WHEN** the `full-feature` v1 pipeline YAML is prepared for the reconciler
- **THEN** the normalized v2 definition SHALL contain a `FanOut` root node with six expert-review members
- **AND** a `Join` root node
- **AND** a `BoundedLoop` root node for the review-loop
- **AND** the `review` member SHALL be required (`condition: always`)
- **AND** all other expert members SHALL be optional
- **AND** the `qa` UI member and `qa-report-only` non-UI member SHALL both resolve to `rasen-qa`
- **AND** no member SHALL resolve to `rasen-qa-only`

#### Scenario: full-feature Run completes end-to-end

- **WHEN** a real CLI Run of `full-feature` is started
- **THEN** the Run SHALL progress through office-hours, propose, and apply
- **AND** the FanOut condition evaluator SHALL determine which expert reviews are active
- **AND** exactly one of the UI QA or non-UI report-only QA members SHALL be eligible for a given classification
- **AND** active members SHALL be admitted under the concurrency cap
- **AND** the Join SHALL proceed once all active members are terminal
- **AND** both QA branches SHALL use the canonical `qa-report.md` evidence contract
- **AND** the review-loop SHALL execute through its phases
- **AND** the Run SHALL reach ship → retain → archive → completed

#### Scenario: Parallel frontier visible from CLI status

- **WHEN** `pipeline status` is run during the FanOut phase
- **THEN** the output SHALL show the `parallel/1` section with member statuses
- **AND** SHALL show the join state, concurrency cap, and budget usage
- **AND** SHALL show key blockers such as waiting for a required member

#### Scenario: full-feature analyzeReconcilerSupport

- **WHEN** `pipeline show full-feature --json` is run
- **THEN** the result SHALL report `availableEngines` including `reconciler`
- **AND** SHALL report `executionMode: 'reconciler'` when capability bindings are complete
