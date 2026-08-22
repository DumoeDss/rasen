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
`required`. A node counts as complete when the Store's committed evidence finalizes its Change
or when its Change's recorded run-state is terminal with every stage done or skipped and any
portfolio delivery recorded done. The Store's committed evidence finalizes a Change in two
record bases, and the basis is a fact the read reports: an archived Change with a committed
v2 outcome record, and an archived Change whose archive entry carries a legacy record basis —
no v2 outcome record where none was ever written — whose work SHALL count complete with the
legacy basis named on its facts, because the archive fact is itself committed evidence that
the Change's work story closed, and reading it invents no outcome value. An archive record
that exists in v2 shape but fails validation SHALL NOT finalize its Change: the node reports
`unknown` with a status problem naming the file and the reason, and no phase, health, or
progress value SHALL be fabricated from the unreadable record — damaged bytes never release a
dependency gate. Work that is finished but not yet finalized still counts, because progress
measures work completed, not archiving. A node whose lifecycle is `optional`, `cancelled`, or
`superseded` SHALL be counted in neither part of the pair — its completion, when recorded, is
visible on its node line and counted nowhere. An Issue whose latest revision exists but cannot
be read SHALL report no progress value rather than a zero that would read as "nothing
required", and a readable revision that names no required nodes SHALL report zero completed
over zero total, saying that no work is demanded rather than that no value could be derived.

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

#### Scenario: An archived legacy record counts its work complete

- **WHEN** a required node's Change is archived and its archive entry carries a legacy record basis with no v2 outcome record
- **THEN** the node counts toward completed progress on the archive fact alone, with no run-state located
- **AND** the node's facts name the legacy basis rather than presenting a v2 outcome or a run-terminal observation

#### Scenario: A corrupt v2 archive record is reported, not guessed

- **WHEN** a node's Change is archived and its archive record is in v2 shape but fails validation
- **THEN** the node is reported unknown with a status problem naming the file and the reason
- **AND** no completion, phase value, or dependency release is derived from the unreadable record

### Requirement: Run-state visibility is located and labelled

An Issue's status SHALL be computed from the run-state of its referenced Changes located through
the same state-file placement a pipeline resume reads — the execution root's ephemera directory
first, then the legacy work directory, then the change directory — on the machine the read runs
from, and additionally through the execution root recorded for a Change's instance in the Store's
workspace index, searched after the working directory's own execution root so a read from the
Store root or any unrelated directory still finds a member project's recorded activity. Each
node's status SHALL label which locator found its run-state. When neither the working directory's
execution root nor a workspace index entry provides a Change's run-state, the projection SHALL
say so: such a node reports not-started with no local run-state, the answer labels its run-state
visibility, and absence SHALL NOT be presented as a failure. A run-state file that exists but
cannot be parsed SHALL be reported as a status problem naming the file and the reason, with the
node reported unknown rather than guessed.

#### Scenario: An unrelated working directory sees committed evidence only

- **WHEN** an Issue's status is read from a directory that resolves no project execution root and the Change's instance has no workspace index entry
- **THEN** phase and progress derive from the plan revision and committed Store evidence
- **AND** the answer labels that no local run-state was visible

#### Scenario: A live execution root sees the real run-state

- **WHEN** the same Issue's status is read from the execution root where a referenced Change is running
- **THEN** the Change's node reflects the recorded stage statuses
- **AND** the answer labels the execution root it consulted

#### Scenario: A workspace-indexed Change is observed from anywhere

- **WHEN** an Issue's status is read from a directory that resolves no project execution root, and a referenced Change's instance has a workspace index entry recording an execution root where its run-state lives
- **THEN** the Change's node reflects the recorded stage statuses found through that entry
- **AND** the node's status labels the workspace index as the locator that found it

#### Scenario: A corrupt run-state is reported, not guessed

- **WHEN** a Change's `auto-run.json` exists but cannot be parsed
- **THEN** the node is reported unknown with a status problem naming the file and reason
- **AND** no phase or health value is fabricated from the unreadable file

### Requirement: The Issue read surface shows the projection

`rasen store issue list` SHALL show each Issue's phase, health, and progress alongside its
state and title, and `rasen store issue show` SHALL show the Issue's tri-axis status followed by
one line per plan node carrying that node's identifier, kind, target project,
Change alias, observed execution state, and any dependency or diagnostic that explains it, and any
recorded execution suggestion and decomposition rationale or uncertainty the node carries. `show` SHALL group those node lines under one lane
header per member project the revision names — each header carrying the
project's identity, its display alias when one is known, and the lane's
progress pair — and `list` SHALL carry a compact per-project progress summary
beside the Issue-level pair, the same lane facts in the same order. A node whose lifecycle is not
`required` SHALL have that lifecycle named on its node line, whatever the node's kind, and a `cancelled` or `superseded`
node SHALL have its recorded reason shown with it. A node's target project
SHALL be shown as the fact the revision records — the project the plan's
author targeted — and SHALL drive no phase, health, or progress value: a
revision whose nodes name one project and a revision whose nodes name several
derive their axes by the same rules. A node's recorded suggestion, rationale, and uncertainty SHALL
be shown as facts the revision records and SHALL drive no phase, health, or progress value: they are
what a reviewer reads, not values the projection interprets. A node line's dependency facts SHALL
follow the same rule start enforces — the work-complete rule — so the read
surface explains exactly what a launch will wait for: each dependency whose
observed work is not complete SHALL be named on the downstream node's line
with its node identifier, its target project, and its observed state, and a
dependency whose observed work is complete SHALL NOT be named as a blocker
even before its Change is archived. When the Issue's latest readable revision supersedes another
revision, `show` SHALL report the node-level delta between them — nodes added, nodes removed,
nodes retargeted to another project, dependency edges added or removed, lifecycle changes, and
suggestion changes — derived on read from the two revisions alone, persisted nowhere, so a
reviewer sees what a revision changed (a merge, a split, a retarget) without diffing files. The
delta SHALL drive no phase, health, or progress value. A latest revision that supersedes nothing
SHALL report no delta section. The `--json` form of both commands
SHALL carry every fact the human form carries, including the per-project
lanes with their progress pairs, per-node target
project, per-node dependency facts, per-node lifecycle, per-node suggestion, rationale, and
uncertainty, observations and status
problems, and the revision delta.

#### Scenario: The list carries the status column

- **WHEN** Issues with derived statuses are listed
- **THEN** each line shows the Issue's state together with its phase, health, and progress pair
- **AND** each line with lanes carries the per-project progress summary beside the Issue-level pair

#### Scenario: The show command explains the status node by node

- **WHEN** an Issue with a published plan is shown
- **THEN** the status section reports the three axes
- **AND** one line per node reports its observed execution state and Change alias

#### Scenario: Show groups node lines into per-project lanes

- **WHEN** an Issue whose plan names nodes targeted at two member projects is shown
- **THEN** each project's node lines appear under that project's lane header carrying its identity, alias, and progress pair
- **AND** every node line still carries its own facts exactly as outside a lane

#### Scenario: A single-project plan shows one lane

- **WHEN** an Issue whose plan names nodes targeted at one project only is shown
- **THEN** the lane structure shows exactly one lane whose progress pair equals the Issue-level pair

#### Scenario: Node lines name the target project

- **WHEN** an Issue whose plan carries nodes targeted at two different member projects is shown
- **THEN** each node line names that node's own target project
- **AND** a plan whose nodes share one project shows that project on every node line

#### Scenario: The project fact derives nothing

- **WHEN** the same published revision is read after the target project began being shown
- **THEN** its phase, health, and progress are the values the same evidence derived before
- **AND** the target project is reported on the node line, not interpreted into any axis

#### Scenario: A decomposition revision is reviewable node by node

- **WHEN** an Issue whose latest revision was published from a decomposition is shown
- **THEN** each intent node's line carries its summary's node facts, its suggested pipeline, and its rationale or uncertainty
- **AND** the `--json` form carries the same suggestion, rationale, and uncertainty per node as the human form

#### Scenario: The suggestion and rationale derive nothing

- **WHEN** the same revision is read before and after the suggestion and rationale fields began being shown
- **THEN** its phase, health, and progress are the values the same evidence derived before
- **AND** the suggestion is reported on the node line, not interpreted into any axis

#### Scenario: Show reports what the latest revision changed

- **WHEN** an Issue whose latest readable revision supersedes a predecessor that carried three nodes — one removed, one retargeted, one re-edged, and one new node added — is shown
- **THEN** the delta report names the removed node, the retargeted node with both projects, the dependency change, and the added node
- **AND** the `--json` form carries the same delta facts, and the Issue's phase, health, and progress equal the values derived without the delta report

#### Scenario: A first revision reports no delta

- **WHEN** an Issue whose latest revision supersedes nothing is shown
- **THEN** no delta section is reported
- **AND** nothing about the node lines changes

#### Scenario: Cross-project blockers name the project they wait on

- **WHEN** an Issue's plan carries a node whose dependency targets another member project and that dependency's work is not complete
- **THEN** the downstream node's line names the dependency with its target project and its observed state
- **AND** the human and `--json` forms carry the same dependency facts

#### Scenario: A dependency whose work is complete is no blocker

- **WHEN** a dependency has terminal run-state while its Change is not yet archived
- **THEN** the downstream node's line does not name it as a blocker
- **AND** the dependency's own node line still reports its terminal observation

#### Scenario: Dependency waits stay healthy

- **WHEN** an Issue's plan is a serial chain across two member projects and the second node awaits the first
- **THEN** the Issue's health is `healthy`
- **AND** each wait is named on the downstream node line as a dependency fact

#### Scenario: Node lines name the lifecycle a node carries

- **WHEN** an Issue's plan carries one optional node and one cancelled node with a recorded reason
- **THEN** the show command names `optional` on the one node's line
- **AND** names `cancelled` and the recorded reason on the other's

#### Scenario: An intent node's optional lifecycle is named on its line

- **WHEN** an Issue's plan carries an intent node whose lifecycle is `optional`
- **THEN** the show command names `optional` on that intent node's line exactly as a Change node's
- **AND** the optional intent node is counted in no progress pair, in neither part

#### Scenario: Both forms agree

- **WHEN** the same Issue is listed and shown in human form and in `--json` form
- **THEN** the phase, health, progress, per-project lanes with their progress pairs, per-node target projects, per-node dependency facts, per-node lifecycles, per-node suggestions, rationale, and uncertainty, per-node observations, status problems, and the revision delta are the same facts in both forms

### Requirement: Per-project lanes are derived on the work-complete rule

The projection SHALL derive, for an Issue whose latest plan revision reads
back, one lane per distinct target project the revision's nodes name. A lane
SHALL carry the project's identity, the node identifiers of that project's
nodes in the revision's canonical node order, a display alias for the project
when one is supplied as input and the raw project identity otherwise, and a
progress pair computed by the same rule and the same scoping as the Issue's
own progress — over the lane's Change nodes whose lifecycle is `required`,
where a node counts as complete on the work-complete basis and a lane whose
required count is zero reports zero completed over zero total. Lanes SHALL
drive no phase, health, or progress value: the Issue-level axes derive
exactly as they would without the lanes. An Issue whose latest revision
exists but does not read back SHALL report no lanes rather than empty ones,
and a lane SHALL exist only for a project the revision's nodes actually name.

#### Scenario: A two-project plan derives two lanes

- **WHEN** an Issue's readable revision names three nodes targeted at one member project and one node targeted at another
- **THEN** the status carries two lanes, one per project, each listing exactly its own nodes in canonical node order
- **AND** each lane's progress pair counts only that project's required Change nodes

#### Scenario: A single-project plan derives one lane

- **WHEN** an Issue's readable revision names nodes all targeted at one project
- **THEN** the status carries exactly one lane whose progress pair equals the Issue-level pair over the same nodes

#### Scenario: Lane progress uses the work-complete basis

- **WHEN** a lane's required node has terminal run-state while its Change is not yet archived
- **THEN** that node counts toward the lane's completed progress
- **AND** a sibling lane whose required node is in flight reports it uncompleted, so per-project "what's left" agrees with the node lines and the start gate

#### Scenario: Optional and cancelled work is not counted in any lane

- **WHEN** a lane's nodes include one optional node whose work is complete and one cancelled node
- **THEN** the lane's progress pair counts neither
- **AND** both nodes still appear in the lane's node list with their node-line facts

#### Scenario: An unreadable revision reports no lanes

- **WHEN** an Issue's latest revision exists but fails its digest or parse
- **THEN** the status reports no lanes and no lane progress
- **AND** the reason is reported with the status, as for the Issue-level progress

#### Scenario: Lanes drive no axis

- **WHEN** the same revision is read with lane derivation in place
- **THEN** its phase, health, and progress equal the values derived before lanes existed
- **AND** a lane's progress pair influences no Issue-level value it did not already determine

### Requirement: Publishing a revision preserves other nodes' observations

Publishing a new Execution Plan revision SHALL NOT change any node's observed execution state
except through real execution or committed Store evidence: a node whose Change instance the
new revision redeclares under the same project, line, and recorded alias SHALL read the same
observation it read under the previous revision, fact for fact — nodes the revision adds,
dependency edges it adds or removes, and lifecycle changes it declares on other nodes leave
the untouched node's observation identical. A node whose lifecycle the revision changes to
`cancelled` or `superseded` keeps its recorded observation on its node line — outside the
execution graph, still observed — and a node whose dependency edges changed keeps its
observation while its dependency facts follow the new declaration. Publishing is not
execution: only run-state writes and committed Store evidence move an observation, so the
operator may replan freely knowing observed history is never disturbed by the replan itself.

#### Scenario: Adding a node leaves its siblings' observations identical

- **WHEN** an Issue's revision N reads one node terminal and one not-started, and revision N+1 adds a third node
- **THEN** the N+1 read reports the first node's terminal observation and the second's not-started fact-for-fact identical to the N read
- **AND** the added node reads not-started, carrying no observation of its siblings

#### Scenario: A superseded node keeps its observation on its line

- **WHEN** revision N reads a node `required` with terminal run-state and revision N+1 marks that node `superseded` with a recorded reason
- **THEN** the N+1 read still reports the node's terminal observation on its node line, beside the superseded lifecycle and its reason
- **AND** the Issue's phase, health, and progress derive from the other nodes alone, exactly as the lifecycle vocabulary already provides

#### Scenario: An edge change moves dependency facts, not observations

- **WHEN** revision N+1 adds a dependency edge from an unchanged node to a non-terminal node
- **THEN** the unchanged node's own observation is identical to its N reading
- **AND** its dependency facts name the new dependency while that dependency's work is not complete

#### Scenario: Replanning does not write execution state

- **WHEN** a new revision is published for an Issue whose nodes have recorded run-state
- **THEN** every run-state file, the Issue record, and every prior revision are byte-identical before and after the publication
- **AND** only a later real run or committed Store evidence can change any observation

### Requirement: A retargeted node starts a new observation lineage

A Change node whose target project or target line changes between revisions SHALL carry a new
Change instance — publication refuses a node that declares a project or line its Change
instance is not committed under — and the new revision's observation of that node SHALL
derive from the new instance alone: the node reads not-started unless the new instance
carries its own run-state or committed archive evidence, and no observation recorded against
the prior revision's instance is inherited by the retargeted node. The prior lineage's facts
SHALL remain readable where they live: the prior revision, immutable and digest-verified, and
the revision delta naming the retarget with both revisions' target facts. An intent node
carries no observation lineage — its observation is `not-started` by construction, whatever
its target.

#### Scenario: A retarget keeping the old instance is refused at publication

- **WHEN** a revision is authored redeclaring a node under a new project while naming the Change instance committed under the old project
- **THEN** publication is refused under the reference scope conflict, naming the node, the declared project and line, and the committed ones
- **AND** no revision is created, so no observation lineage can blur

#### Scenario: A retargeted node reads fresh while the prior revision keeps its history

- **WHEN** revision N reads a node terminal under project A, and revision N+1 redeclares that node under project B naming a new Change instance with no run-state and no archive evidence
- **THEN** the N+1 read reports the node not-started
- **AND** the revision delta names the retarget with both projects, and revision N still reads the node's terminal observation under project A

#### Scenario: A retargeted instance with its own evidence reads that evidence

- **WHEN** revision N+1 redeclares a node under project B naming a Change instance that already carries terminal run-state
- **THEN** the N+1 read reports the node's terminal observation from that instance's own evidence
- **AND** the observation is attributed to the new instance's run-state location, never to the prior lineage's

#### Scenario: An intent node's retarget carries no lineage

- **WHEN** revision N+1 retargets an intent node to another member project
- **THEN** the node's observation remains not-started by construction
- **AND** the revision delta names the retarget with both projects exactly as a Change node's
