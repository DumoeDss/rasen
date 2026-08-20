## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The Issue read surface shows the projection

`rasen store issue list` SHALL show each Issue's phase, health, and progress alongside its
state and title, and `rasen store issue show` SHALL show the Issue's tri-axis status followed by
one line per plan node carrying that node's identifier, kind, target project,
Change alias, observed execution state, and any dependency or diagnostic that explains it. `show` SHALL group those node lines under one lane
header per member project the revision names — each header carrying the
project's identity, its display alias when one is known, and the lane's
progress pair — and `list` SHALL carry a compact per-project progress summary
beside the Issue-level pair, the same lane facts in the same order. A node whose lifecycle is not
`required` SHALL have that lifecycle named on its node line, and a `cancelled` or `superseded`
node SHALL have its recorded reason shown with it. A node's target project
SHALL be shown as the fact the revision records — the project the plan's
author targeted — and SHALL drive no phase, health, or progress value: a
revision whose nodes name one project and a revision whose nodes name several
derive their axes by the same rules. A node line's dependency facts SHALL
follow the same rule start enforces — the work-complete rule — so the read
surface explains exactly what a launch will wait for: each dependency whose
observed work is not complete SHALL be named on the downstream node's line
with its node identifier, its target project, and its observed state, and a
dependency whose observed work is complete SHALL NOT be named as a blocker
even before its Change is archived. The `--json` form of both commands
SHALL carry every fact the human form carries, including the per-project
lanes with their progress pairs, per-node target
project, per-node dependency facts, per-node lifecycle, observations and status
problems.

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

#### Scenario: Both forms agree

- **WHEN** the same Issue is listed and shown in human form and in `--json` form
- **THEN** the phase, health, progress, per-project lanes with their progress pairs, per-node target projects, per-node dependency facts, per-node lifecycles, per-node observations, and status problems are the same facts in both forms
