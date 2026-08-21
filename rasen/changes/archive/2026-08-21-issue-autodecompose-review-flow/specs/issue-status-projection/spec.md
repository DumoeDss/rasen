## MODIFIED Requirements

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
