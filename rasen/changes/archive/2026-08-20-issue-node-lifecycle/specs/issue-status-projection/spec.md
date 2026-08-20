## MODIFIED Requirements

### Requirement: Phase derives from where the execution graph stands

The phase SHALL follow the execution graph's real state: `planning` while the Issue has no
readable published plan or while its plan names only intent nodes and nothing has started;
`ready` once a readable plan names at least one Change node whose work the plan still wants
(`required` or `optional`) and no node has started; `active`
once any node whose work the plan still wants is running or the graph has partially advanced;
`review` in exactly two cases — an open Issue whose every required Change node's work is
complete or finalized and no intent node remains, and a resolved Issue whose acceptance record
does not read back verified, whatever its nodes' state (the operator has declared the work over,
so the graph no longer scopes the phase and only the unproven acceptance remains); and `done`
only for an Issue whose state is resolved AND whose acceptance record reads back verified.
Archived Changes alone SHALL NOT make an Issue `done`, and the resolved state alone SHALL NOT
make an Issue `done`. A node marked `cancelled` or `superseded` SHALL be outside the execution
graph: its recorded activity or staleness SHALL drive no phase value, though its observation is
still reported on its node line, and an `optional` node's incomplete work SHALL NOT keep an
Issue out of `review`.

#### Scenario: No plan means planning

- **WHEN** an Issue has no published Execution Plan revision
- **THEN** its phase is `planning`

#### Scenario: A confirmed plan that has not started is ready

- **WHEN** an Issue's latest readable revision names three Change nodes and none has recorded run-state or committed progress
- **THEN** its phase is `ready`

#### Scenario: Partially advanced work is active

- **WHEN** one Change node of an Issue's plan has recorded run-state with completed stages while its siblings have not started
- **THEN** its phase is `active`

#### Scenario: Completed implementation awaiting the Issue's own close is review

- **WHEN** every required Change node of an Issue's plan is complete or finalized, no intent node remains, and no verified acceptance record exists
- **THEN** its phase is `review`

#### Scenario: A premature close reads review regardless of the graph

- **WHEN** an Issue's state is set to resolved while one of its required Change nodes is still in flight, and no acceptance record exists
- **THEN** its phase reads `review` and its health reads `waiting-human`
- **AND** its acceptance gate still names the un-terminal node, so no acceptance is possible until the work is real

#### Scenario: Done belongs to the operator, not to the archive

- **WHEN** every Change node of an Issue's plan is finalized and its state is resolved without an acceptance record
- **THEN** its phase remains `review`
- **AND** the phase becomes `done` when an acceptance record reads back verified beside the resolved state

#### Scenario: An optional node still running does not hold review

- **WHEN** every required Change node of an Issue's plan is complete or finalized and one optional node is still in flight
- **THEN** its phase is `review`
- **AND** the optional node's in-flight observation is still reported on its node line

#### Scenario: A cancelled node's recorded activity drives no phase

- **WHEN** a node marked `cancelled` or `superseded` carries recorded run-state that is still in flight
- **THEN** the Issue's phase derives from its other nodes alone
- **AND** the cancelled node's observation is still reported on its node line

#### Scenario: A plan of intent nodes and only-cancelled nodes stays planning

- **WHEN** an Issue's plan names one intent node and one `cancelled` Change node, and nothing has started
- **THEN** its phase is `planning`, not `ready`, because no wanted Change node exists
- **AND** the cancelled node's observation is still reported on its node line

### Requirement: Health reports only what a recorded signal supports

The health value SHALL be derived from recorded signals: `failed` when a Change's run-state
records a failure escalation of a portfolio child or of a portfolio delivery; `waiting-human`
when a Change's run-state parks a stage as escalated for a human decision, and for an Issue in the
`review` phase, whose remaining work — merge, release, or acceptance — is by definition
human-owned; `healthy` otherwise. A health value SHALL be presented only when a recorded signal
supports it, so the `blocked` and `stale` values remain reserved until a capability records a
real blockage or staleness signal, and ordinary dependency ordering among not-yet-started nodes
SHALL be reported as `healthy`. Failure and wait signals SHALL come from work the plan still
wants — `required` and `optional` nodes: a `cancelled` or `superseded` node's recorded escalation
is history and SHALL drive no health value.

#### Scenario: A parked stage is waiting for a human, not a new phase

- **WHEN** a Change node's run-state records a stage parked as escalated for a human decision
- **THEN** the Issue's health is `waiting-human`
- **AND** its phase still describes where the work stands

#### Scenario: A failed child or delivery is failed health

- **WHEN** a Change node's portfolio run-state records a child or the delivery as escalated after failure
- **THEN** the Issue's health is `failed`

#### Scenario: A failed optional child is failed health

- **WHEN** an optional Change node's run-state records a failure escalation
- **THEN** the Issue's health is `failed`
- **AND** the failure is named on that node's line, so the operator can re-run the work or cancel the node with a recorded reason

#### Scenario: A cancelled node's recorded failure is history, not health

- **WHEN** a node marked `cancelled` or `superseded` carries run-state recording a failure escalation
- **THEN** the Issue's health derives from its other nodes alone
- **AND** the cancelled node's observation is still reported on its node line

#### Scenario: Serial ordering is healthy

- **WHEN** an Issue's plan is a serial chain and the second node awaits the first
- **THEN** the Issue's health is `healthy`

#### Scenario: Review waits for its human

- **WHEN** an open Issue's phase is `review` and no failure escalation is recorded
- **THEN** its health is `waiting-human`

#### Scenario: Reserved values are not fabricated

- **WHEN** an Issue's evidence carries no blockage or staleness signal
- **THEN** its health is one of `healthy`, `failed`, or `waiting-human`
- **AND** `blocked` and `stale` are presented only by a future capability that records such signals

### Requirement: Progress counts required nodes whose work is complete

Progress SHALL report completed required nodes over the total required nodes of the Issue's
latest readable plan revision, where the required nodes are the Change nodes whose lifecycle is
`required`. A node counts as complete when the Store's committed evidence
finalizes its Change or when its Change's recorded run-state is terminal with every stage done
or skipped and any portfolio delivery recorded done. Work that is finished but not yet
finalized still counts, because progress measures work completed, not archiving. A node whose
lifecycle is `optional`, `cancelled`, or `superseded` SHALL be counted in neither part of the
pair — its completion, when recorded, is visible on its node line and counted nowhere. An Issue
whose latest revision exists but cannot be read SHALL report no progress value rather than a zero
that would read as "nothing required", and a readable revision that names no required nodes
SHALL report zero completed over zero total, saying that no work is demanded rather than that
no value could be derived.

#### Scenario: One of three children complete

- **WHEN** an Issue's plan has three required Change nodes and one has terminal run-state while two have not started
- **THEN** progress reports 1 completed of 3 total

#### Scenario: Finalized and run-terminal nodes count the same

- **WHEN** one node's Change is finalized in the Store and a sibling node's Change has terminal run-state
- **THEN** both count toward completed progress

#### Scenario: Optional and cancelled completions are not counted

- **WHEN** an Issue's plan has three required nodes and one optional node whose work is complete
- **THEN** progress reports over a total of three
- **AND** the optional node's completion is reported on its node line and counted in neither part of the pair

#### Scenario: A plan with no required nodes reports zero over zero

- **WHEN** an Issue's latest readable revision names Change nodes whose lifecycles are all `optional`, `cancelled`, or `superseded`
- **THEN** progress reports 0 completed of 0 total
- **AND** the value is the pair itself, distinct from the no-progress value an unreadable revision reports

#### Scenario: An unreadable plan yields no progress

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** no progress pair is reported
- **AND** the reason is reported with the status

### Requirement: The Issue read surface shows the projection

`rasen store issue list` SHALL show each Issue's phase, health, and progress alongside its
state and title, and `rasen store issue show` SHALL show the Issue's tri-axis status followed by
one line per plan node carrying that node's identifier, kind, Change alias, observed execution
state, and any dependency or diagnostic that explains it. A node whose lifecycle is not
`required` SHALL have that lifecycle named on its node line, and a `cancelled` or `superseded`
node SHALL have its recorded reason shown with it. The `--json` form of both commands
SHALL carry every fact the human form carries, including per-node lifecycle, observations and status
problems.

#### Scenario: The list carries the status column

- **WHEN** Issues with derived statuses are listed
- **THEN** each line shows the Issue's state together with its phase, health, and progress pair

#### Scenario: The show command explains the status node by node

- **WHEN** an Issue with a published plan is shown
- **THEN** the status section reports the three axes
- **AND** one line per node reports its observed execution state and Change alias

#### Scenario: Node lines name the lifecycle a node carries

- **WHEN** an Issue's plan carries one optional node and one cancelled node with a recorded reason
- **THEN** the show command names `optional` on the one node's line
- **AND** names `cancelled` and the recorded reason on the other's

#### Scenario: Both forms agree

- **WHEN** the same Issue is listed and shown in human form and in `--json` form
- **THEN** the phase, health, progress, per-node lifecycles, per-node observations, and status problems are the same facts in both forms
