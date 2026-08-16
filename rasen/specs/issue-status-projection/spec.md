# issue-status-projection Specification

## Purpose
This capability answers "where is this Issue right now" for a Store Issue. It projects a
tri-axis status — a lifecycle `phase`, an executional `health`, and a `progress` pair over the
required nodes of the Issue's plan — derived fresh on every read from the Issue's latest
published Execution Plan revision, the Store's committed evidence for the Changes that revision
names, and the run-state those Changes recorded on the machine the read runs from. The
projection is read-only and persisted nowhere, and it surfaces on the `rasen store issue list`
and `rasen store issue show` read surface in both human and `--json` forms.

## Requirements
### Requirement: An Issue's status is projected on three orthogonal axes

Rasen SHALL answer "where is this Issue right now" for a Store Issue as three independent values:
a lifecycle `phase` drawn from `planning | ready | active | review | done`; an executional
`health` drawn from `healthy | blocked | failed | waiting-human | stale`; and a `progress` pair
of completed required nodes over total required nodes. A failure, a blockage, or a wait for a
human SHALL be reported in `health` while `phase` continues to describe where the work stands,
so an Issue with one failed Change among running siblings reports an active phase and a failed
health at the same time.

#### Scenario: A failure among running work stays in health

- **WHEN** an Issue's plan has three Change nodes, two are mid-run and one has recorded a failure escalation
- **THEN** the Issue's phase is `active`
- **AND** the Issue's health is `failed`

#### Scenario: The three axes vary independently

- **WHEN** two Issues both report phase `active`
- **THEN** one can report health `healthy` with progress `1/3` while the other reports health `waiting-human` with progress `0/3`
- **AND** neither Issue's phase value changes because of its health value

### Requirement: Status is derived on read and never a second mutable truth

An Issue's status SHALL be computed fresh on every read from three inputs — the Issue's latest
published Execution Plan revision, the Store's committed evidence for the Changes that revision
names, and the run-state those Changes recorded on the machine the read runs from — and SHALL be
persisted nowhere: no status value SHALL be written into an Issue record, an Execution Plan
revision, or a Change's run-state by the projection. Reading the same Issue over unchanged
evidence SHALL yield the same status, and the status SHALL change only when the underlying
evidence does.

#### Scenario: Unchanged evidence yields unchanged status

- **WHEN** an Issue's status is read twice with no change to its plan revisions, committed evidence, or run-state
- **THEN** both reads report the same phase, health, and progress

#### Scenario: A real transition changes the projection

- **WHEN** an Issue with no published plan has one published, and a Change the plan names has recorded run-state
- **THEN** the first read reports the pre-plan phase
- **AND** the second read reports a phase and progress derived from that plan and run-state

#### Scenario: The projection writes nothing

- **WHEN** an Issue's status is read
- **THEN** the Issue record, every Execution Plan revision, and every Change run-state file are byte-identical before and after the read

### Requirement: Phase derives from where the execution graph stands

The phase SHALL follow the execution graph's real state: `planning` while the Issue has no
readable published plan or while its plan names only intent nodes and nothing has started;
`ready` once a readable plan names at least one Change node and no node has started; `active`
once any node is running or the graph has partially advanced; `review` when every Change node's
work is complete or finalized, no intent node remains, and the Issue is still open; and `done`
only for an Issue whose state the operator has resolved. Archived Changes alone SHALL NOT make
an Issue `done`.

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

- **WHEN** every Change node of an open Issue's plan is complete or finalized and no intent node remains
- **THEN** its phase is `review`

#### Scenario: Done belongs to the operator, not to the archive

- **WHEN** every Change node of an open Issue's plan is finalized
- **THEN** its phase remains `review`
- **AND** the phase becomes `done` when the Issue's state is resolved

### Requirement: Health reports only what a recorded signal supports

The health value SHALL be derived from recorded signals: `failed` when a Change's run-state
records a failure escalation of a portfolio child or of a portfolio delivery; `waiting-human`
when a Change's run-state parks a stage as escalated for a human decision, and for an Issue in
the `review` phase, whose remaining work — merge, release, or acceptance — is by definition
human-owned; `healthy` otherwise. A health value SHALL be presented only when a recorded signal
supports it, so the `blocked` and `stale` values remain reserved until a capability records a
real blockage or staleness signal, and ordinary dependency ordering among not-yet-started nodes
SHALL be reported as `healthy`.

#### Scenario: A parked stage is waiting for a human, not a new phase

- **WHEN** a Change node's run-state records a stage parked as escalated for a human decision
- **THEN** the Issue's health is `waiting-human`
- **AND** its phase still describes where the work stands

#### Scenario: A failed child or delivery is failed health

- **WHEN** a Change node's portfolio run-state records a child or the delivery as escalated after failure
- **THEN** the Issue's health is `failed`

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
latest readable plan revision. A node counts as complete when the Store's committed evidence
finalizes its Change or when its Change's recorded run-state is terminal with every stage done
or skipped and any portfolio delivery recorded done. Work that is finished but not yet
finalized still counts, because progress measures work completed, not archiving. An Issue whose
latest revision exists but cannot be read SHALL report no progress value rather than a zero
that would read as "nothing required".

#### Scenario: One of three children complete

- **WHEN** an Issue's plan has three Change nodes and one has terminal run-state while two have not started
- **THEN** progress reports 1 completed of 3 total

#### Scenario: Finalized and run-terminal nodes count the same

- **WHEN** one node's Change is finalized in the Store and a sibling node's Change has terminal run-state
- **THEN** both count toward completed progress

#### Scenario: An unreadable plan yields no progress

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** no progress pair is reported
- **AND** the reason is reported with the status

### Requirement: Run-state visibility is located and labelled

An Issue's status SHALL be computed from the run-state of its referenced Changes located
through the same state-file placement a pipeline resume reads — the execution root's ephemera
directory first, then the legacy work directory, then the change directory — on the machine and
working directory the command runs from. When no execution root resolves, or a Change's
run-state is absent, the projection SHALL say so: such a node reports not-started with no local
run-state, the answer labels its run-state visibility, and absence SHALL NOT be presented as a
failure. A run-state file that exists but cannot be parsed SHALL be reported as a status
problem naming the file and the reason, with the node reported unknown rather than guessed.

#### Scenario: An unrelated working directory sees committed evidence only

- **WHEN** an Issue's status is read from a directory that resolves no project execution root
- **THEN** phase and progress derive from the plan revision and committed Store evidence
- **AND** the answer labels that no local run-state was visible

#### Scenario: A live execution root sees the real run-state

- **WHEN** the same Issue's status is read from the execution root where a referenced Change is running
- **THEN** the Change's node reflects the recorded stage statuses
- **AND** the answer labels the execution root it consulted

#### Scenario: A corrupt run-state is reported, not guessed

- **WHEN** a Change's `auto-run.json` exists but cannot be parsed
- **THEN** the node is reported unknown with a status problem naming the file and reason
- **AND** no phase or health value is fabricated from the unreadable file

### Requirement: The Issue read surface shows the projection

`rasen store issue list` SHALL show each Issue's phase, health, and progress alongside its
state and title, and `rasen store issue show` SHALL show the Issue's tri-axis status followed by
one line per plan node carrying that node's identifier, kind, Change alias, observed execution
state, and any dependency or diagnostic that explains it. The `--json` form of both commands
SHALL carry every fact the human form carries, including per-node observations and status
problems.

#### Scenario: The list carries the status column

- **WHEN** Issues with derived statuses are listed
- **THEN** each line shows the Issue's state together with its phase, health, and progress pair

#### Scenario: The show command explains the status node by node

- **WHEN** an Issue with a published plan is shown
- **THEN** the status section reports the three axes
- **AND** one line per node reports its observed execution state and Change alias

#### Scenario: Both forms agree

- **WHEN** the same Issue is listed and shown in human form and in `--json` form
- **THEN** the phase, health, progress, per-node observations, and status problems are the same facts in both forms
