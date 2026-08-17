# issue-status-projection Specification (Delta)

## MODIFIED Requirements

### Requirement: Status is derived on read and never a second mutable truth

An Issue's status SHALL be computed fresh on every read from four inputs — the Issue's latest
published Execution Plan revision, the Store's committed evidence for the Changes that revision
names, the run-state those Changes recorded on the machine the read runs from, and the Issue's
recorded acceptance (its acceptance conditions and acceptance record) — and SHALL be persisted
nowhere: no status value SHALL be written into an Issue record, an Execution Plan revision, a
Change's run-state, or an acceptance record by the projection. Reading the same Issue over
unchanged evidence SHALL yield the same status, and the status SHALL change only when the
underlying evidence does.

#### Scenario: Unchanged evidence yields unchanged status

- **WHEN** an Issue's status is read twice with no change to its plan revisions, committed evidence, run-state, or acceptance content
- **THEN** both reads report the same phase, health, and progress

#### Scenario: A real transition changes the projection

- **WHEN** an Issue with no published plan has one published, and a Change the plan names has recorded run-state
- **THEN** the first read reports the pre-plan phase
- **AND** the second read reports a phase and progress derived from that plan and run-state

#### Scenario: The projection writes nothing

- **WHEN** an Issue's status is read
- **THEN** the Issue record, every Execution Plan revision, every Change run-state file, and every acceptance file are byte-identical before and after the read

### Requirement: Phase derives from where the execution graph stands

The phase SHALL follow the execution graph's real state: `planning` while the Issue has no
readable published plan or while its plan names only intent nodes and nothing has started;
`ready` once a readable plan names at least one Change node and no node has started; `active`
once any node is running or the graph has partially advanced; `review` in exactly two cases —
an open Issue whose every Change node's work is complete or finalized and no intent node
remains, and a resolved Issue whose acceptance record does not read back verified, whatever its
nodes' state (the operator has declared the work over, so the graph no longer scopes the phase
and only the unproven acceptance remains); and `done` only for an Issue whose state is resolved
AND whose acceptance record reads back verified. Archived Changes alone SHALL NOT make an Issue
`done`, and the resolved state alone SHALL NOT make an Issue `done`.

#### Scenario: No plan means planning

- **WHEN** an Issue has no published Execution Plan revision
- **THEN** its phase is `planning`

#### Scenario: A confirmed plan that has not started is ready

- **WHEN** an Issue's latest readable revision names three Change nodes and none has recorded run-state or committed progress
- **THEN** its phase is `ready`

#### Scenario: Partially advanced work is active

- **WHEN** one Change node of an Issue's plan has recorded run-state with completed stages while its siblings have not started
- **THEN** its phase is `active`

#### Scenario: Completed implementation awaiting the Issue's acceptance is review

- **WHEN** every Change node of an Issue's plan is complete or finalized, no intent node remains, and no verified acceptance record exists
- **THEN** its phase is `review`

#### Scenario: A premature close reads review regardless of the graph

- **WHEN** an Issue's state is set to resolved while one of its Change nodes is still in flight, and no acceptance record exists
- **THEN** its phase reads `review` and its health reads `waiting-human`
- **AND** its acceptance gate still names the un-terminal node, so no acceptance is possible until the work is real

#### Scenario: Done belongs to the recorded acceptance, not to the archive or a state flip

- **WHEN** every Change node of an Issue's plan is finalized and its state is resolved without an acceptance record
- **THEN** its phase remains `review`
- **AND** the phase becomes `done` when an acceptance record reads back verified beside the resolved state
